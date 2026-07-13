/**
 * Thin adapter over the extracted `discord-voice-resume` package (which grew
 * out of this file). Preserves the exact surface `index.ts` and
 * `annoying_service.ts` already call — capture/captureGuild/persist/consume/
 * scheduleRestore/restore/reconstructGuild/announceResume/startAutoSnapshot/
 * stopAutoSnapshot — so those call sites are unchanged.
 *
 * The package owns the crash-safe snapshot file (delete-on-read, TTL,
 * auto-flush timer) and the discord.js-specific restore mechanics (channel
 * fetch/validation, empty-room detection via the voice-state cache). This
 * adapter owns everything bot-specific: rebuilding the queue/Track objects,
 * seeking, re-arming radio mode, and the "基米永不灭～" announcement — all
 * inside the `onRestore` callback, mirroring the original restoreGuild /
 * restorePresence split but driven by the package's own empty-room
 * detection instead of a locally re-implemented one.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import fs = require('fs');
import voice = require('@discordjs/voice');
import discordVoiceResume = require('discord-voice-resume');
import Track = require('../models/track');
import logger = require('../services/logger_service');

const { AudioPlayerStatus } = voice;
const { SessionResume } = discordVoiceResume;
type PackageGuildState<T> = discordVoiceResume.GuildResumeState<T>;
type RestoreContext = discordVoiceResume.RestoreContext;

interface ResumeServiceOptions {
  enabled: boolean;
  dataFile: string;
  maxAgeMs: number;
  snapshotIntervalMs?: number;
}

interface GuildResumeState {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string | null;
  /** Plain-object Track dumps (TrackData + requestedBy/addedAt). */
  tracks: any[];
  currentIndex: number;
  loopMode: string;
  positionSeconds: number;
  isPaused: boolean;
  /** Whether the guild was in endless radio mode (re-armed on restore). */
  radioMode: boolean;
  /** Recently-played bvids (radio/Hachimi dedup window). */
  history: string[];
}

interface ResumeSnapshot {
  savedAt: string;
  guilds: GuildResumeState[];
}

interface RestoreDeps {
  client: any;          // discord.js Client (ready)
  audioManager: any;    // AudioManager — creates players with extractors wired
  sessionManager: any;  // SessionManager
  radioService?: any;   // RadioService — re-armed when a snapshot was in radio mode
}

/** Everything captured per guild, minus the identity/routing fields the package already tracks. */
type PlaybackPayload = Omit<GuildResumeState, 'guildId' | 'voiceChannelId' | 'textChannelId'>;

const EMPTY_PAYLOAD: PlaybackPayload = {
  tracks: [],
  currentIndex: -1,
  loopMode: 'none',
  positionSeconds: 0,
  isPaused: false,
  radioMode: false,
  history: [],
};

class ResumeService {
  private readonly enabled: boolean;
  private readonly dataFile: string;
  private readonly resume: discordVoiceResume.SessionResume<PlaybackPayload>;

  constructor(options: ResumeServiceOptions) {
    this.enabled = options.enabled;
    this.dataFile = options.dataFile;
    this.resume = new SessionResume<PlaybackPayload>({
      enabled: options.enabled,
      dataFile: options.dataFile,
      maxAgeMs: options.maxAgeMs,
      snapshotIntervalMs: options.snapshotIntervalMs,
    });

    this.resume.on('persist', (e) => {
      if (e.guilds > 0) logger.info('Playback resume snapshot persisted', { guilds: e.guilds, file: e.file });
    });
    this.resume.on('persist:error', (e) => {
      logger.error('Failed to persist playback resume snapshot', { file: this.dataFile, error: e.error });
    });
    this.resume.on('restore:skipped', (e) => {
      logger.warn('Resume skipped', { guildId: e.guildId, reason: e.reason });
    });
    this.resume.on('restore:error', (e) => {
      logger.error('Failed to resume guild playback', { guildId: e.guildId, error: e.error });
    });
  }

  // ── Periodic flush ────────────────────────────────────────────────────

  startAutoSnapshot(sessionManager: any): void {
    this.resume.startAutoSnapshot(
      () => [...sessionManager.sessions.keys()],
      (guildId: string) => this.toCapture(sessionManager, guildId),
    );
    if (this.enabled) {
      logger.info('Playback auto-snapshot started');
    }
  }

  stopAutoSnapshot(): void {
    this.resume.stopAutoSnapshot();
  }

  // ── Shutdown side ─────────────────────────────────────────────────────

  capture(sessionManager: any): ResumeSnapshot {
    const guilds: GuildResumeState[] = [];
    for (const [guildId] of sessionManager.sessions) {
      const state = this.captureGuild(sessionManager, guildId);
      if (state) guilds.push(state);
    }
    return { savedAt: new Date().toISOString(), guilds };
  }

  captureGuild(
    sessionManager: any,
    guildId: string,
    voiceChannelIdOverride?: string,
  ): GuildResumeState | null {
    const session = sessionManager.sessions.get(guildId);
    const player = session?.player;
    if (!player || !player.voiceConnection) return null;

    const voiceChannelId =
      voiceChannelIdOverride ?? player.voiceConnection.joinConfig?.channelId;
    if (!voiceChannelId) return null;

    if (!player.currentTrack || (!player.isPlaying && !player.isPaused)) {
      // Connected but nothing live — capture presence only.
      return {
        guildId,
        voiceChannelId,
        textChannelId: session.uiContext?.channelId ?? null,
        tracks: [],
        currentIndex: -1,
        loopMode: player.queue?.loopMode ?? 'none',
        positionSeconds: 0,
        isPaused: false,
        radioMode: !!player.radioMode,
        history: [...session.history],
      };
    }

    return {
      guildId,
      voiceChannelId,
      textChannelId: session.uiContext?.channelId ?? null,
      tracks: player.queue.items.map((track: any) => ({ ...track })),
      currentIndex: player.queue.currentIndex,
      loopMode: player.queue.loopMode,
      positionSeconds: Math.max(0, Math.floor(player.getCurrentTime?.() ?? 0)),
      isPaused: !!player.isPaused,
      radioMode: !!player.radioMode,
      history: [...session.history],
    };
  }

  persist(sessionManager: any): void {
    const guildIds = [...sessionManager.sessions.keys()];
    this.resume.persist(guildIds, (guildId) => this.toCapture(sessionManager, guildId));
  }

  private toCapture(
    sessionManager: any,
    guildId: string,
  ): { voiceChannelId: string; textChannelId: string | null; payload: PlaybackPayload } | null {
    const state = this.captureGuild(sessionManager, guildId);
    if (!state) return null;
    const { guildId: _guildId, voiceChannelId, textChannelId, ...payload } = state;
    return { voiceChannelId, textChannelId, payload };
  }

  // ── Startup side ──────────────────────────────────────────────────────

  consume(): ResumeSnapshot | null {
    const snapshot = this.resume.consume();
    if (!snapshot) return null;
    return {
      savedAt: snapshot.savedAt,
      guilds: snapshot.guilds.map((g) => this.flatten(g)),
    };
  }

  private flatten(state: PackageGuildState<PlaybackPayload>): GuildResumeState {
    return {
      guildId: state.guildId,
      voiceChannelId: state.voiceChannelId,
      textChannelId: state.textChannelId,
      ...(state.payload ?? EMPTY_PAYLOAD),
    };
  }

  /**
   * Kick off restoration once the Discord client is ready. Fire-and-forget:
   * resuming is best-effort and must never block or fail startup.
   */
  scheduleRestore(deps: RestoreDeps): void {
    if (!this.enabled) return;
    if (!fs.existsSync(this.dataFile)) return;

    const run = () => {
      this.restore(deps).catch((err: Error) => {
        logger.error('Playback resume failed', { error: err.message });
      });
    };

    if (deps.client.isReady?.()) run();
    else deps.client.once?.('clientReady', run);
  }

  async restore(deps: RestoreDeps): Promise<{ restored: number; skipped: number }> {
    const result = await this.resume.restoreAll(deps.client, {
      onRestore: (voiceChannel, payload, ctx) => this.onRestore(deps, voiceChannel, payload, ctx),
    });
    logger.info('Playback resume completed', result);
    return result;
  }

  /**
   * Rebuild a guild's session from a captured state while the process is still
   * running — the /annoying anti-disconnect rejoin. Same machinery as restart
   * resume, including the "基米永不灭～" announcement. No file I/O.
   */
  async reconstructGuild(deps: RestoreDeps, state: GuildResumeState): Promise<boolean> {
    const { guildId, voiceChannelId, textChannelId, ...payload } = state;
    return this.resume.restoreSession(
      deps.client,
      { guildId, voiceChannelId, textChannelId, payload },
      { onRestore: (voiceChannel, p, ctx) => this.onRestore(deps, voiceChannel, p, ctx) },
    );
  }

  private async onRestore(
    deps: RestoreDeps,
    voiceChannel: any,
    payload: PlaybackPayload | null,
    ctx: RestoreContext,
  ): Promise<boolean> {
    const { client, audioManager, sessionManager } = deps;
    const { guildId, textChannelId, roomWasEmpty } = ctx;
    const state = payload ?? EMPTY_PAYLOAD;

    // Don't resume PLAYBACK in a channel nobody is listening in — but always
    // rejoin it: the bot's presence must survive every deploy (the 2026-07-09
    // incident: deploy landed while the bot played to an emptied-out channel,
    // the old empty-channel skip left it evicted for good).
    if (roomWasEmpty) {
      logger.info('Resume: voice channel is empty, rejoining without playback', {
        guildId,
        channelId: voiceChannel.id,
      });
    }

    // Presence-only snapshot (the bot was parked with nothing live), or a
    // playback snapshot downgraded because the room is empty: rejoin instead
    // of resuming a track. Radio only restarts when someone is listening.
    if (roomWasEmpty || !state.tracks || state.tracks.length === 0) {
      return this.restorePresence(deps, guildId, textChannelId, state, voiceChannel, {
        restartRadio: !roomWasEmpty,
      });
    }

    const tracks = state.tracks.map((raw: any) => {
      const track = new Track(raw, raw.requestedBy);
      if (raw.addedAt) track.addedAt = new Date(raw.addedAt);
      track.retryCount = 0;
      return track;
    });

    const index =
      state.currentIndex >= 0 && state.currentIndex < tracks.length ? state.currentIndex : 0;

    const player = audioManager.getPlayer(guildId);
    player.queue.items = tracks;
    player.queue.currentIndex = index;
    player.queue.currentTrack = tracks[index];
    player.queue.setLoopMode(state.loopMode);

    const session = sessionManager.get(guildId);
    for (const bvid of state.history || []) session.addHistory(bvid);

    const joined = await player.joinVoiceChannel(voiceChannel);
    if (!joined) {
      logger.warn('Resume skipped: failed to rejoin voice channel', {
        guildId,
        channelId: voiceChannel.id,
      });
      player.queue.reset();
      return false;
    }

    if (state.isPaused) {
      // Re-pause as soon as the resource starts so a deliberately paused
      // session comes back paused instead of blasting audio.
      player.audioPlayer.once(AudioPlayerStatus.Playing, () => player.pause());
    }

    // Stale stream URLs are handled inside playCurrentTrack (isExpired() →
    // re-extract), so a snapshot older than the CDN URL lifetime still plays.
    await player.playCurrentTrack({ startAtSeconds: state.positionSeconds });

    // Re-arm endless radio so rotation continues. Without this the single
    // restored track plays out and the bot goes idle (radio keeps only the
    // current track in the visible queue, with loop disabled).
    if (state.radioMode && deps.radioService) {
      try {
        await deps.radioService.resume(guildId, textChannelId);
      } catch (err: unknown) {
        logger.warn('Resume: failed to re-arm radio mode', {
          guildId,
          error: (err as Error).message,
        });
      }
    }

    logger.info('Resumed playback after restart', {
      guildId,
      track: tracks[index].title,
      positionSeconds: state.positionSeconds,
      queueLength: tracks.length,
      wasPaused: state.isPaused,
      radioMode: state.radioMode,
    });

    this.announceResume(client, textChannelId, tracks[index]).catch((err: Error) => {
      logger.debug('Failed to send resume announcement', { error: err.message });
    });

    return true;
  }

  /**
   * Rejoin a voice channel without resuming a track — either the bot was
   * merely parked there, or it was playing but the room is empty now. No
   * announcement and no inactivity timer: the pre-restart session was
   * already past (or outside) its idle countdown, and evicting the bot right
   * after it fought its way back would defeat the point. With restartRadio, a
   * radio-mode snapshot (armed rotation, or SIGTERM landed between rotation
   * tracks) restarts the rotation from scratch via radioService.start(),
   * which seeds and plays a fresh track — resume() can't be used here since
   * it assumes a restored track is already playing. Callers pass
   * restartRadio: false for an empty room so radio doesn't stream to nobody.
   */
  private async restorePresence(
    deps: RestoreDeps,
    guildId: string,
    textChannelId: string | null,
    state: PlaybackPayload,
    voiceChannel: any,
    { restartRadio }: { restartRadio: boolean },
  ): Promise<boolean> {
    const player = deps.audioManager.getPlayer(guildId);
    const session = deps.sessionManager.get(guildId);
    for (const bvid of state.history || []) session.addHistory(bvid);

    const joined = await player.joinVoiceChannel(voiceChannel);
    if (!joined) {
      logger.warn('Presence resume skipped: failed to rejoin voice channel', {
        guildId,
        channelId: voiceChannel.id,
      });
      return false;
    }

    if (restartRadio && state.radioMode && deps.radioService && textChannelId) {
      try {
        await deps.radioService.start(guildId, voiceChannel, textChannelId);
      } catch (err: unknown) {
        logger.warn('Presence resume: failed to restart radio mode', {
          guildId,
          error: (err as Error).message,
        });
      }
    }

    logger.info('Rejoined voice channel after restart (presence only)', {
      guildId,
      channelId: voiceChannel.id,
      radioMode: state.radioMode,
    });
    return true;
  }

  /**
   * The "基米永不灭～" revival announcement — shared by restart resume,
   * /annoying reconstruction (via reconstructGuild), and the /annoying move-back.
   */
  async announceResume(client: any, textChannelId: string | null, track: any): Promise<void> {
    if (!textChannelId) return;
    const channel = await client.channels.fetch(textChannelId).catch(() => null);
    if (!channel || typeof channel.send !== 'function') return;
    await channel.send(`基米永不灭～ 重新部署完成，继续播放：**${track.title}**`);
  }
}

export = ResumeService;
