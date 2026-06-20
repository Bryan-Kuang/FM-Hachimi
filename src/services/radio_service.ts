/**
 * RadioService
 * Endless "radio" playback of random 哈基米 (Hachimi) tracks.
 *
 * Unlike /hachimi (which queues a fixed batch that then loops), radio behaves
 * like a live station: the visible queue holds only the current track, and the
 * NEXT track is pre-extracted into a hidden per-guild on-deck slot for gapless
 * transitions. The on-deck track is deliberately kept OUT of Queue.items so the
 * now-playing card never reveals how many songs are buffered.
 *
 * Advancement is driven by AudioPlayer.advanceHook: when a radio track ends (or
 * the user skips), the player calls back into handleAdvance(), which promotes
 * the on-deck track, plays it, and kicks off the next prefetch.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as logger from './logger_service';
import config = require('../config/config');
import { isTestGuild } from '../bot/testing_access';
import type { ExtractedTrackData } from './types';

const RADIO_REQUESTED_BY = '📻 Radio';

interface VoiceChannelLike {
  id: string;
}

interface PlayerServiceLike {
  getPlayer(guildId: string): any;
  getExtractor(): { extractAudio(url: string, options?: any): Promise<ExtractedTrackData> } | null;
  addTrack(guildId: string, videoOrUrl: ExtractedTrackData | string, requestedBy: string): Promise<unknown>;
  play(guildId: string): Promise<boolean>;
  setUIContext(guildId: string, channelId: string): void;
}

interface HachimiCandidate {
  url: string;
  bvid?: string;
}

interface BilibiliApiLike {
  searchHachimiVideos(
    maxResults: number,
    guildId: string | null,
  ): Promise<{ results?: HachimiCandidate[]; failReason?: string }>;
  recordHachimiHistory?(guildId: string, bvid: string): void;
}

interface RadioState {
  enabled: boolean;
  channelId: string | null;
  /** Pre-extracted next track, hidden from the queue/UI. */
  onDeck: ExtractedTrackData | null;
  /** In-flight prefetch, so we never fire two concurrent replenishes. */
  onDeckPromise: Promise<ExtractedTrackData | null> | null;
  /** Epoch ms after which the next break video becomes armed. */
  nextBreakAt: number;
  /** True while the non-skippable break video is the current track. */
  breakPlaying: boolean;
}

interface RadioStartResult {
  success: boolean;
  error?: string;
}

function extractBvid(candidate: HachimiCandidate): string | null {
  if (candidate.bvid) return candidate.bvid;
  const match = /\/video\/(BV[0-9A-Za-z]+)/.exec(candidate.url || '');
  return match ? match[1] : null;
}

class RadioService {
  private playerService: PlayerServiceLike;
  private bilibiliApi: BilibiliApiLike;
  private states: Map<string, RadioState>;

  constructor(
    playerService: PlayerServiceLike,
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    bilibiliApi: BilibiliApiLike = require('../bilibili/api'),
  ) {
    this.playerService = playerService;
    this.bilibiliApi = bilibiliApi;
    this.states = new Map();
  }

  isEnabled(guildId: string): boolean {
    return this.states.get(guildId)?.enabled ?? false;
  }

  /** True while the non-skippable break video is the current track. */
  isOnBreak(guildId: string): boolean {
    return this.states.get(guildId)?.breakPlaying ?? false;
  }

  private breakIntervalMs(guildId: string): number {
    // The test guild uses a shorter cadence so the feature is easy to verify.
    const minutes = isTestGuild(guildId)
      ? config.radio.breakIntervalMinutesTest
      : config.radio.breakIntervalMinutes;
    return Math.max(1, minutes) * 60_000;
  }

  private get(guildId: string): RadioState {
    let state = this.states.get(guildId);
    if (!state) {
      state = {
        enabled: false,
        channelId: null,
        onDeck: null,
        onDeckPromise: null,
        nextBreakAt: 0,
        breakPlaying: false,
      };
      this.states.set(guildId, state);
    }
    return state;
  }

  /**
   * Start endless radio: take over the queue and play a random Hachimi track,
   * then prefetch the next one. Idempotent-ish — calling start while already
   * running just re-seeds with a fresh track.
   */
  async start(
    guildId: string,
    voiceChannel: VoiceChannelLike,
    channelId: string,
  ): Promise<RadioStartResult> {
    if (!config.radio.enabled) {
      return { success: false, error: 'Radio mode is disabled by the server configuration.' };
    }

    const player = this.playerService.getPlayer(guildId);
    if (!player) {
      return { success: false, error: 'Audio player is not available.' };
    }

    if (
      !player.voiceConnection ||
      player.voiceConnection.joinConfig?.channelId !== voiceChannel.id
    ) {
      const joined = await player.joinVoiceChannel(voiceChannel);
      if (!joined) {
        return { success: false, error: 'Failed to join the voice channel.' };
      }
    }

    const first = await this.replenish(guildId);
    if (!first) {
      return {
        success: false,
        error: 'Could not find a playable Hachimi video right now. Please try again.',
      };
    }

    const state = this.get(guildId);
    state.enabled = true;
    state.channelId = channelId;
    state.onDeck = null;
    state.onDeckPromise = null;
    state.breakPlaying = false;
    state.nextBreakAt = Date.now() + this.breakIntervalMs(guildId);

    // Take over advancement and disable looping so old tracks are never repeated.
    player.advanceHook = (reason: 'ended' | 'user') => this.handleAdvance(guildId, reason);
    player.radioMode = true;
    player.setLoopMode('none');

    // Visible queue = current track only. The on-deck track stays hidden.
    player.queue.reset();
    await this.playerService.addTrack(guildId, first, RADIO_REQUESTED_BY);
    this.playerService.setUIContext(guildId, channelId);
    const played = await this.playerService.play(guildId);
    if (!played) {
      await this.stop(guildId);
      return { success: false, error: 'Failed to start playback.' };
    }

    this.prefetch(guildId);

    logger.info('Radio mode started', { guildId, channelId });
    return { success: true };
  }

  /**
   * Disable radio mode for a guild. Does NOT stop the current track — that is
   * left to /stop. Detaches the advance hook so the player reverts to normal
   * queue behaviour.
   */
  async stop(guildId: string): Promise<void> {
    const state = this.states.get(guildId);
    if (!state || !state.enabled) return;

    state.enabled = false;
    state.channelId = null;
    state.onDeck = null;
    state.onDeckPromise = null;
    state.breakPlaying = false;

    try {
      const player = this.playerService.getPlayer(guildId);
      if (player) {
        player.advanceHook = null;
        player.radioMode = false;
        player.setLoopMode('queue');
      }
    } catch (e: unknown) {
      logger.warn('Radio stop: failed to detach hook', { guildId, error: (e as Error).message });
    }

    logger.info('Radio mode stopped', { guildId });
  }

  /**
   * Called by AudioPlayer.advanceHook when a radio track ends or is skipped.
   * Promotes the on-deck track (or fetches one synchronously if prefetch has
   * not landed yet), plays it, and prefetches the next. Returns true if it
   * handled advancement; false lets the player fall back to normal behaviour.
   *
   * `reason` distinguishes a natural track end ('ended') from a user-initiated
   * skip ('user'). The break video only injects on a natural end so it never
   * cuts off a song the listener is enjoying, and a user skip while the break
   * is armed simply defers it to the next natural end.
   */
  async handleAdvance(guildId: string, reason: 'ended' | 'user' = 'user'): Promise<boolean> {
    const state = this.states.get(guildId);
    if (!state || !state.enabled) return false;

    // The break video just finished (skip is locked during it, so this is
    // always a natural end). Resume normal rotation and re-arm the timer.
    if (state.breakPlaying) {
      state.breakPlaying = false;
      state.nextBreakAt = Date.now() + this.breakIntervalMs(guildId);
      return this.advanceNormal(guildId);
    }

    // Break is due: play the fixed, non-skippable break video next. Keep the
    // on-deck track so the following random song is still gapless.
    if (config.radio.breakEnabled && reason === 'ended' && Date.now() >= state.nextBreakAt) {
      const playedBreak = await this.playBreak(guildId);
      if (playedBreak) return true;
      // Extraction failed — fall through to a normal track and re-arm so we
      // never leave dead air.
      state.nextBreakAt = Date.now() + this.breakIntervalMs(guildId);
    }

    return this.advanceNormal(guildId);
  }

  /** Promote the on-deck (or freshly fetched) random track and play it. */
  private async advanceNormal(guildId: string): Promise<boolean> {
    const next = await this.takeNext(guildId);
    if (!next) {
      logger.warn('Radio could not fetch the next track, ending radio', { guildId });
      await this.stop(guildId);
      return false;
    }

    const player = this.playerService.getPlayer(guildId);
    player.queue.reset();
    await this.playerService.addTrack(guildId, next, RADIO_REQUESTED_BY);
    const played = await this.playerService.play(guildId);
    if (!played) {
      await this.stop(guildId);
      return false;
    }

    this.prefetch(guildId);
    return true;
  }

  /**
   * Extract and play the fixed break video. Does NOT prefetch (the existing
   * on-deck random track is preserved for after the break) and does NOT touch
   * the timer (the caller re-arms it once the break ends). Returns false if the
   * break video could not be extracted/played so the caller can fall back.
   */
  private async playBreak(guildId: string): Promise<boolean> {
    const state = this.get(guildId);
    const extractor = this.playerService.getExtractor();
    if (!extractor) {
      logger.warn('Radio break: extractor unavailable, skipping break', { guildId });
      return false;
    }

    let track: ExtractedTrackData;
    try {
      track = await extractor.extractAudio(config.radio.breakVideoUrl);
    } catch (e: unknown) {
      logger.warn('Radio break: failed to extract break video', {
        guildId,
        error: (e as Error).message,
      });
      return false;
    }

    const player = this.playerService.getPlayer(guildId);
    player.queue.reset();
    await this.playerService.addTrack(guildId, track, RADIO_REQUESTED_BY);
    const played = await this.playerService.play(guildId);
    if (!played) {
      logger.warn('Radio break: failed to play break video', { guildId });
      return false;
    }

    state.breakPlaying = true;
    logger.info('Radio break video playing', { guildId });
    return true;
  }

  /**
   * Fire-and-forget prefetch of the next track into the hidden on-deck slot.
   * No-op if radio is off, a track is already on deck, or a prefetch is running.
   */
  private prefetch(guildId: string): void {
    const state = this.get(guildId);
    if (!state.enabled || state.onDeck || state.onDeckPromise) return;

    state.onDeckPromise = this.replenish(guildId)
      .then((track) => {
        if (state.enabled) state.onDeck = track;
        return track;
      })
      .catch((e) => {
        logger.warn('Radio prefetch failed', { guildId, error: (e as Error).message });
        return null;
      })
      .finally(() => {
        state.onDeckPromise = null;
      });
  }

  /** Consume the on-deck track, awaiting an in-flight prefetch or fetching fresh. */
  private async takeNext(guildId: string): Promise<ExtractedTrackData | null> {
    const state = this.get(guildId);

    if (state.onDeck) {
      const track = state.onDeck;
      state.onDeck = null;
      return track;
    }

    if (state.onDeckPromise) {
      const track = await state.onDeckPromise;
      state.onDeck = null;
      if (track) return track;
    }

    return this.replenish(guildId);
  }

  /**
   * Fetch one random Hachimi candidate and extract its audio. Retries a few
   * fresh candidates on failure (each search call re-randomises and skips
   * recently-played videos via the history store).
   */
  private async replenish(guildId: string): Promise<ExtractedTrackData | null> {
    const extractor = this.playerService.getExtractor();
    if (!extractor) {
      logger.warn('Radio: Bilibili extractor unavailable', { guildId });
      return null;
    }

    const maxAttempts = Math.max(1, config.radio.replenishMaxAttempts);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { results } = await this.bilibiliApi.searchHachimiVideos(1, guildId);
        const candidate = results && results[0];
        if (!candidate) {
          logger.warn('Radio: no Hachimi candidates returned', { guildId, attempt });
          continue;
        }

        const extracted = await extractor.extractAudio(candidate.url);

        const bvid = extractBvid(candidate);
        if (bvid && typeof this.bilibiliApi.recordHachimiHistory === 'function') {
          this.bilibiliApi.recordHachimiHistory(guildId, bvid);
        }

        return extracted;
      } catch (e: unknown) {
        logger.warn('Radio replenish attempt failed', {
          guildId,
          attempt,
          error: (e as Error).message,
        });
      }
    }

    return null;
  }
}

export = RadioService;
