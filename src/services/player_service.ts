/**
 * Player Service
 * Single service layer bridging command/UI layer and audio layer.
 * Absorbs both PlaybackService (play/pause/skip/stop/state) and
 * QueueService (add/remove/clear/shuffle/loop) responsibilities.
 */

import { EventEmitter } from 'events';
import * as logger from './logger_service';
import * as metrics from '../observability/metrics';
import AnnoyingService = require('./annoying_service');
import {
  RADIO_ONLY_STOP_MESSAGE,
  RADIO_ONLY_STOP_SUGGESTION,
  RADIO_BREAK_MESSAGE,
  RADIO_BREAK_SUGGESTION,
  isRadioBlockedButton,
} from '../playback/radio_controls';
import type Track from '../models/track';
import type { GuildId, ChannelId, MessageId } from '../types';
import type {
  AudioManagerLike,
  AudioPlayerLike,
  AudioPlayerState,
  InterfaceUpdaterLike,
  ExtractorLike,
  ExtractedTrackData,
  ActionResult,
  PlayResult,
  QueueInfo,
  StateChangedEvent,
} from './types';

interface PreExtractionServiceLike {
  prewarmBilibiliUrls(
    urls: string[],
    context: { source: 'play_search' | 'search_command' | 'daily_recommendation'; guildId?: string; keyword?: string },
  ): unknown;
  prewarmYouTubeUrls?(
    urls: string[],
    context: { source: 'play_search' | 'search_command' | 'daily_recommendation'; guildId?: string; keyword?: string },
  ): unknown;
}

interface SpotifyDirectExtractorLike {
  isConfigured(): boolean;
  extractAudio(trackId: string, meta: { title: string; durationSec?: number }): Promise<{
    title: string;
    audioUrl: string;
    duration: number;
    cached: true;
    extractedAt: string;
  }>;
}

interface RadioServiceLike {
  isEnabled(guildId: GuildId): boolean;
  isOnBreak(guildId: GuildId): boolean;
  stop(guildId: GuildId): Promise<void>;
  playNow?(
    guildId: GuildId,
    url: string,
    requestedBy: string,
  ): Promise<{ success: boolean; error?: string }>;
}

interface AnnoyingServiceLike {
  isEnabled(guildId: GuildId): boolean;
  toggle(guildId: GuildId): boolean;
  isProtectedFrom(guildId: GuildId, user: { id?: string; username?: string } | null): boolean;
  handleBotDisconnect(oldState: unknown): Promise<string>;
  handleBotMove(oldState: unknown, newState: unknown): Promise<void>;
  handleBotMuteDeafen(oldState: unknown, newState: unknown): Promise<void>;
}

interface PlayerServiceDeps {
  audioManager: AudioManagerLike;
  interfaceUpdater: InterfaceUpdaterLike;
  progressTracker: unknown;
  extractor: ExtractorLike;
  youtubeExtractor?: ExtractorLike;
  historyStore?: unknown;
  preExtractionService?: PreExtractionServiceLike | null;
}

class PlayerService extends EventEmitter {
  private audioManager: AudioManagerLike;
  private interfaceUpdater: InterfaceUpdaterLike;
  private extractor: ExtractorLike;
  private youtubeExtractor: ExtractorLike | null;
  private preExtractionService: PreExtractionServiceLike | null;
  /** Per-guild AbortControllers for running hachimi ops */
  private _hachimiControllers: Map<GuildId, AbortController>;
  /** Endless radio controller, attached post-construction by the composition root. */
  private radioService: RadioServiceLike | null;
  /** /annoying anti-disconnect mode, attached post-construction by the composition root. */
  private annoyingService: AnnoyingServiceLike | null;
  /** Direct Spotify extraction sidecar (Project B), attached post-construction — null when SPOTIFY_DIRECT_ENABLED=false. */
  private spotifyDirectExtractor: SpotifyDirectExtractorLike | null;

  constructor({
    audioManager,
    interfaceUpdater,
    progressTracker: _progressTracker,
    extractor,
    youtubeExtractor,
    historyStore: _historyStore,
    preExtractionService,
  }: PlayerServiceDeps) {
    super();
    this.audioManager        = audioManager;
    this.interfaceUpdater    = interfaceUpdater;
    this.extractor           = extractor;
    this.youtubeExtractor    = youtubeExtractor || null;
    this.preExtractionService = preExtractionService || null;
    this._hachimiControllers = new Map();
    this.radioService = null;
    this.annoyingService = null;
    this.spotifyDirectExtractor = null;
  }

  setRadioService(radioService: RadioServiceLike): void {
    this.radioService = radioService;
  }

  getRadioService(): RadioServiceLike | null {
    return this.radioService;
  }

  setAnnoyingService(annoyingService: AnnoyingServiceLike): void {
    this.annoyingService = annoyingService;
  }

  getAnnoyingService(): AnnoyingServiceLike | null {
    return this.annoyingService;
  }

  setSpotifyDirectExtractor(extractor: SpotifyDirectExtractorLike | null): void {
    this.spotifyDirectExtractor = extractor;
  }

  /** Public accessor for the Spotify direct extractor (null when unconfigured/disabled). */
  getSpotifyDirectExtractor(): SpotifyDirectExtractorLike | null {
    return this.spotifyDirectExtractor;
  }

  _setHachimiController(guildId: GuildId, controller: AbortController): void {
    this._hachimiControllers.set(guildId, controller);
  }

  _clearHachimiController(guildId: GuildId): void {
    this._hachimiControllers.delete(guildId);
  }

  /**
   * Public accessor for the Bilibili extractor.
   */
  getExtractor(): ExtractorLike {
    return this.extractor;
  }

  /**
   * Public accessor for the YouTube extractor (null if unavailable).
   */
  getYouTubeExtractor(): ExtractorLike | null {
    return this.youtubeExtractor;
  }

  // ---------------------------------------------------------------------------
  // State emission (InterfaceUpdater listens for 'player_state_changed')
  // ---------------------------------------------------------------------------

  onStateChanged(handler: (event: StateChangedEvent) => void): void {
    this.on('player_state_changed', handler);
  }

  _emitState(guildId: GuildId, state: AudioPlayerState, track: Track | null): void {
    this.emit('player_state_changed', { guildId, state, track });
  }

  notifyState(guildId: GuildId): void {
    try {
      const player = this.audioManager.getPlayer(guildId);
      const state  = player.getState();
      this._emitState(guildId, state, state.currentTrack);
    } catch (e: unknown) {
      logger.error('Notify state failed', { guildId, error: (e as Error).message });
    }
  }

  // ---------------------------------------------------------------------------
  // Playback control
  // ---------------------------------------------------------------------------

  async play(guildId: GuildId): Promise<boolean> {
    try {
      metrics.counter('player_play_total', 'Tracks started').inc({ guildId });
      const player = this.audioManager.getPlayer(guildId);
      if (!player) return false;
      const success = await player.playNext();
      const state   = player.getState();
      this._emitState(guildId, state, state.currentTrack);
      return success;
    } catch (e: unknown) {
      metrics.counter('player_errors_total', 'Player action errors').inc({ action: 'play' });
      logger.error('Play action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  /**
   * Jump to a specific queue index and start playback there. Used by the
   * bulk-enqueue playlist path (playlist_coordinator.ts) instead of play() —
   * playNext()'s "cursor cleared, queue non-empty → resume from the newest
   * item" quirk would otherwise start a freshly-appended playlist at its
   * LAST item instead of its first.
   */
  async playTrackAt(guildId: GuildId, index: number): Promise<boolean> {
    try {
      metrics.counter('player_play_total', 'Tracks started').inc({ guildId });
      const player = this.audioManager.getPlayer(guildId);
      if (!player) return false;
      const success = await player.playTrack(index);
      const state   = player.getState();
      this._emitState(guildId, state, state.currentTrack);
      return success;
    } catch (e: unknown) {
      metrics.counter('player_errors_total', 'Player action errors').inc({ action: 'playTrackAt' });
      logger.error('playTrackAt action failed', { guildId, index, error: (e as Error).message });
      return false;
    }
  }

  pause(guildId: GuildId): boolean {
    try {
      metrics.counter('player_pause_total', 'Pause actions').inc({ guildId });
      const result = this.audioManager.pausePlayback(guildId);
      if (result && result.player) {
        const state = result.player as AudioPlayerState;
        this._emitState(guildId, state, state.currentTrack);
      }
      return !!(result && result.success);
    } catch (e: unknown) {
      metrics.counter('player_errors_total', 'Player action errors').inc({ action: 'pause' });
      logger.error('Pause action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  resume(guildId: GuildId): boolean {
    try {
      metrics.counter('player_resume_total', 'Resume actions').inc({ guildId });
      const result = this.audioManager.resumePlayback(guildId);
      if (result && result.player) {
        const state = result.player as AudioPlayerState;
        this._emitState(guildId, state, state.currentTrack);
      }
      return !!(result && result.success);
    } catch (e: unknown) {
      metrics.counter('player_errors_total', 'Player action errors').inc({ action: 'resume' });
      logger.error('Resume action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  async skip(guildId: GuildId): Promise<boolean> {
    try {
      metrics.counter('player_skip_total', 'Skip actions').inc({ guildId });
      const result = await this.audioManager.skipTrack(guildId);
      if (result && result.player) {
        const state = result.player as AudioPlayerState;
        this._emitState(guildId, state, (result.newTrack as Track | null) ?? state.currentTrack);
      }
      return !!(result && result.success);
    } catch (e: unknown) {
      metrics.counter('player_errors_total', 'Player action errors').inc({ action: 'skip' });
      logger.error('Skip action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  async previous(guildId: GuildId): Promise<boolean> {
    try {
      metrics.counter('player_previous_total', 'Previous actions').inc({ guildId });
      const result = await this.audioManager.previousTrack(guildId);
      if (result && result.player) {
        const state = result.player as AudioPlayerState;
        this._emitState(guildId, state, (result.newTrack as Track | null) ?? state.currentTrack);
      }
      return !!(result && result.success);
    } catch (e: unknown) {
      metrics.counter('player_errors_total', 'Player action errors').inc({ action: 'previous' });
      logger.error('Previous action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  async stop(guildId: GuildId): Promise<boolean> {
    try {
      metrics.counter('player_stop_total', 'Stop actions').inc({ guildId });
      this._hachimiControllers.get(guildId)?.abort();
      this._hachimiControllers.delete(guildId);
      await this.radioService?.stop(guildId);
      const result = await this.audioManager.stopPlayback(guildId);
      if (result && result.player) {
        const state = result.player as AudioPlayerState;
        this._emitState(guildId, state, null);
      }
      if (result && result.success) {
        this.interfaceUpdater.clearContext(guildId);
      }
      return !!(result && result.success);
    } catch (e: unknown) {
      metrics.counter('player_errors_total', 'Player action errors').inc({ action: 'stop' });
      logger.error('Stop action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Queue operations (absorbed from QueueService)
  // ---------------------------------------------------------------------------

  async addTrack(guildId: GuildId, videoOrUrl: ExtractedTrackData | string, requestedBy: string): Promise<Track | null> {
    try {
      metrics.counter('queue_add_total', 'Tracks added to queue').inc({ guildId });
      const player = this.audioManager.getPlayer(guildId);
      let videoData: ExtractedTrackData;

      if (typeof videoOrUrl === 'string') {
        if (!this.extractor) throw new Error('Extractor not available');
        videoData = await this.extractor.extractAudio(videoOrUrl);
      } else {
        videoData = videoOrUrl;
      }

      const track = player.addToQueue(videoData, requestedBy);
      return track;
    } catch (e: unknown) {
      metrics.counter('player_errors_total', 'Player action errors').inc({ action: 'addTrack' });
      logger.error('Add to queue failed', { guildId, error: (e as Error).message });
      return null;
    }
  }

  removeTrack(guildId: GuildId, index: number): boolean {
    try {
      const player = this.audioManager.getPlayer(guildId);
      return player.removeFromQueue(index);
    } catch (e: unknown) {
      logger.error('Remove from queue failed', { guildId, index, error: (e as Error).message });
      return false;
    }
  }

  clearQueue(guildId: GuildId): boolean {
    try {
      const player = this.audioManager.getPlayer(guildId);
      player.clearQueue();
      return true;
    } catch (e: unknown) {
      logger.error('Clear queue failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  shuffleQueue(guildId: GuildId): ActionResult {
    return this.audioManager.shuffleQueue(guildId);
  }

  setLoopMode(guildId: GuildId, mode: string): ActionResult {
    return this.audioManager.setLoopMode(guildId, mode);
  }

  getLoopMode(guildId: GuildId): string {
    const player = this.audioManager.getPlayer(guildId);
    return player.loopMode;
  }

  getQueue(guildId: GuildId): QueueInfo {
    return this.audioManager.getQueue(guildId);
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  getPlayer(guildId: GuildId): AudioPlayerLike {
    return this.audioManager.getPlayer(guildId);
  }

  getCurrentTrack(guildId: GuildId): Track | null {
    const player = this.audioManager.getPlayer(guildId);
    return player.currentTrack;
  }

  isPlaying(guildId: GuildId): boolean {
    const player = this.audioManager.getPlayer(guildId);
    return player.isPlaying;
  }

  // ---------------------------------------------------------------------------
  // UI context management
  // ---------------------------------------------------------------------------

  setUIContext(guildId: GuildId, channelId: ChannelId, messageId?: MessageId): void {
    this.interfaceUpdater.setPlaybackContext(guildId, channelId, messageId);
  }

  clearUIContext(guildId: GuildId): void {
    this.interfaceUpdater.clearContext(guildId);
  }

  hasUIContext(guildId: GuildId): boolean {
    return this.interfaceUpdater.hasContext(guildId);
  }

  getUIContext(guildId: GuildId): { channelId: string; messageId: string } | null {
    return this.interfaceUpdater.getContext(guildId);
  }

  // ---------------------------------------------------------------------------
  // High-level playback entry point
  // ---------------------------------------------------------------------------

  async playBilibiliVideo(interaction: unknown, url: string, options?: unknown): Promise<PlayResult> {
    metrics.counter('bilibili_play_requested_total', 'Bilibili video play requests').inc();
    return this.audioManager.playBilibiliVideo(interaction, url, options);
  }

  prewarmBilibiliUrls(
    urls: string[],
    context: { source: 'play_search' | 'search_command' | 'daily_recommendation'; guildId?: string; keyword?: string },
  ): unknown {
    return this.preExtractionService?.prewarmBilibiliUrls(urls, context);
  }

  prewarmYouTubeUrls(
    urls: string[],
    context: { source: 'play_search' | 'search_command' | 'daily_recommendation'; guildId?: string; keyword?: string },
  ): unknown {
    return this.preExtractionService?.prewarmYouTubeUrls?.(urls, context);
  }

  // ---------------------------------------------------------------------------
  // Button interaction handler
  // ---------------------------------------------------------------------------

  // Single source of truth for button -> action mapping. Control buttons emit
  // state through this service's own pause/skip/etc.; queue/loop buttons act on
  // the player directly. (Previously this delegated the queue cases to a second,
  // near-identical switch in AudioManager — that duplicate is now gone.)
  async handleButtonInteraction(interaction: { customId: string; guild: { id: string }; channelId: string; user?: { id?: string; username?: string } }): Promise<ActionResult> {
    const customId = interaction.customId;
    const guildId  = interaction.guild.id;

    // Defense in depth — the button handler already refuses this upstream.
    if (customId === 'stop' && this.annoyingService?.isProtectedFrom?.(guildId, interaction.user ?? null)) {
      return {
        success: false,
        error: AnnoyingService.STOP_BLOCKED_MESSAGE,
        suggestion: '只有基米的主人才能使用 Stop。',
      };
    }

    if (isRadioBlockedButton(customId) && this.getPlayer(guildId).radioMode) {
      return {
        success: false,
        error: RADIO_ONLY_STOP_MESSAGE,
        suggestion: RADIO_ONLY_STOP_SUGGESTION,
      };
    }

    // The break video is non-skippable; Stop still works to exit radio.
    if (customId === 'skip' && this.radioService?.isOnBreak(guildId)) {
      return {
        success: false,
        error: RADIO_BREAK_MESSAGE,
        suggestion: RADIO_BREAK_SUGGESTION,
      };
    }

    if (['pause_resume', 'skip', 'prev', 'stop'].includes(customId)) {
      this.setUIContext(guildId, interaction.channelId);
      const player = this.getPlayer(guildId);

      if (customId === 'pause_resume') {
        if (player.isPlaying) return { success: this.pause(guildId) };
        else if (player.isPaused) return { success: this.resume(guildId) };
        return { success: false, error: 'No audio to pause/resume' };
      }
      if (customId === 'skip') return { success: await this.skip(guildId) };
      if (customId === 'prev') return { success: await this.previous(guildId) };
      if (customId === 'stop') return { success: await this.stop(guildId) };
    }

    // Queue / loop buttons.
    const player = this.getPlayer(guildId);
    switch (customId) {
      case 'queue_clear':
        player.clearQueue();
        return { success: true, player: player.getState() };

      case 'queue_shuffle':
        if (player.queue.length <= 1) {
          return {
            success: false,
            error: 'Not enough tracks to shuffle',
            suggestion: 'Add more tracks to the queue.',
          };
        }
        player.shuffleQueue();
        return { success: true, player: player.getState() };

      case 'loop':
        return { success: true, showMenu: true };

      case 'queue_loop': {
        const nextMode =
          player.loopMode === 'none' ? 'queue' :
          player.loopMode === 'queue' ? 'track' : 'none';
        player.setLoopMode(nextMode);
        return { success: true, mode: nextMode, player: player.getState() };
      }

      case 'queue_remove':
        return { success: true, showMenu: true };

      case 'queue':
        return { success: true, showQueue: true };

      default:
        if (customId.startsWith('queue_delete_')) {
          const index = parseInt(customId.split('_')[2], 10);
          if (!isNaN(index)) {
            if (player.queue.length === 0) {
              return { success: false, error: 'Queue is empty', suggestion: 'Add tracks to the queue first.' };
            }
            if (!player.removeFromQueue(index)) {
              return { success: false, error: 'Failed to remove track', suggestion: 'Check the track index and try again.' };
            }
            return { success: true, player: player.getState() };
          }
        }
        return { success: false, error: 'Unknown button interaction' };
    }
  }
}

export = PlayerService;
