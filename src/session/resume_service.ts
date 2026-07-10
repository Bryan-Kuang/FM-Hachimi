/**
 * Resume Service
 * Carries voice presence and active playback sessions across process restarts
 * (redeploys).
 *
 * On graceful shutdown every guild the bot is connected to gets snapshotted
 * into a JSON file under the persisted data/ mount. A guild that is actively
 * playing (or paused) captures the full playback state — voice channel, queue,
 * cursor, position, loop mode; a guild that is merely sitting in a voice
 * channel captures a presence-only state (empty track list). On the next
 * startup the snapshot is consumed (delete-on-read, so a crash loop can never
 * replay it): full states rejoin and resume the interrupted track where it
 * left off via FFmpeg input seeking, presence-only states just rejoin the
 * channel (restarting the radio rotation if one was armed). This repo's
 * pipeline redeploys on every merge to main, so without the presence-only
 * path any merge would silently kick the bot out of the channel it was
 * parked in.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fs from 'fs';
import * as path from 'path';
import { AudioPlayerStatus } from '@discordjs/voice';
import Track = require('../models/track');
import * as logger from '../services/logger_service';

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

class ResumeService {
  private readonly enabled: boolean;
  private readonly dataFile: string;
  private readonly maxAgeMs: number;
  private readonly snapshotIntervalMs: number;
  private snapshotTimer: NodeJS.Timeout | null;

  constructor(options: ResumeServiceOptions) {
    this.enabled = options.enabled;
    this.dataFile = options.dataFile;
    this.maxAgeMs = options.maxAgeMs;
    this.snapshotIntervalMs = options.snapshotIntervalMs ?? 0;
    this.snapshotTimer = null;
  }

  // ── Periodic flush ────────────────────────────────────────────────────

  /**
   * Flush the snapshot to disk on a fixed interval so a hard kill / crash (not
   * just a graceful SIGTERM) still leaves a fresh file to resume from.
   *
   * The first flush is deferred by one interval, which doubles as a crash-loop
   * guard: a track that crashes the process before surviving one interval is
   * never re-persisted (consume() already deleted the file on boot), so the bot
   * won't endlessly resume into the same poison track.
   */
  startAutoSnapshot(sessionManager: any): void {
    if (!this.enabled || this.snapshotIntervalMs <= 0 || this.snapshotTimer) return;

    this.snapshotTimer = setInterval(() => {
      try {
        this.persist(sessionManager);
      } catch (err: unknown) {
        logger.warn('Auto-snapshot flush failed', { error: (err as Error).message });
      }
    }, this.snapshotIntervalMs);

    // Don't keep the event loop alive just for snapshots.
    this.snapshotTimer.unref?.();

    logger.info('Playback auto-snapshot started', { intervalMs: this.snapshotIntervalMs });
  }

  stopAutoSnapshot(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  // ── Shutdown side ─────────────────────────────────────────────────────

  /**
   * Snapshot every session worth resuming: any session connected to voice.
   * Playing/paused sessions capture full playback state; idle-but-connected
   * sessions capture presence only, so a redeploy never evicts the bot from
   * its channel.
   */
  capture(sessionManager: any): ResumeSnapshot {
    const guilds: GuildResumeState[] = [];

    for (const [guildId] of sessionManager.sessions) {
      const state = this.captureGuild(sessionManager, guildId);
      if (state) guilds.push(state);
    }

    return { savedAt: new Date().toISOString(), guilds };
  }

  /**
   * Snapshot a single guild's state, or null when the bot isn't connected to
   * voice there. With a live (playing or paused) track this is the full
   * playback state; otherwise a presence-only state with an empty track list —
   * enough for the restore side to rejoin the channel. `voiceChannelIdOverride`
   * covers the forced-disconnect path, where Discord may have already cleared
   * the connection's join config by the time the voiceStateUpdate event is
   * handled.
   */
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

  /**
   * Capture and write the snapshot file. Must be cheap and synchronous — it
   * runs inside the SIGTERM handler before voice connections are torn down,
   * within Docker's stop grace period.
   */
  persist(sessionManager: any): void {
    if (!this.enabled) return;

    try {
      const snapshot = this.capture(sessionManager);

      if (snapshot.guilds.length === 0) {
        if (fs.existsSync(this.dataFile)) fs.unlinkSync(this.dataFile);
        return;
      }

      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dataFile, JSON.stringify(snapshot, null, 2), 'utf8');

      logger.info('Playback resume snapshot persisted', {
        guilds: snapshot.guilds.length,
        file: this.dataFile,
      });
    } catch (err: unknown) {
      logger.error('Failed to persist playback resume snapshot', {
        file: this.dataFile,
        error: (err as Error).message,
      });
    }
  }

  // ── Startup side ──────────────────────────────────────────────────────

  /**
   * Read and delete the snapshot file. Deleting before acting guarantees a
   * snapshot is attempted at most once, even if the process crashes while
   * restoring it.
   */
  consume(): ResumeSnapshot | null {
    if (!this.enabled) return null;

    let raw: string;
    try {
      if (!fs.existsSync(this.dataFile)) return null;
      raw = fs.readFileSync(this.dataFile, 'utf8');
      fs.unlinkSync(this.dataFile);
    } catch (err: unknown) {
      logger.warn('Failed to read playback resume snapshot', {
        file: this.dataFile,
        error: (err as Error).message,
      });
      return null;
    }

    try {
      const snapshot = JSON.parse(raw) as ResumeSnapshot;
      if (!Array.isArray(snapshot?.guilds) || snapshot.guilds.length === 0) return null;

      const ageMs = Date.now() - new Date(snapshot.savedAt).getTime();
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > this.maxAgeMs) {
        logger.warn('Playback resume snapshot expired, discarding', {
          ageMs,
          maxAgeMs: this.maxAgeMs,
          guilds: snapshot.guilds.length,
        });
        return null;
      }

      return snapshot;
    } catch (err: unknown) {
      logger.warn('Playback resume snapshot is corrupt, discarding', {
        error: (err as Error).message,
      });
      return null;
    }
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
    const snapshot = this.consume();
    if (!snapshot) return { restored: 0, skipped: 0 };

    logger.info('Resuming playback sessions from snapshot', {
      guilds: snapshot.guilds.length,
      savedAt: snapshot.savedAt,
    });

    let restored = 0;
    let skipped = 0;
    for (const state of snapshot.guilds) {
      try {
        if (await this.restoreGuild(deps, state)) restored++;
        else skipped++;
      } catch (err: unknown) {
        skipped++;
        logger.error('Failed to resume guild playback', {
          guildId: state.guildId,
          error: (err as Error).message,
        });
      }
    }

    logger.info('Playback resume completed', { restored, skipped });
    return { restored, skipped };
  }

  /**
   * Rebuild a guild's session from a captured state while the process is still
   * running — the /annoying anti-disconnect rejoin. Same machinery as restart
   * resume, including the "基米永不灭～" announcement.
   */
  async reconstructGuild(deps: RestoreDeps, state: GuildResumeState): Promise<boolean> {
    return this.restoreGuild(deps, state);
  }

  private async restoreGuild(deps: RestoreDeps, state: GuildResumeState): Promise<boolean> {
    const { client, audioManager, sessionManager } = deps;

    const voiceChannel = await client.channels.fetch(state.voiceChannelId).catch(() => null);
    if (!voiceChannel || typeof voiceChannel.isVoiceBased !== 'function' || !voiceChannel.isVoiceBased()) {
      logger.warn('Resume skipped: voice channel unavailable', {
        guildId: state.guildId,
        channelId: state.voiceChannelId,
      });
      return false;
    }

    // Don't resume PLAYBACK in a channel nobody is listening in — but always
    // rejoin it: the bot's presence must survive every deploy (the 2026-07-09
    // incident: deploy landed while the bot played to an emptied-out channel,
    // the old empty-channel skip left it evicted for good). channel.members
    // can't be trusted here: it only includes occupants whose GuildMember is
    // cached, and right after startup the member cache holds only the bot
    // (no GuildMembers intent) — so every human is filtered out and the
    // channel looks empty. Count voice states instead, excluding ourselves
    // and treating occupants with no cached member as humans: a rare resume
    // into a bots-only channel beats never resuming at all.
    const listeners = this.countListeners(client, voiceChannel);
    const channelEmpty = listeners === 0;
    if (channelEmpty) {
      logger.info('Resume: voice channel is empty, rejoining without playback', {
        guildId: state.guildId,
        channelId: state.voiceChannelId,
      });
    }

    // Presence-only snapshot (the bot was parked with nothing live), or a
    // playback snapshot downgraded because the room is empty: rejoin instead
    // of resuming a track. Radio only restarts when someone is listening.
    if (channelEmpty || !state.tracks || state.tracks.length === 0) {
      return this.restorePresence(deps, state, voiceChannel, { restartRadio: !channelEmpty });
    }

    const tracks = state.tracks.map((raw: any) => {
      const track = new Track(raw, raw.requestedBy);
      if (raw.addedAt) track.addedAt = new Date(raw.addedAt);
      track.retryCount = 0;
      return track;
    });

    const index =
      state.currentIndex >= 0 && state.currentIndex < tracks.length ? state.currentIndex : 0;

    const player = audioManager.getPlayer(state.guildId);
    player.queue.items = tracks;
    player.queue.currentIndex = index;
    player.queue.currentTrack = tracks[index];
    player.queue.setLoopMode(state.loopMode);

    const session = sessionManager.get(state.guildId);
    for (const bvid of state.history || []) session.addHistory(bvid);

    const joined = await player.joinVoiceChannel(voiceChannel);
    if (!joined) {
      logger.warn('Resume skipped: failed to rejoin voice channel', {
        guildId: state.guildId,
        channelId: state.voiceChannelId,
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
        await deps.radioService.resume(state.guildId, state.textChannelId);
      } catch (err: unknown) {
        logger.warn('Resume: failed to re-arm radio mode', {
          guildId: state.guildId,
          error: (err as Error).message,
        });
      }
    }

    logger.info('Resumed playback after restart', {
      guildId: state.guildId,
      track: tracks[index].title,
      positionSeconds: state.positionSeconds,
      queueLength: tracks.length,
      wasPaused: state.isPaused,
      radioMode: state.radioMode,
    });

    this.announceResume(client, state.textChannelId, tracks[index]).catch((err: Error) => {
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
    state: GuildResumeState,
    voiceChannel: any,
    { restartRadio }: { restartRadio: boolean },
  ): Promise<boolean> {
    const player = deps.audioManager.getPlayer(state.guildId);
    const session = deps.sessionManager.get(state.guildId);
    for (const bvid of state.history || []) session.addHistory(bvid);

    const joined = await player.joinVoiceChannel(voiceChannel);
    if (!joined) {
      logger.warn('Presence resume skipped: failed to rejoin voice channel', {
        guildId: state.guildId,
        channelId: state.voiceChannelId,
      });
      return false;
    }

    if (restartRadio && state.radioMode && deps.radioService && state.textChannelId) {
      try {
        await deps.radioService.start(state.guildId, voiceChannel, state.textChannelId);
      } catch (err: unknown) {
        logger.warn('Presence resume: failed to restart radio mode', {
          guildId: state.guildId,
          error: (err as Error).message,
        });
      }
    }

    logger.info('Rejoined voice channel after restart (presence only)', {
      guildId: state.guildId,
      channelId: state.voiceChannelId,
      radioMode: state.radioMode,
    });
    return true;
  }

  /**
   * Number of listeners in the voice channel, derived from the guild's voice
   * state cache (populated by GUILD_CREATE even when member objects aren't).
   * Returns null when voice states are unavailable — callers should proceed
   * rather than skip.
   */
  private countListeners(client: any, voiceChannel: any): number | null {
    const voiceStates = voiceChannel.guild?.voiceStates?.cache;
    if (!voiceStates || typeof voiceStates.values !== 'function') return null;

    let listeners = 0;
    for (const voiceState of voiceStates.values()) {
      if (voiceState?.channelId !== voiceChannel.id) continue;
      if (voiceState.id === client.user?.id) continue; // our own stale pre-restart state
      if (voiceState.member?.user?.bot) continue;
      listeners++; // human, or occupant with no cached member — assume human
    }
    return listeners;
  }

  /**
   * The "基米永不灭～" revival announcement — shared by restart resume,
   * /annoying reconstruction (via restoreGuild), and the /annoying move-back.
   */
  async announceResume(client: any, textChannelId: string | null, track: any): Promise<void> {
    if (!textChannelId) return;
    const channel = await client.channels.fetch(textChannelId).catch(() => null);
    if (!channel || typeof channel.send !== 'function') return;
    await channel.send(`基米永不灭～ 重新部署完成，继续播放：**${track.title}**`);
  }
}

export = ResumeService;
