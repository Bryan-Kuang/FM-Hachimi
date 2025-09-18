/**
 * Audio Manager
 * Manages multiple audio players across different Discord guilds
 */

const AudioPlayer = require("./player");
const logger = require("../utils/logger");

class AudioManager {
  constructor() {
    this.players = new Map(); // Guild ID -> AudioPlayer
    this.extractor = null;
  }

  /**
   * Set the Bilibili extractor instance
   * @param {BilibiliExtractor} extractor - Bilibili extractor
   */
  setExtractor(extractor) {
    this.extractor = extractor;
    logger.info("Bilibili extractor attached to audio manager");
  }

  /**
   * Get the Bilibili extractor instance
   * @returns {BilibiliExtractor} - Bilibili extractor
   */
  getExtractor() {
    return this.extractor;
  }

  /**
   * Get or create audio player for a guild
   * @param {string} guildId - Discord guild ID
   * @returns {AudioPlayer} - Audio player instance
   */
  getPlayer(guildId) {
    if (!this.players.has(guildId)) {
      const player = new AudioPlayer();
      this.players.set(guildId, player);

      logger.info("Created new audio player for guild", { guildId });
    }

    return this.players.get(guildId);
  }

  /**
   * Remove audio player for a guild
   * @param {string} guildId - Discord guild ID
   */
  removePlayer(guildId) {
    const player = this.players.get(guildId);
    if (player) {
      player.leaveVoiceChannel();
      this.players.delete(guildId);

      logger.info("Removed audio player for guild", { guildId });
    }
  }

  /**
   * Play Bilibili video in a voice channel
   * @param {Object} interaction - Discord interaction
   * @param {string} url - Bilibili video URL
   * @returns {Promise<Object>} - Result object
   */
  async playBilibiliVideo(interaction, url) {
    try {
      const guildId = interaction.guild.id;
      const voiceChannel = interaction.member.voice.channel;
      const user = interaction.user;

      if (!voiceChannel) {
        return {
          success: false,
          error: "User not in voice channel",
          suggestion: "Join a voice channel and try again.",
        };
      }

      if (!this.extractor) {
        return {
          success: false,
          error: "Audio extractor not available",
          suggestion: "Please wait for the bot to fully initialize.",
        };
      }

      // Get or create player for this guild
      const player = this.getPlayer(guildId);

      // Extract video information
      logger.info("Extracting Bilibili video for playback", {
        url,
        user: user.username,
        guild: interaction.guild.name,
      });

      const videoData = await this.extractor.extractAudio(url);

      // Join voice channel if not already connected
      if (
        !player.voiceConnection ||
        player.voiceConnection.joinConfig.channelId !== voiceChannel.id
      ) {
        const joinSuccess = await player.joinVoiceChannel(voiceChannel);
        if (!joinSuccess) {
          return {
            success: false,
            error: "Failed to join voice channel",
            suggestion:
              "Make sure the bot has permission to join and speak in the voice channel.",
          };
        }
      }

      // Add to queue
      const track = player.addToQueue(
        videoData,
        user.displayName || user.username
      );

      // Start playing if nothing is currently playing
      if (!player.isPlaying && !player.isPaused) {
        try {
          let playSuccess;
          // 🔧 修复：如果队列结束后添加新歌，从最新歌曲开始
          if (player.currentTrack === null && player.queue.length > 0) {
            // 队列结束后添加的新歌，从最后一首（新添加的）开始
            player.currentIndex = player.queue.length - 1;
            player.currentTrack = player.queue[player.currentIndex];
            playSuccess = await player.playCurrentTrack();
          } else {
            playSuccess = await player.playNext();
          }

          if (!playSuccess) {
            return {
              success: false,
              error: "Failed to start playback",
              suggestion:
                "Check if FFmpeg is installed and the video URL is accessible.",
              keepConnection: true, // Stay in voice channel
            };
          }
        } catch (playError) {
          logger.error("Playback error occurred", {
            error: playError.message,
            track: track.title,
            guild: guildId,
          });

          // Don't disconnect, stay in channel and report detailed error
          return {
            success: false,
            error: playError.message,
            suggestion: this.getErrorSuggestion(playError.message),
            keepConnection: true,
            track, // Return track info even on failure
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
    } catch (error) {
      logger.error("Failed to play Bilibili video", {
        url,
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: error.message,
        suggestion:
          "Please check the URL and try again. If the problem persists, the video might be private or region-locked.",
      };
    }
  }

  /**
   * Pause playback in a guild
   * @param {string} guildId - Discord guild ID
   * @returns {Object} - Result object
   */
  pausePlayback(guildId) {
    const player = this.getPlayer(guildId);

    if (!player.isPlaying) {
      return {
        success: false,
        error: "Nothing is currently playing",
        suggestion: "Use /play to start playing a video.",
      };
    }

    const success = player.pause();
    return {
      success,
      player: player.getState(),
    };
  }

  /**
   * Resume playback in a guild
   * @param {string} guildId - Discord guild ID
   * @returns {Object} - Result object
   */
  resumePlayback(guildId) {
    const player = this.getPlayer(guildId);

    if (!player.isPaused) {
      return {
        success: false,
        error: "Playback is not paused",
        suggestion: "Audio is either already playing or stopped.",
      };
    }

    const success = player.resume();
    return {
      success,
      player: player.getState(),
    };
  }

  /**
   * Skip to next track in a guild
   * @param {string} guildId - Discord guild ID
   * @returns {Promise<Object>} - Result object
   */
  async skipTrack(guildId) {
    const player = this.getPlayer(guildId);

    if (!player.currentTrack) {
      return {
        success: false,
        error: "No track is currently playing",
        suggestion: "Add tracks to the queue using /play.",
      };
    }

    if (!player.canSkip()) {
      return {
        success: false,
        error: "No next track in queue",
        suggestion: "This is the last track in the queue with no loop enabled.",
      };
    }

    const success = await player.skip();
    return {
      success,
      player: player.getState(),
      newTrack: player.currentTrack,
    };
  }

  /**
   * Go to previous track in a guild
   * @param {string} guildId - Discord guild ID
   * @returns {Promise<Object>} - Result object
   */
  async previousTrack(guildId) {
    const player = this.getPlayer(guildId);

    if (!player.currentTrack) {
      return {
        success: false,
        error: "No track is currently playing",
        suggestion: "Add tracks to the queue using /play.",
      };
    }

    if (!player.canGoBack()) {
      return {
        success: false,
        error: "No previous track in queue",
        suggestion: "This is the first track in the queue.",
      };
    }

    const success = await player.previous();
    return {
      success,
      player: player.getState(),
      newTrack: player.currentTrack,
    };
  }

  /**
   * Get queue for a guild
   * @param {string} guildId - Discord guild ID
   * @returns {Object} - Queue information
   */
  getQueue(guildId) {
    const player = this.getPlayer(guildId);
    return {
      queue: player.getFormattedQueue(),
      currentTrack: player.currentTrack,
      state: player.getState(),
    };
  }

  /**
   * Clear queue for a guild
   * @param {string} guildId - Discord guild ID
   * @returns {Object} - Result object
   */
  clearQueue(guildId) {
    const player = this.getPlayer(guildId);
    player.clearQueue();

    return {
      success: true,
      player: player.getState(),
    };
  }

  /**
   * Shuffle queue for a guild
   * @param {string} guildId - Discord guild ID
   * @returns {Object} - Result object
   */
  shuffleQueue(guildId) {
    const player = this.getPlayer(guildId);

    if (player.queue.length <= 1) {
      return {
        success: false,
        error: "Not enough tracks to shuffle",
        suggestion: "Add more tracks to the queue.",
      };
    }

    player.shuffleQueue();

    return {
      success: true,
      player: player.getState(),
    };
  }

  /**
   * Remove a track from queue by index
   * @param {string} guildId - Discord guild ID
   * @param {number} index - Index of track to remove
   * @returns {Object} - Result object
   */
  removeFromQueue(guildId, index) {
    const player = this.getPlayer(guildId);

    if (player.queue.length === 0) {
      return {
        success: false,
        error: "Queue is empty",
        suggestion: "Add tracks to the queue first.",
      };
    }

    const success = player.removeFromQueue(index);

    if (!success) {
      return {
        success: false,
        error: "Failed to remove track",
        suggestion: "Check the track index and try again.",
      };
    }

    return {
      success: true,
      player: player.getState(),
    };
  }

  /**
   * Set loop mode for a guild
   * @param {string} guildId - Discord guild ID
   * @param {string} mode - Loop mode
   * @returns {Object} - Result object
   */
  setLoopMode(guildId, mode) {
    const player = this.getPlayer(guildId);
    player.setLoopMode(mode);

    return {
      success: true,
      mode,
      player: player.getState(),
    };
  }

  /**
   * Stop playback and leave voice channel
   * @param {string} guildId - Discord guild ID
   * @returns {Object} - Result object
   */
  async stopPlayback(guildId) {
    const player = this.getPlayer(guildId);
    const stopped = await player.stop();

    return {
      success: stopped,
      message: stopped
        ? "Stopped playback, cleared queue, and left voice channel"
        : "Failed to stop playback",
      player: player.getState(),
    };
  }

  /**
   * Get error suggestion based on error message
   * @param {string} errorMessage - The error message
   * @returns {string} - Helpful suggestion
   */
  getErrorSuggestion(errorMessage) {
    // Log the actual error message for debugging
    logger.debug("Generating error suggestion for:", { errorMessage });

    // Check for FFmpeg issues first (most specific)
    if (
      errorMessage.includes("FFmpeg") ||
      errorMessage.includes("ffmpeg") ||
      errorMessage.includes("not installed") ||
      (errorMessage.includes("spawn") && errorMessage.includes("ENOENT"))
    ) {
      return "FFmpeg is required for audio playback. Install it with: `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Ubuntu)";
    }

    // Check for audio resource creation issues
    if (
      errorMessage.includes("Failed to create audio resource") ||
      errorMessage.includes("audio resource creation failed")
    ) {
      return "Audio processing failed. This is usually due to missing FFmpeg. Install it with: `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Ubuntu)";
    }

    // Certificate/SSL issues
    if (errorMessage.includes("certificate") || errorMessage.includes("SSL")) {
      return "SSL certificate issue. This may be a temporary network problem. Please try again in a few minutes.";
    }

    // Video not found
    if (errorMessage.includes("404") || errorMessage.includes("Not Found")) {
      return "Video not found. The video may be private, deleted, or region-locked.";
    }

    // Network timeout
    if (errorMessage.includes("timeout")) {
      return "Connection timeout. Please check your internet connection and try again.";
    }

    // Voice connection issues (only if not related to FFmpeg)
    if (
      (errorMessage.includes("voice") || errorMessage.includes("connection")) &&
      !errorMessage.includes("FFmpeg") &&
      !errorMessage.includes("audio resource")
    ) {
      return "Voice connection issue. Make sure the bot has permission to join and speak in voice channels.";
    }

    // Default fallback
    return "Please check the video URL and try again. If the problem persists, the video may not be accessible.";
  }

  /**
   * Get statistics for all players
   * @returns {Object} - Statistics
   */
  getStatistics() {
    const stats = {
      totalGuilds: this.players.size,
      activeConnections: 0,
      totalTracks: 0,
      playingGuilds: 0,
    };

    for (const [guildId, player] of this.players) {
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
   * Handle button interactions
   * @param {Object} interaction - Discord button interaction
   * @returns {Promise<Object>} - Result object
   */
  async handleButtonInteraction(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guild.id;

    switch (customId) {
      case "pause_resume": {
        const player = this.getPlayer(guildId);
        if (player.isPlaying) {
          return this.pausePlayback(guildId);
        } else if (player.isPaused) {
          return this.resumePlayback(guildId);
        }
        return { success: false, error: "No audio to pause/resume" };
      }

      case "skip":
        return await this.skipTrack(guildId);

      case "prev":
        return await this.previousTrack(guildId);

      case "stop":
        return await this.stopPlayback(guildId);

      case "queue_clear":
        return this.clearQueue(guildId);

      case "queue_shuffle":
        return this.shuffleQueue(guildId);

      case "loop": {
        // Loop button now shows selection menu, handled in interactionCreate
        return { success: true, showMenu: true };
      }

      case "queue_loop": {
        const player = this.getPlayer(guildId);
        const currentMode = player.loopMode;
        const nextMode =
          currentMode === "none"
            ? "queue"
            : currentMode === "queue"
            ? "track"
            : "none";
        return this.setLoopMode(guildId, nextMode);
      }

      case "queue_remove": {
        // Queue remove button shows selection menu, handled in interactionCreate
        return { success: true, showMenu: true };
      }

      case "queue": {
        // Queue button shows queue information, handled in interactionCreate
        return { success: true, showQueue: true };
      }

      default:
        // Handle queue delete buttons (format: queue_delete_<index>)
        if (customId.startsWith("queue_delete_")) {
          const index = parseInt(customId.split("_")[2]);
          if (!isNaN(index)) {
            return this.removeFromQueue(guildId, index);
          }
        }
        return { success: false, error: "Unknown button interaction" };
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    for (const [guildId, player] of this.players) {
      player.leaveVoiceChannel();
    }
    this.players.clear();

    logger.info("Audio manager cleanup completed");
  }
}

// Export singleton instance
const audioManager = new AudioManager();
module.exports = audioManager;
