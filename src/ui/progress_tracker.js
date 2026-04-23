/**
 * Progress Tracker
 * Manages real-time progress updates for now playing embeds.
 * Tracker state is stored in GuildSession via SessionManager.
 *
 * Why this file is unusual — a brief tour of the failure modes it defends against:
 *
 *   1. Discord per-channel edit rate limit is 5 edits / 5 seconds (1/s sustained).
 *      A naive setInterval(1000) sits exactly on that ceiling; any extra edit
 *      (button click, track change, state update) exhausts the bucket, and the
 *      NEXT `message.edit()` blocks 2-4s. That block cascades: the interval
 *      keeps firing, ticks queue, and the visible progress bar falls further
 *      and further behind the audio — this is issue #12's surface symptom.
 *
 *   2. A `setInterval + updating flag` variant (first attempt) silently drops
 *      ticks during the block, so when Discord ACKs we still wait a full
 *      second for the next interval — making the first "catch-up" look sluggish.
 *
 *   3. A `self-clocking setTimeout chain` (second attempt — shipped in PR #36)
 *      schedules the next tick AFTER the previous edit resolves. That fixes
 *      the catch-up latency but still hits the rate limit, because it still
 *      tries to edit every ~1s even when the rendered bar hasn't changed.
 *
 *   4. This version (third attempt) adds content-hash dedup: we render the
 *      embed every tick but only call `message.edit` when the bar string
 *      (or other visible fields) actually changed since the last successful
 *      edit. For a 60s track with a 20-segment bar each segment lasts 3s, so
 *      real edits drop from 60/minute to ~20/minute — well clear of Discord's
 *      limit even with several guilds playing in the same channel (rare but
 *      possible for shared bot hosts).
 *
 *      We ALSO drop `components` from tick edits. Button state (play/pause
 *      icon, loop mode indicator) changes on user action, not per-tick, and
 *      InterfaceUpdater has its own state-change path that sends full edits
 *      including components. Sending components here was pure waste.
 *
 *   5. Absolute-time scheduling: `nextTickAt = lastTickAt + intervalMs`
 *      (rather than `Date.now() + intervalMs`) so a slow edit doesn't push
 *      every subsequent tick late. If the edit ran long, we schedule the
 *      next tick with `max(0, nextTickAt - now)` — catches up instantly.
 *
 *   6. Back-pressure cooldown (this file's KEY defense against runaway).
 *      If `message.edit()` takes longer than the slow-edit threshold it
 *      usually means Discord's per-channel bucket is drained and
 *      discord.js's REST client is holding our request. At that point the
 *      absolute-time scheduler will keep scheduling delay=0 ticks, each of
 *      which enqueues another edit into the already-stuck queue —
 *      classic runaway. That matches the user-reported "progress bar
 *      refreshed every second at the start of playback, then started
 *      refreshing every few seconds after a while" failure.
 *
 *      Defense: count consecutive slow edits, and after N in a row enter
 *      a cooldown window during which the tick loop keeps running BUT
 *      does not call `message.edit` at all. That lets the rate-limit
 *      bucket and discord.js's REST queue drain. When the cooldown ends
 *      we resume normal 1s updates. UX trade-off agreed with the user:
 *      the bar may visibly freeze for a few seconds under back-pressure,
 *      then snaps back to 1/s cadence.
 */

const EmbedBuilders = require("./embeds");
const logger = require("../services/logger_service");
const config = require("../config/config");

// Lightweight content hash — not cryptographic, just cheap collision-avoidance
// for "did the payload change at all". Bob Jenkins's one-at-a-time hash.
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h += str.charCodeAt(i);
    h += h << 10;
    h ^= h >>> 6;
  }
  h += h << 3;
  h ^= h >>> 11;
  h += h << 15;
  return h >>> 0;
}

/**
 * Build a compact signature of the fields that visibly change on a progress
 * tick. If this signature matches the last successful edit's, the new edit
 * would look identical to the user and we can skip it.
 *
 * NOT included:
 *   - Track identity (title, url, thumbnail) — InterfaceUpdater handles track
 *     changes through its state-change path.
 *   - Button/component state — same reason; also we don't send components on
 *     tick edits anymore.
 */
function computeProgressSignature(embed) {
  const fields = embed?.data?.fields || embed?.fields || [];
  const progress =
    fields.find((f) => f?.name && /progress/i.test(f.name))?.value || "";
  // Include the description too — some embeds put the timer there instead of
  // a field. Cheap and keeps the signature robust across embed layouts.
  const description = embed?.data?.description || embed?.description || "";
  return hashString(progress + "\u0001" + description);
}

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
        lastSignature: null,
      };
      this.updateProgress(guildId);
      return;
    }

    const intervalMs = config.ui?.progressIntervalMs || 1000;
    const slowEditThresholdMs = config.ui?.slowEditThresholdMs || 1500;
    const slowEditStreakLimit = config.ui?.slowEditStreakLimit || 3;
    const cooldownMs = config.ui?.cooldownMs || 5000;

    const tracker = {
      message,
      guildId,
      getPlayerState,
      stopped: false,
      timer: null,
      // Hash of the last payload actually sent to Discord. When the next
      // rendered payload matches, we skip the edit entirely (dedup).
      lastSignature: null,
      // Absolute wall-clock target for the next tick; drives the
      // "schedule next relative to the planned tick, not to `now`" behavior.
      nextTickAt: Date.now() + intervalMs,
      // Back-pressure state. `consecutiveSlowEdits` resets on any fast
      // edit; `cooldownUntil` is a wall-clock deadline after which edits
      // resume. While `Date.now() < cooldownUntil` the tick loop still
      // fires but skips `message.edit` entirely.
      consecutiveSlowEdits: 0,
      cooldownUntil: 0,
      // Thresholds pinned at startTracking time so config reloads don't
      // mutate a running tracker mid-flight.
      slowEditThresholdMs,
      slowEditStreakLimit,
      cooldownMs,
    };
    session.progressTracker = tracker;

    const scheduleNext = () => {
      if (tracker.stopped) return;
      const delay = Math.max(0, tracker.nextTickAt - Date.now());
      tracker.timer = setTimeout(tick, delay);
      if (typeof tracker.timer.unref === "function") tracker.timer.unref();
    };

    const tick = async () => {
      if (tracker.stopped) return;
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
      // Absolute-time scheduling: advance the planned tick target by one
      // interval regardless of how long the edit took. If we ran long
      // (e.g. Discord rate-limited us for 3s), the NEXT delay becomes 0 and
      // we catch up immediately on the following tick. If we fell multiple
      // intervals behind, jump the target to `now` so we don't fire a burst
      // of back-to-back ticks that would just re-exhaust the bucket.
      tracker.nextTickAt += intervalMs;
      const now = Date.now();
      if (tracker.nextTickAt < now - intervalMs) {
        tracker.nextTickAt = now;
      }
      scheduleNext();
    };

    scheduleNext();

    logger.info("Started progress tracking", {
      guild: guildId,
      intervalMs,
    });
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

    // Back-pressure cooldown: the previous stretch of edits was slow, so
    // we're giving discord.js's REST queue and the channel's rate-limit
    // bucket time to drain. Tick keeps firing (so we notice when playback
    // ends, state changes, etc.) but we don't send anything.
    if (Date.now() < tracker.cooldownUntil) {
      logger.debug("Progress tick skipped (cooldown)", {
        guild: guildId,
        remainingMs: tracker.cooldownUntil - Date.now(),
      });
      return;
    }

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
      const updatedEmbed = EmbedBuilders.createNowPlayingEmbed(track, {
        currentTime,
        requestedBy: track.requestedBy,
        queuePosition: playerState.currentIndex + 1,
        totalQueue: playerState.queueLength,
        loopMode: playerState.loopMode,
      });

      // Content-hash dedup — if the visible progress content hasn't changed
      // since our last edit, skip the Discord round-trip entirely.
      const signature = computeProgressSignature(updatedEmbed);
      if (signature === tracker.lastSignature) {
        logger.debug("Progress tick skipped (unchanged)", {
          guild: guildId,
          currentTime: Math.floor(currentTime),
        });
        return;
      }

      // Intentionally NOT sending `components` on tick edits (handled by
      // InterfaceUpdater's state-change path — see file-header comment).
      const editStartedAt = Date.now();
      await message.edit({
        embeds: [updatedEmbed],
      });
      const editDuration = Date.now() - editStartedAt;
      tracker.lastSignature = signature;

      // Back-pressure detection: a single slow edit is normal noise
      // (network jitter, a one-off rate-limit hit). A streak of slow
      // edits means the bucket is drained and we're piling requests into
      // discord.js's REST queue. Enter cooldown to let it drain.
      if (editDuration >= tracker.slowEditThresholdMs) {
        tracker.consecutiveSlowEdits += 1;
        if (tracker.consecutiveSlowEdits >= tracker.slowEditStreakLimit) {
          tracker.cooldownUntil = Date.now() + tracker.cooldownMs;
          tracker.consecutiveSlowEdits = 0;
          logger.warn("Progress tracker entering cooldown (edit back-pressure)", {
            guild: guildId,
            editDuration,
            cooldownMs: tracker.cooldownMs,
          });
        }
      } else {
        tracker.consecutiveSlowEdits = 0;
      }

      logger.debug("Progress updated", {
        guild: guildId,
        currentTime: Math.floor(currentTime),
        duration: track.duration,
        editDuration,
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
