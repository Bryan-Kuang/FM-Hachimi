/**
 * Progress Tracker
 * Manages real-time progress updates for now playing embeds
 */

const EmbedBuilders = require("../ui/embeds");
const ButtonBuilders = require("../ui/buttons");
const logger = require("../services/logger_service");

class ProgressTracker {
  constructor() {
    this.activeTrackers = new Map(); // guildId -> tracker info
  }

  /**
   * Start tracking progress for a guild
   * @param {string} guildId - Discord guild ID
   * @param {Object} message - Discord message to update
   * @param {Object} player - Audio player instance
   */
  startTracking(guildId, message, _playerState) {
    // Clear existing tracker
    this.stopTracking(guildId);

    if (process.env.NODE_ENV === "test") {
      this.activeTrackers.set(guildId, { message, guildId, interval: null });
      this.updateProgress(guildId);
      return;
    }

    const tracker = {
      message,
      guildId,
      updating: false,
      interval: setInterval(() => {
        this.updateProgress(guildId);
      }, 1000),
    };

    this.activeTrackers.set(guildId, tracker);

    logger.info("Started progress tracking", { guild: guildId });
  }

  /**
   * Stop tracking progress for a guild
   * @param {string} guildId - Discord guild ID
   */
  stopTracking(guildId) {
    const tracker = this.activeTrackers.get(guildId);
    if (tracker) {
      if (tracker.interval) clearInterval(tracker.interval);
      this.activeTrackers.delete(guildId);
      logger.info("Stopped progress tracking", { guild: guildId });
    }
  }

  /**
   * Update progress for a guild
   * @param {string} guildId - Discord guild ID
   */
  async updateProgress(guildId) {
    const tracker = this.activeTrackers.get(guildId);
    if (!tracker) return;

    // Skip if previous edit is still in flight (prevents rate limit queue buildup)
    if (tracker.updating) return;
    tracker.updating = true;

    try {
      const { message, guildId } = tracker;

      // Get current player state from AudioManager
      const AudioManager = require("../audio/manager");
      const player = AudioManager.getPlayer(guildId);

      // Only update if currently playing
      const track = player.currentTrack;
      if (!player.isPlaying || !track) {
        return;
      }

      // Validate required properties to prevent embed builder crashes
      if (!track.title || track.duration == null) {
        return;
      }

      const currentTime = player.getCurrentTime();

      // Create updated embed
      const updatedEmbed = EmbedBuilders.createNowPlayingEmbed(
        track,
        {
          currentTime,
          requestedBy: track.requestedBy,
          queuePosition: player.currentIndex + 1,
          totalQueue: player.queue.length,
          loopMode: player.loopMode,
        }
      );

      // Create updated buttons
      const playerState = player.getState();
      const controlButtons = ButtonBuilders.createPlaybackControls({
        isPlaying: playerState.isPlaying,
        hasQueue: playerState.queueLength > 0,
        canGoBack: playerState.hasPrevious,
        canSkip: playerState.hasNext,
        loopMode: playerState.loopMode,
      });

      // Update message
      await message.edit({
        embeds: [updatedEmbed],
        components: controlButtons,
      });

      logger.debug("Progress updated", {
        guild: guildId,
        currentTime: Math.floor(currentTime),
        duration: track.duration,
      });
    } catch (error) {
      logger.error("Failed to update progress", {
        guild: guildId,
        error: error.message,
      });

      // Stop tracking if message no longer exists or is inaccessible
      if (error.code === 10008 || error.code === 50001) {
        this.stopTracking(guildId);
      }
    } finally {
      if (tracker) tracker.updating = false;
    }
  }

  /**
   * Cleanup all trackers
   */
  cleanup() {
    for (const [guildId] of this.activeTrackers) {
      this.stopTracking(guildId);
    }
    logger.info("Progress tracker cleanup completed");
  }
}

// Export singleton instance
const progressTracker = new ProgressTracker();
module.exports = progressTracker;
