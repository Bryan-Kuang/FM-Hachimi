/**
 * Audio Manager
 * Manages multiple audio players across different Discord guilds.
 * Player instances are stored in GuildSession via SessionManager.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import SessionManager = require('./session_manager');
import * as logger from '../services/logger_service';
import { emitPlaybackStage, type PlaybackStageReporter } from '../playback/stage_feedback';
import { extractAndJoin } from '../playback/extract_join';

// Discord interaction shapes used by this manager.
// Full discord.js types are applied at the command layer (Task 13); keeping
// these interfaces thin avoids importing the whole discord.js namespace here.
interface PlayInteraction {
  guild: { id: string; name: string } | null;
  member: { voice: { channel: unknown } } | null;
  user: { id: string; username: string };
}

// Return shapes
interface PlayResult {
  success: boolean;
  error?: string;
  suggestion?: string;
  keepConnection?: boolean;
  track?: unknown;
  player?: unknown;
  isNewTrack?: boolean;
}

interface PlayBilibiliOptions {
  onStage?: PlaybackStageReporter;
}

interface ActionResult {
  success: boolean;
  error?: string;
  suggestion?: string;
  player?: unknown;
  newTrack?: unknown;
  mode?: string;
  showMenu?: boolean;
  showQueue?: boolean;
  message?: string;
}

interface QueueResult {
  queue: unknown[];
  currentTrack: unknown;
  state: unknown;
}

interface StatsResult {
  totalGuilds: number;
  activeConnections: number;
  totalTracks: number;
  playingGuilds: number;
}

import AudioPlayer = require('../audio/audio_player');

class AudioManager {
  private sessionManager: SessionManager;
  private extractor: any;
  private youtubeExtractor: any;

  constructor(sessionManager: SessionManager, extractor?: any, youtubeExtractor?: any) {
    this.sessionManager = sessionManager;
    this.extractor = extractor ?? null;
    this.youtubeExtractor = youtubeExtractor ?? null;
  }

  /**
   * Set the Bilibili extractor instance.
   */
  setExtractor(extractor: any): void {
    this.extractor = extractor;
    logger.info('Bilibili extractor attached to audio manager');
  }

  /**
   * Set the YouTube extractor used for refreshing stale YouTube stream URLs.
   */
  setYouTubeExtractor(extractor: any): void {
    this.youtubeExtractor = extractor;
    logger.info('YouTube extractor attached to audio manager');
  }

  /**
   * Get the Bilibili extractor instance.
   */
  getExtractor(): any {
    return this.extractor;
  }

  prewarmPlaybackTools(extraExtractors: any[] = []): void {
    const tasks: Array<Promise<unknown>> = [];

    if (this.extractor?.prewarm) {
      tasks.push(this.extractor.prewarm());
    } else if (this.extractor?.checkYtDlpAvailability) {
      tasks.push(this.extractor.checkYtDlpAvailability());
    }

    for (const extractor of extraExtractors) {
      if (extractor?.prewarm) {
        tasks.push(extractor.prewarm());
      }
    }

    tasks.push(AudioPlayer.prewarmFFmpeg());

    Promise.allSettled(tasks).then((results) => {
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length > 0) {
        logger.warn('Playback tool prewarm completed with failures', {
          failedCount: failed.length,
          totalCount: results.length,
        });
        return;
      }

      logger.info('Playback tool prewarm completed', { totalCount: results.length });
    });
  }

  /**
   * Get or create audio player for a guild.
   */
  getPlayer(guildId: string): any {
    const session = this.sessionManager.get(guildId);
    if (!session.player) {
      // CRITICAL: must forward the extractor so retryCurrentTrack() and
      // playCurrentTrack()'s URL-refresh branches in AudioPlayer are reachable.
      // Without this, `this.extractor` is null and every `if (this.extractor)`
      // silently falls through — a stale audioUrl gets replayed forever on
      // CDN failures (prod 2026-04-22: 600 × 403 with zero URL refreshes).
      session.player = new AudioPlayer(this.extractor, { youtube: this.youtubeExtractor });
      logger.info('Created new audio player for guild', { guildId });
    }
    return session.player;
  }

  /**
   * Remove audio player for a guild.
   */
  removePlayer(guildId: string): void {
    const session = this.sessionManager.get(guildId);
    if (session.player) {
      session.player.leaveVoiceChannel();
      session.player = null;
      logger.info('Removed audio player for guild', { guildId });
    }
  }

  /**
   * Play Bilibili video in a voice channel.
   */
  async playBilibiliVideo(interaction: PlayInteraction, url: string, options: PlayBilibiliOptions = {}): Promise<PlayResult> {
    try {
      const guild = interaction.guild;
      if (!guild) {
        return { success: false, error: 'Not in a guild', suggestion: 'This command can only be used in a server.' };
      }
      const guildId = guild.id;
      const voiceChannel = interaction.member?.voice?.channel;
      const user = interaction.user;

      if (!voiceChannel) {
        return {
          success: false,
          error: 'User not in voice channel',
          suggestion: 'Join a voice channel and try again.',
        };
      }

      if (!this.extractor) {
        return {
          success: false,
          error: 'Audio extractor not available',
          suggestion: 'Please wait for the bot to fully initialize.',
        };
      }

      // Get or create player for this guild
      const player = this.getPlayer(guildId);
      const reportStage = (
        stage: Parameters<typeof emitPlaybackStage>[1],
        details?: Parameters<typeof emitPlaybackStage>[2],
      ) => {
        emitPlaybackStage(options.onStage, stage, details);
      };

      // Extract video information
      logger.info('Extracting Bilibili video for playback', {
        url,
        user: user.username,
        guild: guild.name,
      });

      // Concurrent extract + voice-join (shared with the YouTube path).
      const ej = await extractAndJoin({
        player,
        voiceChannel: voiceChannel as { id?: string } & Record<string, unknown>,
        onStage: options.onStage,
        logLabel: 'Bilibili direct playback timing',
        logContext: { guild: guild.name, guildId, user: user.username },
        extract: (onStage) => (this.extractor as any).extractAudio(url, { onStage }),
      });

      if (!ej.ok) {
        if (ej.failedStage === 'extraction') {
          return {
            success: false,
            error: ej.error,
            suggestion: 'Please check the URL and try again. If the problem persists, the video might be private or region-locked.',
          };
        }
        return {
          success: false,
          error: 'Failed to join voice channel',
          suggestion: 'Make sure the bot has permission to join and speak in the voice channel.',
        };
      }

      const { videoData, timings, logTiming } = ej;

      // Add to queue
      const queueStartedAt = Date.now();
      const track = player.addToQueue(videoData, `<@${user.id}>`);
      timings.queueAddMs = Date.now() - queueStartedAt;
      reportStage('queued');

      // Start playing if nothing is currently playing. playNext() resumes from
      // the newest track when a prior queue ended, so no special-casing here.
      if (!player.isPlaying && !player.isPaused) {
        try {
          const playbackStartedAt = Date.now();
          reportStage('starting_playback');
          const playSuccess = await player.playNext();
          timings.playbackStartMs = Date.now() - playbackStartedAt;

          if (!playSuccess) {
            reportStage('failed', { stage: 'playbackStart' });
            logTiming(false, { failedStage: 'playbackStart' });
            return {
              success: false,
              error: 'Failed to start playback',
              suggestion: 'Check if FFmpeg is installed and the video URL is accessible.',
              keepConnection: true,
            };
          }
          reportStage('playing');
        } catch (playError: unknown) {
          const msg = (playError as Error).message;
          logger.error('Playback error occurred', {
            error: msg,
            track: track.title,
            guild: guildId,
          });

          reportStage('failed', { stage: 'playbackStart' });
          logTiming(false, { failedStage: 'playbackStart' });
          return {
            success: false,
            error: msg,
            suggestion: this.getErrorSuggestion(msg),
            keepConnection: true,
            track,
            player: player.getState(),
          };
        }
      }

      if (player.isPlaying || player.isPaused) {
        reportStage('playing');
      }
      logTiming(true);
      return {
        success: true,
        track,
        player: player.getState(),
        isNewTrack: !player.isPlaying && !player.isPaused,
      };
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('Failed to play Bilibili video', {
        url,
        user: interaction.user.username,
        error: err.message,
        stack: err.stack,
      });

      return {
        success: false,
        error: err.message,
        suggestion: 'Please check the URL and try again. If the problem persists, the video might be private or region-locked.',
      };
    }
  }

  /**
   * Pause playback in a guild.
   */
  pausePlayback(guildId: string): ActionResult {
    const player = this.getPlayer(guildId);

    if (!player.isPlaying) {
      return {
        success: false,
        error: 'Nothing is currently playing',
        suggestion: 'Use /play to start playing a video.',
      };
    }

    const success = player.pause();
    return { success, player: player.getState() };
  }

  /**
   * Resume playback in a guild.
   */
  resumePlayback(guildId: string): ActionResult {
    const player = this.getPlayer(guildId);

    if (!player.isPaused) {
      return {
        success: false,
        error: 'Playback is not paused',
        suggestion: 'Audio is either already playing or stopped.',
      };
    }

    const success = player.resume();
    return { success, player: player.getState() };
  }

  /**
   * Skip to next track in a guild.
   */
  async skipTrack(guildId: string): Promise<ActionResult> {
    const player = this.getPlayer(guildId);

    if (!player.currentTrack) {
      return {
        success: false,
        error: 'No track is currently playing',
        suggestion: 'Add tracks to the queue using /play.',
      };
    }

    if (!player.radioMode && !player.canSkip()) {
      return {
        success: false,
        error: 'No next track in queue',
        suggestion: 'This is the last track in the queue with no loop enabled.',
      };
    }

    const success = await player.skip();
    return { success, player: player.getState(), newTrack: player.currentTrack };
  }

  /**
   * Go to previous track in a guild.
   */
  async previousTrack(guildId: string): Promise<ActionResult> {
    const player = this.getPlayer(guildId);

    if (!player.currentTrack) {
      return {
        success: false,
        error: 'No track is currently playing',
        suggestion: 'Add tracks to the queue using /play.',
      };
    }

    if (!player.canGoBack()) {
      return {
        success: false,
        error: 'No previous track in queue',
        suggestion: 'This is the first track in the queue.',
      };
    }

    const success = await player.previous();
    return { success, player: player.getState(), newTrack: player.currentTrack };
  }

  /**
   * Get queue for a guild.
   */
  getQueue(guildId: string): QueueResult {
    const player = this.getPlayer(guildId);
    return {
      queue: player.getFormattedQueue(),
      currentTrack: player.currentTrack,
      state: player.getState(),
    };
  }

  /**
   * Clear queue for a guild.
   */
  clearQueue(guildId: string): ActionResult {
    const player = this.getPlayer(guildId);
    player.clearQueue();
    return { success: true, player: player.getState() };
  }

  /**
   * Shuffle queue for a guild.
   */
  shuffleQueue(guildId: string): ActionResult {
    const player = this.getPlayer(guildId);

    if (player.queue.length <= 1) {
      return {
        success: false,
        error: 'Not enough tracks to shuffle',
        suggestion: 'Add more tracks to the queue.',
      };
    }

    player.shuffleQueue();
    return { success: true, player: player.getState() };
  }

  /**
   * Remove a track from queue by index.
   */
  removeFromQueue(guildId: string, index: number): ActionResult {
    const player = this.getPlayer(guildId);

    if (player.queue.length === 0) {
      return {
        success: false,
        error: 'Queue is empty',
        suggestion: 'Add tracks to the queue first.',
      };
    }

    const success = player.removeFromQueue(index);

    if (!success) {
      return {
        success: false,
        error: 'Failed to remove track',
        suggestion: 'Check the track index and try again.',
      };
    }

    return { success: true, player: player.getState() };
  }

  /**
   * Set loop mode for a guild.
   */
  setLoopMode(guildId: string, mode: string): ActionResult {
    const player = this.getPlayer(guildId);
    player.setLoopMode(mode);
    return { success: true, mode, player: player.getState() };
  }

  /**
   * Stop playback and leave voice channel immediately.
   *
   * Semantics: /stop means "I'm done" — the bot disconnects right away rather
   * than lingering for the 60s idle timer. The idle timer is reserved for
   * natural end-of-queue cases. /pause is the command that keeps the bot in
   * the channel without playing.
   */
  async stopPlayback(guildId: string): Promise<ActionResult> {
    const player = this.getPlayer(guildId);
    // leaveVoiceChannel cancels any pending inactivity timer, stops the audio
    // player, clears queue/state, and synchronously calls _doDisconnect to tear
    // down the voice connection — so unlike player.stop() there is no 60s gap
    // during which a stale connection lingers in the player.
    player.leaveVoiceChannel();
    const state = player.getState();

    // We intentionally keep the player instance in the session map. The
    // AudioPlayer is reusable across play sessions; recreating it would lose
    // bound listeners. leaveVoiceChannel has already nulled voiceConnection,
    // so the next /play will create a fresh connection cleanly.

    return {
      success: true,
      message: 'Stopped playback and left voice channel',
      player: state,
    };
  }

  /**
   * Get a helpful error suggestion based on error message content.
   */
  getErrorSuggestion(errorMessage: string): string {
    logger.debug('Generating error suggestion for:', { errorMessage });

    if (
      errorMessage.includes('FFmpeg') ||
      errorMessage.includes('ffmpeg') ||
      errorMessage.includes('not installed') ||
      (errorMessage.includes('spawn') && errorMessage.includes('ENOENT'))
    ) {
      return 'FFmpeg is required for audio playback. Install it with: `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Ubuntu)';
    }

    if (
      errorMessage.includes('Failed to create audio resource') ||
      errorMessage.includes('audio resource creation failed')
    ) {
      return 'Audio processing failed. This is usually due to missing FFmpeg. Install it with: `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Ubuntu)';
    }

    if (errorMessage.includes('certificate') || errorMessage.includes('SSL')) {
      return 'SSL certificate issue. This may be a temporary network problem. Please try again in a few minutes.';
    }

    if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
      return 'Video not found. The video may be private, deleted, or region-locked.';
    }

    if (errorMessage.includes('timeout')) {
      return 'Connection timeout. Please check your internet connection and try again.';
    }

    if (
      (errorMessage.includes('voice') || errorMessage.includes('connection')) &&
      !errorMessage.includes('FFmpeg') &&
      !errorMessage.includes('audio resource')
    ) {
      return 'Voice connection issue. Make sure the bot has permission to join and speak in voice channels.';
    }

    return 'Please check the video URL and try again. If the problem persists, the video may not be accessible.';
  }

  /**
   * Get statistics for all players.
   */
  getStatistics(): StatsResult {
    const stats: StatsResult = {
      totalGuilds: this.sessionManager.size,
      activeConnections: 0,
      totalTracks: 0,
      playingGuilds: 0,
    };

    for (const [, session] of this.sessionManager.sessions) {
      const player = session.player;
      if (!player) continue;
      if (player.voiceConnection) {
        stats.activeConnections++;
      }
      if (player.isPlaying) {
        stats.playingGuilds++;
      }
      stats.totalTracks += player.queue.length;
    }

    return stats;
  }

  /**
   * Cleanup all resources via SessionManager.
   */
  cleanup(): void {
    this.sessionManager.cleanup();
    logger.info('Audio manager cleanup completed');
  }
}

export = AudioManager;
