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
      session.progressTracker = {
        message,
        guildId,
        getPlayerState,
        stopped: false,
        timer: null,
      };
      this.updateProgress(guildId);
      return;
    }

    const tracker = {
      message,
      guildId,
      getPlayerState,
      stopped: false,
      timer: null,
    };
    session.progressTracker = tracker;

    // Self-clocking loop instead of setInterval:
    //   - A fixed setInterval(1000) fires regardless of whether the previous
    //     edit finished, so under Discord rate-limit backpressure we'd either
    //     queue edits (worsening the stall) or skip them via a guard flag
    //     (the progress bar would visibly slow down and drift further out of
    //     sync — issue #12).
    //   - Here we schedule the next tick AFTER the previous updateProgress
    //     settles, at `max(0, 1000 - elapsed)`. Fast path = 1s cadence; slow
    //     path = catch up immediately when Discord finally responds.
    const scheduleNext = (delay) => {
      if (tracker.stopped) return;
      tracker.timer = setTimeout(tick, delay);
      if (typeof tracker.timer.unref === "function") tracker.timer.unref();
    };
    const tick = async () => {
      if (tracker.stopped) return;
      const startedAt = Date.now();
      try {
        await this.updateProgress(guildId);
      } catch (err) {
        // updateProgress already logs; swallow so the loop never dies.
        logger.debug("Progress tick swallowed error", {
          guild: guildId,
          error: err?.message,
        });
      }
      if (tracker.stopped) return;
      const elapsed = Date.now() - startedAt;
      scheduleNext(Math.max(0, 1000 - elapsed));
    };
    scheduleNext(1000);

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
      tracker.stopped = true;
      if (tracker.timer) clearTimeout(tracker.timer);
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

    // Re-entrancy is prevented by the self-clocking loop in startTracking:
    // the next tick is scheduled only after `await updateProgress` resolves.
    // No `updating` flag is needed here.

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
