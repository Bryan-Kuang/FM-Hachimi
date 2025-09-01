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
        const playSuccess = await player.playNext();
        if (!playSuccess) {
          return {
            success: false,
            error: "Failed to start playback",
            suggestion: "Make sure FFmpeg is installed on the system.",
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

    if (!player.hasNext && player.loopMode === "none") {
      return {
        success: false,
        error: "No next track in queue",
        suggestion: "Add more tracks or enable loop mode.",
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

    if (!player.hasPrevious && player.loopMode === "none") {
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
  stopPlayback(guildId) {
    const player = this.getPlayer(guildId);
    player.leaveVoiceChannel();

    return {
      success: true,
      message: "Stopped playback and left voice channel",
    };
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

      case "queue_clear":
        return this.clearQueue(guildId);

      case "queue_shuffle":
        return this.shuffleQueue(guildId);

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

      default:
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
