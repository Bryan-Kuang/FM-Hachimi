/**
 * Audio Player
 * Orchestrates voice connections, FFmpeg audio streaming, and playback state.
 * Queue bookkeeping is delegated to the Queue class.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  joinVoiceChannel as djsJoinVoiceChannel,
  getVoiceConnection,
} from '@discordjs/voice';
import type {
  AudioPlayer as DjsAudioPlayer,
  AudioResource,
  VoiceConnection,
} from '@discordjs/voice';
import { spawn, type ChildProcess } from 'child_process';
import * as logger from '../services/logger_service';
import config = require('../config/config');
import Queue from './queue';
import type Track from '../models/track';
import * as cdnRetry from './cdn_retry';

/** Minimal voice-channel shape — avoids importing discord.js types here. */
interface VoiceChannelLike {
  id: string;
  name?: string;
  guild: { id: string; voiceAdapterCreator: any };
}

/** Extractor duck-type: only the methods AudioPlayer calls. */
interface ExtractorLike {
  getAudioStreamUrl(normalizedUrl: string): Promise<string>;
}

type TrackPlatform = 'bilibili' | 'youtube';
type PlatformExtractors = Partial<Record<TrackPlatform, ExtractorLike | null>>;

let ffmpegAvailabilityPromise: Promise<void> | null = null;

function checkFFmpegAvailability(): Promise<void> {
  if (ffmpegAvailabilityPromise) {
    return ffmpegAvailabilityPromise;
  }

  ffmpegAvailabilityPromise = new Promise<void>((resolve, reject) => {
    const ffmpegCheck = spawn('ffmpeg', ['-version']);
    ffmpegCheck.on('error', (error) => {
      logger.error('FFmpeg not available', { error: error.message });
      reject(new Error('FFmpeg is not installed. Please install FFmpeg to enable audio playback.'));
    });
    ffmpegCheck.on('close', (code) => {
      if (code !== 0) reject(new Error('FFmpeg check failed'));
      else resolve();
    });
  }).catch((error) => {
    ffmpegAvailabilityPromise = null;
    throw error;
  });

  return ffmpegAvailabilityPromise;
}

class AudioPlayer {
  // ── Dependencies ─────────────────────────────────────────────────────
  extractor: ExtractorLike | null;
  private extractorsByPlatform: PlatformExtractors;

  // ── Queue (delegated) ────────────────────────────────────────────────
  readonly queue: Queue;

  // ── Discord voice ────────────────────────────────────────────────────
  audioPlayer: DjsAudioPlayer;
  voiceConnection: VoiceConnection | null;
  currentGuild: string | null;

  // ── Playback state ───────────────────────────────────────────────────
  isPlaying: boolean;
  isPaused: boolean;
  volume: number;
  startTime: number | null;
  isIdle: boolean;

  // Pause-aware progress accounting
  _accumulatedPlayMs: number;
  _currentPlayStartedAt: number | null;

  // FFmpeg
  ffmpegProcess: ChildProcess | null;
  _ffmpegChecked: boolean;

  // Flags
  _cdnRetryPending: boolean;
  _manualNavigating: boolean;
  _trackEndInProgress: boolean;
  _inactivityTimer: ReturnType<typeof setTimeout> | null;

  // Radio mode: when set, this hook decides advancement on track end / skip.
  // It returns true if it took over (loaded + played the next track), in which
  // case AudioPlayer skips its normal queue-advance logic. RadioService owns it.
  advanceHook: (() => Promise<boolean>) | null;
  radioMode: boolean;

  constructor(extractor?: ExtractorLike | null, platformExtractors: PlatformExtractors = {}) {
    this.extractor = extractor ?? platformExtractors.bilibili ?? null;
    this.extractorsByPlatform = {
      bilibili: this.extractor,
      ...platformExtractors,
    };
    this.audioPlayer = createAudioPlayer();
    this.voiceConnection = null;
    this.queue = new Queue();
    this.currentGuild = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.volume = 0.5;
    this.startTime = null;
    this.isIdle = false;

    this._accumulatedPlayMs = 0;
    this._currentPlayStartedAt = null;

    this.ffmpegProcess = null;
    this._ffmpegChecked = false;

    this._cdnRetryPending = false;
    this._manualNavigating = false;
    this._trackEndInProgress = false;
    this._inactivityTimer = null;

    this.advanceHook = null;
    this.radioMode = false;

    this.setupAudioPlayerEvents();
  }

  static prewarmFFmpeg(): Promise<void> {
    return checkFFmpegAvailability();
  }

  setExtractorForPlatform(platform: TrackPlatform, extractor: ExtractorLike | null): void {
    this.extractorsByPlatform[platform] = extractor;
    if (platform === 'bilibili') {
      this.extractor = extractor;
    }
  }

  private inferTrackPlatform(track: Track | null): TrackPlatform | null {
    if (!track) return null;
    if (track.platform === 'bilibili' || track.platform === 'youtube') {
      return track.platform;
    }

    const candidates = [track.normalizedUrl, track.originalUrl, track.url]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());

    if (candidates.some((value) => value.includes('youtube.com') || value.includes('youtu.be'))) {
      return 'youtube';
    }
    if (candidates.some((value) => value.includes('bilibili.com') || value.includes('b23.tv'))) {
      return 'bilibili';
    }
    if (track.bvid) {
      return 'bilibili';
    }

    return null;
  }

  private getRefreshExtractor(track: Track | null): ExtractorLike | null {
    const platform = this.inferTrackPlatform(track);
    if (platform && this.extractorsByPlatform[platform]) {
      return this.extractorsByPlatform[platform] ?? null;
    }

    // Legacy fallback for old Bilibili tracks that predate platform metadata.
    if (!platform || platform === 'bilibili') {
      return this.extractor;
    }

    return null;
  }

  // ── Convenience accessors (keep existing API surface) ────────────────
  // These proxy to the Queue so that external code (AudioManager, services)
  // can still read `player.currentTrack`, `player.currentIndex`, etc.

  get currentTrack(): Track | null { return this.queue.currentTrack; }
  set currentTrack(t: Track | null) { this.queue.currentTrack = t; }

  get currentIndex(): number { return this.queue.currentIndex; }
  set currentIndex(i: number) { this.queue.currentIndex = i; }

  get loopMode(): string { return this.queue.loopMode; }

  // ── Audio player events ──────────────────────────────────────────────

  setupAudioPlayerEvents(): void {
    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      this.isPlaying = true;
      this.isPaused = false;
      this.startTime = Date.now();
      if (this._currentPlayStartedAt === null) {
        this._currentPlayStartedAt = Date.now();
      }
      logger.info('Audio player started playing', {
        track: this.currentTrack?.title,
        guild: this.currentGuild,
        voiceConnectionStatus: this.voiceConnection?.state?.status,
        subscribed: (this.voiceConnection?.state as any)?.subscription !== null,
      });
    });

    this.audioPlayer.on(AudioPlayerStatus.Paused, () => {
      this.isPlaying = false;
      this.isPaused = true;
      if (this._currentPlayStartedAt !== null) {
        this._accumulatedPlayMs += Date.now() - this._currentPlayStartedAt;
        this._currentPlayStartedAt = null;
      }
      logger.info('Audio player paused', {
        track: this.currentTrack?.title,
        guild: this.currentGuild,
      });
    });

    this.audioPlayer.on(AudioPlayerStatus.AutoPaused, () => {
      if (this._currentPlayStartedAt !== null) {
        this._accumulatedPlayMs += Date.now() - this._currentPlayStartedAt;
        this._currentPlayStartedAt = null;
      }
      logger.debug('Audio player auto-paused (buffer underrun); progress clock frozen', {
        track: this.currentTrack?.title,
        guild: this.currentGuild,
      });
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => this._handleIdle());

    this.audioPlayer.on('error', (error) => {
      logger.error('Audio player error', {
        error: error.message,
        track: this.currentTrack?.title,
        guild: this.currentGuild,
      });
      this.cleanupFFmpegProcess();
      this.handleTrackEnd();
    });
  }

  // ── Idle handler ─────────────────────────────────────────────────────

  _handleIdle(): void {
    this.isPlaying = false;
    this.cleanupFFmpegProcess();

    const actualPlaybackDuration = this.startTime ? Date.now() - this.startTime : 0;

    if (this._manualNavigating) {
      logger.info('Idle event ignored during manual navigation', {
        track: this.currentTrack?.title,
        guild: this.currentGuild,
      });
      this._manualNavigating = false;
      return;
    }

    logger.info('Audio player became idle', {
      track: this.currentTrack?.title,
      guild: this.currentGuild,
      resource: (this.audioPlayer.state as any).resource !== null,
      playbackDuration: (this.audioPlayer.state as any).playbackDuration,
      actualPlaybackDuration,
      trackDuration: this.currentTrack?.duration,
    });

    const isFullTrack = this.currentTrack?.duration
      ? actualPlaybackDuration >= (this.currentTrack.duration - 2) * 1000
      : actualPlaybackDuration > config.audio.fullTrackThresholdMs;

    if (isFullTrack && this._cdnRetryPending) {
      logger.info('Track reached end of duration, ignoring CDN failure flags', {
        track: this.currentTrack?.title,
        actualPlaybackDuration,
        trackDuration: this.currentTrack?.duration,
      });
      this._cdnRetryPending = false;
    }

    if (this._cdnRetryPending && this.currentTrack) {
      logger.info('CDN retry pending, retrying instead of skipping', {
        track: this.currentTrack?.title,
        actualPlaybackDuration,
      });
      this.retryCurrentTrack();
      return;
    }

    if (isFullTrack || actualPlaybackDuration > config.audio.shortPlaybackRetryThresholdMs) {
      logger.info('Track ended normally', {
        actualPlaybackDuration,
        trackDuration: this.currentTrack?.duration,
      });
      this.currentTrack?.resetRetry?.();
      this.handleTrackEnd();
    } else if (this.currentTrack) {
      logger.warn('Playback duration too short, retrying current track', {
        actualPlaybackDuration,
        track: this.currentTrack?.title,
        loopMode: this.loopMode,
      });
      if (this.loopMode === 'track') {
        this.currentTrack.resetRetry();
      }
      this.retryCurrentTrack();
    }
  }

  // ── Voice connection ─────────────────────────────────────────────────

  async joinVoiceChannel(voiceChannel: VoiceChannelLike, retryCount = 0): Promise<boolean> {
    const maxRetries = 3;

    try {
      logger.info('Attempting to join voice channel', {
        channelId: voiceChannel.id,
        channelName: voiceChannel.name,
        guildId: voiceChannel.guild.id,
        attempt: retryCount + 1,
        maxRetries,
      });

      const existingConnection = getVoiceConnection(voiceChannel.guild.id);
      if (existingConnection && existingConnection.joinConfig.channelId === voiceChannel.id) {
        const status = existingConnection.state.status;
        const reusable =
          status === VoiceConnectionStatus.Ready ||
          status === VoiceConnectionStatus.Signalling ||
          status === VoiceConnectionStatus.Connecting;
        if (reusable) {
          logger.info('Already connected to target voice channel', { status });
          this.voiceConnection = existingConnection;
          this.currentGuild = voiceChannel.guild.id;
          logger.info('Re-subscribing audio player to existing voice connection');
          this.voiceConnection.subscribe(this.audioPlayer);
          return true;
        }
        logger.warn('Existing voice connection is stale, recreating', { status, channelId: voiceChannel.id });
        try { existingConnection.destroy(); } catch (err: any) {
          logger.debug('destroy() on stale connection threw (likely already destroyed)', { error: err?.message });
        }
        this.voiceConnection = null;
      }

      this.voiceConnection = djsJoinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });

      this.currentGuild = voiceChannel.guild.id;
      await this.waitForVoiceConnection();
      this.voiceConnection!.subscribe(this.audioPlayer);

      logger.info('Successfully joined voice channel', {
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
      });
      return true;
    } catch (error: any) {
      logger.error('Failed to join voice channel', {
        error: error.message,
        channelId: voiceChannel?.id,
        attempt: retryCount + 1,
        maxRetries,
      });

      if (
        retryCount < maxRetries &&
        (error.message.includes('timeout') || error.message.includes('connection'))
      ) {
        const backoffMs = (retryCount + 1) * config.retry.voiceJoinBaseBackoffMs;
        logger.info('Retrying voice connection', {
          channelId: voiceChannel.id,
          nextAttempt: retryCount + 2,
          delay: backoffMs,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        return this.joinVoiceChannel(voiceChannel, retryCount + 1);
      }
      return false;
    }
  }

  async waitForVoiceConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.voiceConnection) {
        reject(new Error('No voice connection'));
        return;
      }
      if (this.voiceConnection.state.status === VoiceConnectionStatus.Ready) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        logger.error('Voice connection timeout', {
          currentStatus: this.voiceConnection?.state?.status,
          guild: this.currentGuild,
        });
        reject(new Error('Voice connection timeout'));
      }, config.voice.connectionTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        this.voiceConnection!.removeAllListeners(VoiceConnectionStatus.Ready);
        this.voiceConnection!.removeAllListeners(VoiceConnectionStatus.Disconnected);
        this.voiceConnection!.removeAllListeners(VoiceConnectionStatus.Destroyed);
      };

      this.voiceConnection.once(VoiceConnectionStatus.Ready, () => {
        logger.info('Voice connection is ready');
        cleanup();
        resolve();
      });

      this.voiceConnection.once(VoiceConnectionStatus.Disconnected, () => {
        logger.warn('Voice connection disconnected during wait');
        cleanup();
        reject(new Error('Voice connection disconnected'));
      });

      this.voiceConnection.once(VoiceConnectionStatus.Destroyed, () => {
        logger.warn('Voice connection destroyed during wait');
        cleanup();
        reject(new Error('Voice connection destroyed'));
      });
    });
  }

  // ── Queue pass-through (keeps the old public API) ────────────────────

  addToQueue(trackData: any, requestedBy: string): Track {
    return this.queue.add(trackData, requestedBy);
  }

  removeFromQueue(index: number): boolean {
    return this.queue.remove(index);
  }

  clearQueue(): void {
    this.queue.clear();
  }

  shuffleQueue(): void {
    this.queue.shuffle();
  }

  setLoopMode(mode: string): void {
    this.queue.setLoopMode(mode);
  }

  canSkip(): boolean {
    return this.queue.canSkip();
  }

  canGoBack(): boolean {
    return this.queue.canGoBack();
  }

  getFormattedQueue(): Array<Record<string, unknown>> {
    return this.queue.getFormatted();
  }

  // ── Playback orchestration ───────────────────────────────────────────

  async playNext(): Promise<boolean> {
    // If a previous queue ended (cursor cleared) but tracks remain — e.g. a new
    // track was appended after the last one finished — start from the most
    // recently added track instead of replaying items[0]. Adds reach this path
    // one at a time, so "newest" is the track the user just requested. Without
    // this, /play after a natural queue-end would silently replay the old first
    // track (previously patched only in the Bilibili path; now centralized so
    // YouTube gets the same correct behaviour).
    if (this.queue.currentTrack === null && this.queue.length > 0) {
      this.queue.currentIndex = this.queue.length - 1;
      this.queue.currentTrack = this.queue.items[this.queue.currentIndex];
      return this.playCurrentTrack();
    }
    const track = this.queue.peekNext();
    if (!track) {
      logger.info('Queue is empty, stopping playback');
      return false;
    }
    return this.playCurrentTrack();
  }

  async playTrack(index: number): Promise<boolean> {
    const track = this.queue.jumpTo(index);
    if (!track) {
      logger.warn('Invalid track index', { index, queueLength: this.queue.length });
      return false;
    }
    return this.playCurrentTrack();
  }

  async playCurrentTrack(): Promise<boolean> {
    if (!this.currentTrack) {
      logger.warn('No current track to play');
      return false;
    }
    this._cancelInactivityTimer();
    this.isIdle = false;

    if (!this.voiceConnection) {
      logger.warn('No voice connection available');
      return false;
    }

    try {
      logger.info('Starting to play track', {
        title: this.currentTrack.title || 'Unknown',
        audioUrl: this.currentTrack.audioUrl ? 'Available' : 'Missing',
        guild: this.currentGuild,
        voiceConnectionStatus: this.voiceConnection.state.status,
      });

      if (this.voiceConnection.state.status !== VoiceConnectionStatus.Ready) {
        logger.warn('Voice connection not ready, waiting...', {
          status: this.voiceConnection.state.status,
        });
        try {
          await this.waitForVoiceConnection();
        } catch (connectionError: any) {
          throw new Error(`Voice connection failed: ${connectionError.message}`);
        }
      }

      this.cleanupFFmpegProcess();

      // Re-extract audio URL if stale
      if (this.currentTrack.normalizedUrl && this.currentTrack.isExpired()) {
        try {
          const refreshExtractor = this.getRefreshExtractor(this.currentTrack);
          if (refreshExtractor) {
            const freshUrl = await refreshExtractor.getAudioStreamUrl(this.currentTrack.normalizedUrl);
            this.currentTrack.audioUrl = freshUrl;
            this.currentTrack.extractedAt = new Date().toISOString();
            logger.info('Refreshed stale audio URL', {
              title: this.currentTrack.title,
              platform: this.inferTrackPlatform(this.currentTrack),
            });
          } else {
            logger.warn('No extractor configured for stale audio URL refresh', {
              title: this.currentTrack.title,
              platform: this.inferTrackPlatform(this.currentTrack),
            });
          }
        } catch (e: any) {
          logger.warn('Failed to refresh audio URL, using cached', { error: e.message });
        }
      }

      logger.debug('Creating audio resource for playback');
      const audioResource = await this.createAudioResource(this.currentTrack.audioUrl);
      if (!audioResource) {
        throw new Error('Failed to create audio resource - resource is null');
      }

      logger.debug('Playing audio resource');
      this._accumulatedPlayMs = 0;
      this._currentPlayStartedAt = null;
      this.audioPlayer.play(audioResource);

      await new Promise<void>((resolve) => setTimeout(resolve, config.voice.handoffWaitMs));
      this._manualNavigating = false;

      logger.info('Track playback initiated successfully', {
        title: this.currentTrack?.title || 'Unknown',
        playerStatus: this.audioPlayer.state.status,
        voiceConnectionStatus: this.voiceConnection?.state?.status,
        subscribed: (this.voiceConnection?.state as any)?.subscription !== null,
        subscriptionPlayerId:
          (this.voiceConnection?.state as any)?.subscription?.player === this.audioPlayer,
      });

      return true;
    } catch (error: any) {
      logger.error('Failed to play track', {
        title: this.currentTrack?.title || 'Unknown',
        error: error.message,
        stack: error.stack,
        voiceConnectionStatus: this.voiceConnection?.state?.status,
        playerStatus: this.audioPlayer.state.status,
      });
      throw error;
    }
  }

  // ── FFmpeg audio resource ────────────────────────────────────────────

  async createAudioResource(audioUrl: string): Promise<AudioResource | null> {
    // Lazy FFmpeg availability check
    if (!this._ffmpegChecked) {
      await checkFFmpegAvailability();
      this._ffmpegChecked = true;
      logger.info('FFmpeg availability confirmed');
    }

    return new Promise((resolve, reject) => {
      try {
        logger.info('Creating audio resource', {
          audioUrl: audioUrl ? 'Available' : 'Missing',
          guild: this.currentGuild,
        });

        // Build platform-aware FFmpeg args.
        // streamHeaders comes from the extractor — each platform provides its own
        // referer/UA so YouTube support is just "add a new extractor."
        const headers = this.currentTrack?.streamHeaders;
        const referer   = headers?.referer   || 'https://www.bilibili.com/';
        const userAgent = headers?.userAgent  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

        const ffmpegProcess = spawn('ffmpeg', [
          '-user_agent', userAgent,
          '-referer', referer,
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
          '-rw_timeout', '30000000',
          '-timeout', '30000000',
          '-headers', 'Connection: keep-alive',
          // Reduced from 10M/50M — Bilibili/YouTube serve well-known containers;
          // lower values shave 1-2s off first-byte latency.
          '-analyzeduration', '2000000',
          '-probesize', '5000000',
          '-fflags', '+genpts+discardcorrupt',
          '-i', audioUrl,
          // Removed loudnorm (buffered ~0.5-1s). Use simple volume filter instead.
          '-af', 'volume=1.0',
          '-f', 's16le',
          '-ar', '48000',
          '-ac', '2',
          '-vn',
          '-loglevel', 'warning',
          '-bufsize', '2048k',
          'pipe:1',
        ]);

        this.ffmpegProcess = ffmpegProcess;
        let stderr = '';
        let lastDataTime = Date.now();
        let isProcessActive = true;

        const activityMonitor = setInterval(() => {
          const timeSinceLastData = Date.now() - lastDataTime;
          const warningThreshold = config.audio.ffmpegInactiveWarningThreshold;
          const killThreshold = config.audio.ffmpegInactiveKillThreshold;

          if (timeSinceLastData > warningThreshold && isProcessActive) {
            logger.warn('FFmpeg process appears inactive, checking status', {
              timeSinceLastData, warningThreshold, killThreshold, guild: this.currentGuild,
            });

            if (timeSinceLastData > killThreshold) {
              logger.error(`FFmpeg process inactive for over ${killThreshold / 1000} seconds, terminating`, {
                guild: this.currentGuild, timeSinceLastData,
              });
              clearInterval(activityMonitor);

              if (ffmpegProcess.stdin && !ffmpegProcess.stdin.destroyed) {
                ffmpegProcess.stdin.end();
              }
              setTimeout(() => {
                if (!ffmpegProcess.killed) ffmpegProcess.kill('SIGKILL');
              }, config.audio.ffmpegHangForceKillMs);

              this._cdnRetryPending = true;
            }
          }
        }, config.audio.ffmpegActivityCheckInterval);

        ffmpegProcess.stderr!.on('data', (data: Buffer) => {
          stderr += data.toString();
          lastDataTime = Date.now();
        });

        ffmpegProcess.stdout!.on('data', () => {
          lastDataTime = Date.now();
        });

        ffmpegProcess.on('error', (error) => {
          clearInterval(activityMonitor);
          isProcessActive = false;
          logger.error('FFmpeg process error', {
            error: error.message, stderr: stderr.substring(0, 500), guild: this.currentGuild,
          });
          reject(new Error(`FFmpeg process error: ${error.message}`));
        });

        ffmpegProcess.on('close', (code) => {
          clearInterval(activityMonitor);
          isProcessActive = false;

          if (this.ffmpegProcess === ffmpegProcess) this.ffmpegProcess = null;

          if (code !== 0 && code !== null) {
            if (code === 137 || code === 143 || code === 15) {
              logger.info('FFmpeg process was gracefully terminated', { code, guild: this.currentGuild });
              return;
            }

            if (this.isCdnFailure(code, stderr)) {
              logger.warn('FFmpeg CDN failure detected, will retry', {
                code, stderr: stderr.substring(0, 500), guild: this.currentGuild, track: this.currentTrack?.title,
              });
              this._cdnRetryPending = true;
              return;
            }

            logger.error('FFmpeg process exited with error', {
              code, stderr: stderr.substring(0, 500), guild: this.currentGuild,
            });
            reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
            return;
          }
        });

        try {
          const resource = createAudioResource(ffmpegProcess.stdout!, {
            inputType: StreamType.Raw,
          });
          logger.info('Audio resource created successfully');
          resolve(resource);
        } catch (createError: any) {
          logger.error('Failed to create Discord audio resource', { error: createError.message });
          reject(new Error(`Failed to create audio resource: ${createError.message}`));
        }
      } catch (error: any) {
        logger.error('Failed to create audio resource', { error: error.message });
        reject(new Error(`Audio resource creation failed: ${error.message}`));
      }
    });
  }

  // ── Playback control ─────────────────────────────────────────────────

  pause(): boolean {
    if (this.audioPlayer.state.status === AudioPlayerStatus.Playing) {
      this.audioPlayer.pause();
      return true;
    }
    return false;
  }

  resume(): boolean {
    if (this.audioPlayer.state.status === AudioPlayerStatus.Paused) {
      this.audioPlayer.unpause();
      return true;
    }
    return false;
  }

  async skip(): Promise<boolean> {
    this._manualNavigating = true;
    this.startTime = null;
    this._accumulatedPlayMs = 0;
    this._currentPlayStartedAt = null;

    // Radio mode owns advancement: it loads + plays the next random track
    // itself. playCurrentTrack() (reached via the hook) clears
    // _manualNavigating once the new resource starts.
    if (this.advanceHook) {
      try {
        const handled = await this.advanceHook();
        if (handled) return true;
      } catch (error: any) {
        logger.error('Radio advance hook failed, falling back to queue', {
          error: error?.message,
          guild: this.currentGuild,
        });
      }
    }

    const { track, ended } = this.queue.advance();

    if (track && !ended) {
      if (this.voiceConnection) {
        return this.playCurrentTrack();
      }
      this._manualNavigating = false;
      return true;
    }

    // No more tracks — stop and go idle
    logger.info('No next track available, stopping playback', {
      currentIndex: this.currentIndex,
      queueLength: this.queue.length,
      loopMode: this.loopMode,
      guild: this.currentGuild,
    });
    if (this.audioPlayer) this.audioPlayer.stop();
    this.queue.currentTrack = null;
    this.queue.currentIndex = -1;
    this.isPlaying = false;
    this.isPaused = false;
    this._enterIdle();
    return false;
  }

  async previous(): Promise<boolean> {
    this._manualNavigating = true;
    this.startTime = null;
    this._accumulatedPlayMs = 0;
    this._currentPlayStartedAt = null;

    const track = this.queue.goBack();
    if (track) {
      logger.info('Previous track', {
        index: this.currentIndex,
        title: track.title,
        guild: this.currentGuild,
      });
      if (this.voiceConnection) {
        return this.playCurrentTrack();
      }
      this._manualNavigating = false;
      return true;
    }

    this._manualNavigating = false;
    return false;
  }

  async stop(): Promise<boolean> {
    try {
      this.cleanupFFmpegProcess();
      this._cdnRetryPending = false;
      this._manualNavigating = true;
      this._trackEndInProgress = false;

      this.audioPlayer.stop();

      this.queue.reset();
      this.isPlaying = false;
      this.isPaused = false;
      this.startTime = null;
      this._accumulatedPlayMs = 0;
      this._currentPlayStartedAt = null;

      this._enterIdle();

      logger.info('Playback stopped, will auto-disconnect if idle', { guild: this.currentGuild });
      return true;
    } catch (error: any) {
      logger.error('Failed to stop playback', { error: error.message, guild: this.currentGuild });
      return false;
    }
  }

  // ── Inactivity helpers ───────────────────────────────────────────────

  _startInactivityTimer(): void {
    this._cancelInactivityTimer();
    if (!this.voiceConnection) return;
    this._inactivityTimer = setTimeout(() => {
      logger.info('Auto-disconnecting due to inactivity', { guild: this.currentGuild });
      this._doDisconnect();
    }, config.voice.autoDisconnectIdleMs);
  }

  _cancelInactivityTimer(): void {
    if (this._inactivityTimer) {
      clearTimeout(this._inactivityTimer);
      this._inactivityTimer = null;
    }
  }

  _enterIdle(): void {
    this.isIdle = true;
    this._startInactivityTimer();
    logger.info('Player entered idle state', { guild: this.currentGuild });
  }

  _doDisconnect(): void {
    this._cancelInactivityTimer();
    if (this.voiceConnection) {
      try {
        this.voiceConnection.destroy();
      } catch (err: any) {
        logger.warn('voiceConnection.destroy() threw during disconnect', {
          guild: this.currentGuild,
          error: err?.message,
        });
      }
      this.voiceConnection = null;
    }
    const guildId = this.currentGuild;
    this.currentGuild = null;
    this.isIdle = false;
    logger.info('Disconnected from voice channel', { guild: guildId });
  }

  // ── Track end / retry ────────────────────────────────────────────────

  async handleTrackEnd(): Promise<void> {
    if (this._trackEndInProgress) {
      logger.warn('handleTrackEnd called while already in progress, ignoring', {
        track: this.currentTrack?.title,
        guild: this.currentGuild,
      });
      return;
    }
    this._trackEndInProgress = true;

    try {
      if (!this.currentTrack) {
        logger.warn('handleTrackEnd called but no current track available');
        return;
      }

      if (this.loopMode === 'track' && this.currentTrack) {
        this.currentTrack.resetRetry();
        logger.info('Track ended, looping current track', {
          title: this.currentTrack.title || 'Unknown',
          guild: this.currentGuild,
        });
        await this.playCurrentTrack();
      } else {
        logger.info('Track ended, attempting to skip to next', {
          title: this.currentTrack.title || 'Unknown',
          currentIndex: this.currentIndex,
          queueLength: this.queue.length,
          loopMode: this.loopMode,
          guild: this.currentGuild,
        });
        await this.skip();
      }
    } finally {
      this._trackEndInProgress = false;
    }
  }

  isCdnFailure(code: number, stderr: string): boolean {
    return cdnRetry.isCdnFailure(code, stderr);
  }

  async retryCurrentTrack(): Promise<void> {
    this._cdnRetryPending = false;

    if (!this.currentTrack) {
      logger.warn('No current track to retry');
      return;
    }

    const trackAtStart = this.currentTrack;

    logger.info('Retrying current track', {
      title: trackAtStart.title || 'Unknown',
      attempt: (trackAtStart.retryCount || 0) + 1,
    });

    trackAtStart.incrementRetry();
    if (trackAtStart.retryCount > 2) {
      logger.error('Max retry attempts reached, skipping track', { title: trackAtStart.title || 'Unknown' });
      this.handleTrackEnd();
      return;
    }

    const attempt = trackAtStart.retryCount;
    const backoffMs = this._computeCdnBackoffMs(attempt);
    if (backoffMs > 0) {
      logger.info('CDN retry backoff', { attempt, backoffMs, track: trackAtStart.title });
      await this._sleep(backoffMs);
    }

    if (this.currentTrack !== trackAtStart) {
      logger.info('Track changed during CDN backoff; aborting retry', { original: trackAtStart.title });
      return;
    }

    if (trackAtStart.normalizedUrl) {
      try {
        const refreshExtractor = this.getRefreshExtractor(trackAtStart);
        if (refreshExtractor) {
          const freshUrl = await refreshExtractor.getAudioStreamUrl(trackAtStart.normalizedUrl);
          if (this.currentTrack !== trackAtStart) {
            logger.info('Track changed during URL refresh; aborting retry', { original: trackAtStart.title });
            return;
          }
          trackAtStart.audioUrl = freshUrl;
          trackAtStart.extractedAt = new Date().toISOString();
          logger.info('Refreshed audio URL for retry', {
            title: trackAtStart.title,
            platform: this.inferTrackPlatform(trackAtStart),
          });
        } else {
          logger.warn('No extractor configured for retry URL refresh', {
            title: trackAtStart.title,
            platform: this.inferTrackPlatform(trackAtStart),
          });
        }
      } catch (e: any) {
        logger.warn('Failed to refresh audio URL for retry', { error: e.message });
      }
    }

    if (this.currentTrack !== trackAtStart) return;

    try {
      await this.playCurrentTrack();
    } catch (error: any) {
      logger.error('Retry failed', { error: error.message, title: this.currentTrack?.title });
      this.handleTrackEnd();
    }
  }

  _computeCdnBackoffMs(attempt: number): number {
    return cdnRetry.computeCdnBackoffMs(attempt, config.retry);
  }

  _sleep(ms: number): Promise<void> {
    return cdnRetry.sleep(ms);
  }

  // ── State / time ─────────────────────────────────────────────────────

  getCurrentTime(): number {
    if (!this.currentTrack) return 0;
    const liveMs = this._currentPlayStartedAt !== null
      ? Date.now() - this._currentPlayStartedAt
      : 0;
    const elapsed = (this._accumulatedPlayMs + liveMs) / 1000;
    return Math.min(elapsed, this.currentTrack.duration || 0);
  }

  getState(): Record<string, unknown> {
    return {
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      isIdle: this.isIdle,
      currentTrack: this.currentTrack,
      currentIndex: this.currentIndex,
      queue: this.queue.items,
      queueLength: this.queue.length,
      hasNext: this.canSkip(),
      hasPrevious: this.canGoBack(),
      loopMode: this.loopMode,
      radioMode: this.radioMode,
      volume: this.volume,
      connected: !!this.voiceConnection,
    };
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  leaveVoiceChannel(): void {
    this.cleanupFFmpegProcess();
    this._cancelInactivityTimer();
    this._cdnRetryPending = false;
    this._manualNavigating = true;
    this.audioPlayer.stop();

    this.queue.reset();
    this.isPlaying = false;
    this.isPaused = false;
    this.startTime = null;
    this._accumulatedPlayMs = 0;
    this._currentPlayStartedAt = null;

    this._doDisconnect();
    logger.info('Left voice channel');
  }

  cleanupFFmpegProcess(): void {
    if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
      const processToCleanup = this.ffmpegProcess;
      const pidToCleanup = processToCleanup.pid;

      logger.info('Cleaning up FFmpeg process', { pid: pidToCleanup, guild: this.currentGuild });
      this.ffmpegProcess = null;

      try {
        if (processToCleanup.stdin && !processToCleanup.stdin.destroyed) {
          processToCleanup.stdin.end();
        }
        processToCleanup.kill('SIGTERM');
        setTimeout(() => {
          if (processToCleanup && !processToCleanup.killed) {
            logger.warn('Force killing FFmpeg process', { pid: pidToCleanup });
            processToCleanup.kill('SIGKILL');
          }
        }, config.audio.killGracePeriodMs).unref();
      } catch (error: any) {
        logger.warn('Error cleaning up FFmpeg process', { error: error.message, pid: pidToCleanup });
      }
    }
  }
}

export = AudioPlayer;
