/**
 * Progress Tracker
 * Manages real-time progress updates for now playing embeds.
 * Tracker state is stored in GuildSession via SessionManager.
 */

const EmbedBuilders = require("./embeds");
const ButtonBuilders = require("./buttons");
const logger = require("../services/logger_service");

class ProgressTracker {
  /**
   * @param {Object} sessionManager - SessionManager instance
   */
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Start tracking progress for a guild
   * @param {string} guildId - Discord guild ID
   * @param {Object} message - Discord message to update
   * @param {Function} getPlayerState - Callback returning { currentTrack, isPlaying, currentTime, currentIndex, queueLength, loopMode, hasPrevious, hasNext }
   */
  startTracking(guildId, message, getPlayerState) {
    // Clear existing tracker
    this.stopTracking(guildId);

    const session = this.sessionManager.get(guildId);

    if (process.env.NODE_ENV === "test") {
      session.progressTracker = { message, guildId, interval: null, getPlayerState };
      this.updateProgress(guildId);
      return;
    }

    session.progressTracker = {
      message,
      guildId,
      getPlayerState,
      updating: false,
      interval: setInterval(() => {
        this.updateProgress(guildId);
      }, 1000),
    };

    logger.info("Started progress tracking", { guild: guildId });
  }

  /**
   * Stop tracking progress for a guild
   * @param {string} guildId - Discord guild ID
   */
  stopTracking(guildId) {
    const session = this.sessionManager.get(guildId);
    const tracker = session.progressTracker;
    if (tracker) {
      if (tracker.interval) clearInterval(tracker.interval);
      session.progressTracker = null;
      logger.info("Stopped progress tracking", { guild: guildId });
    }
  }

  /**
   * Update progress for a guild
   * @param {string} guildId - Discord guild ID
   */
  async updateProgress(guildId) {
    const session = this.sessionManager.get(guildId);
    const tracker = session.progressTracker;
    if (!tracker) return;

    // Skip if previous edit is still in flight (prevents rate limit queue buildup)
    if (tracker.updating) return;
    tracker.updating = true;

    try {
      const { message, getPlayerState } = tracker;

      // Get current player state via callback
      const playerState = getPlayerState();

      // Only update if currently playing
      const track = playerState.currentTrack;
      if (!playerState.isPlaying || !track) {
        return;
      }

      // Validate required properties to prevent embed builder crashes
      if (!track.title || track.duration == null) {
        return;
      }

      const currentTime = playerState.currentTime;

      // Create updated embed
      const updatedEmbed = EmbedBuilders.createNowPlayingEmbed(
        track,
        {
          currentTime,
          requestedBy: track.requestedBy,
          queuePosition: playerState.currentIndex + 1,
          totalQueue: playerState.queueLength,
          loopMode: playerState.loopMode,
        }
      );

      // Create updated buttons
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
      // Re-read tracker from session in case stopTracking was called during await
      const currentTracker = this.sessionManager.get(guildId).progressTracker;
      if (currentTracker) currentTracker.updating = false;
    }
  }

  /**
   * Cleanup all trackers
   */
  cleanup() {
    if (!this.sessionManager) return;
    for (const [guildId, session] of this.sessionManager.sessions) {
      if (session.progressTracker) {
        this.stopTracking(guildId);
      }
    }
    logger.info("Progress tracker cleanup completed");
  }
}

module.exports = ProgressTracker;
