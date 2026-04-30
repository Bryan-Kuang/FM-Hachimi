/**
 * Audio Manager
 * Manages multiple audio players across different Discord guilds.
 * Player instances are stored in GuildSession via SessionManager.
 */

// audio_player.js is not yet migrated — use any to avoid duplicating its
// entire interface here. Will be replaced with a proper type in Task 15.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

import SessionManager = require('./session_manager');
import * as logger from '../services/logger_service';

// Discord interaction shapes used by this manager.
// Full discord.js types are applied at the command layer (Task 13); keeping
// these interfaces thin avoids importing the whole discord.js namespace here.
interface PlayInteraction {
  guild: { id: string; name: string } | null;
  member: { voice: { channel: unknown } } | null;
  user: { id: string; username: string };
}

interface ButtonInteraction {
  customId: string;
  guild: { id: string } | null;
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

// audio_player.js is not yet migrated; use CJS import to avoid @no-var-requires
import AudioPlayer = require('../audio/audio_player');

class AudioManager {
  private sessionManager: SessionManager;
  private extractor: unknown;

  constructor(sessionManager: SessionManager, extractor?: unknown) {
    this.sessionManager = sessionManager;
    this.extractor = extractor ?? null;
  }

  /**
   * Set the Bilibili extractor instance.
   */
  setExtractor(extractor: unknown): void {
    this.extractor = extractor;
    logger.info('Bilibili extractor attached to audio manager');
  }

  /**
   * Get the Bilibili extractor instance.
   */
  getExtractor(): unknown {
    return this.extractor;
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
      session.player = new AudioPlayer(this.extractor);
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
  async playBilibiliVideo(interaction: PlayInteraction, url: string): Promise<PlayResult> {
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

      // Extract video information
      logger.info('Extracting Bilibili video for playback', {
        url,
        user: user.username,
        guild: guild.name,
      });

      const videoData = await (this.extractor as any).extractAudio(url);

      // Join voice channel if not already connected
      if (
        !player.voiceConnection ||
        player.voiceConnection.joinConfig.channelId !== (voiceChannel as any).id
      ) {
        const joinSuccess = await player.joinVoiceChannel(voiceChannel);
        if (!joinSuccess) {
          return {
            success: false,
            error: 'Failed to join voice channel',
            suggestion: 'Make sure the bot has permission to join and speak in the voice channel.',
          };
        }
      }

      // Add to queue
      const track = player.addToQueue(videoData, `<@${user.id}>`);

      // Start playing if nothing is currently playing
      if (!player.isPlaying && !player.isPaused) {
        try {
          let playSuccess: boolean;
          // Fix: if queue ended and a new song is added, start from the newest song
          if (player.currentTrack === null && player.queue.length > 0) {
            player.currentIndex = player.queue.length - 1;
            player.currentTrack = player.queue[player.currentIndex];
            playSuccess = await player.playCurrentTrack();
          } else {
            playSuccess = await player.playNext();
          }

          if (!playSuccess) {
            return {
              success: false,
              error: 'Failed to start playback',
              suggestion: 'Check if FFmpeg is installed and the video URL is accessible.',
              keepConnection: true,
            };
          }
        } catch (playError: unknown) {
          const msg = (playError as Error).message;
          logger.error('Playback error occurred', {
            error: msg,
            track: track.title,
            guild: guildId,
          });

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

    if (!player.canSkip()) {
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
   * Handle Discord button interactions.
   */
  async handleButtonInteraction(interaction: ButtonInteraction): Promise<ActionResult> {
    const customId = interaction.customId;
    const guildId = interaction.guild?.id;

    if (!guildId) {
      return { success: false, error: 'Not in a guild' };
    }

    switch (customId) {
      case 'pause_resume': {
        const player = this.getPlayer(guildId);
        if (player.isPlaying) {
          return this.pausePlayback(guildId);
        } else if (player.isPaused) {
          return this.resumePlayback(guildId);
        }
        return { success: false, error: 'No audio to pause/resume' };
      }

      case 'skip':
        return this.skipTrack(guildId);

      case 'prev':
        return this.previousTrack(guildId);

      case 'stop':
        return this.stopPlayback(guildId);

      case 'queue_clear':
        return this.clearQueue(guildId);

      case 'queue_shuffle':
        return this.shuffleQueue(guildId);

      case 'loop':
        return { success: true, showMenu: true };

      case 'queue_loop': {
        const player = this.getPlayer(guildId);
        const currentMode: string = player.loopMode;
        const nextMode =
          currentMode === 'none' ? 'queue' :
          currentMode === 'queue' ? 'track' : 'none';
        return this.setLoopMode(guildId, nextMode);
      }

      case 'queue_remove':
        return { success: true, showMenu: true };

      case 'queue':
        return { success: true, showQueue: true };

      default:
        if (customId.startsWith('queue_delete_')) {
          const index = parseInt(customId.split('_')[2], 10);
          if (!isNaN(index)) {
            return this.removeFromQueue(guildId, index);
          }
        }
        return { success: false, error: 'Unknown button interaction' };
    }
  }

  /**
   * Cleanup all resources via SessionManager.
   */
  cleanup(): void {
    this.sessionManager.cleanup();
    logger.info('Audio manager cleanup completed');
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

export = AudioManager;
