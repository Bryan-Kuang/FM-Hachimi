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
 *      classic runaway. Defense: count consecutive slow edits, and after N
 *      in a row enter a cooldown window during which the tick loop keeps
 *      running BUT does not call `message.edit` at all.
 */

import EmbedBuilders = require('./embeds');
import * as logger from '../services/logger_service';
import config = require('../config/config');
import SessionManager = require('../session/session_manager');
import type { ProgressTrackerState, PlayerState } from '../types';

// Minimal Discord message shape needed here — full discord.js Message type
// is applied at the command/updater layer (Task 13-14).
interface DiscordMessage {
  edit(options: { embeds: unknown[] }): Promise<DiscordMessage>;
}

// Lightweight content hash — not cryptographic, just cheap collision-avoidance
// for "did the payload change at all". Bob Jenkins's one-at-a-time hash.
function hashString(str: string): number {
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
 */
function computeProgressSignature(embed: unknown): number {
  const e = embed as { data?: { fields?: { name?: string; value: string }[]; description?: string }; fields?: { name?: string; value: string }[]; description?: string };
  const fields = e?.data?.fields ?? e?.fields ?? [];
  const progress =
    fields.find((f) => f?.name && /progress/i.test(f.name))?.value ?? '';
  const description = e?.data?.description ?? e?.description ?? '';
  return hashString(progress + '' + description);
}

/**
 * Discord-side failures that resolve themselves on a later tick: gateway 5xx
 * and rate limits. Nothing to act on, so they don't earn an error-level line.
 */
function isTransientDiscordFailure(err: { status?: number; message?: string }): boolean {
  if (err.status && [429, 500, 502, 503, 504].includes(err.status)) return true;
  return /service unavailable|internal server error|bad gateway|gateway timeout|rate limit/i
    .test(err.message ?? '');
}

class ProgressTracker {
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Start tracking progress for a guild.
   * @param guildId - Discord guild ID
   * @param message - Discord message to update
   * @param getPlayerState - Callback returning current player state
   */
  startTracking(guildId: string, message: DiscordMessage, getPlayerState: () => PlayerState | null): void {
    this.stopTracking(guildId);

    const session = this.sessionManager.get(guildId);

    if (process.env.NODE_ENV === 'test') {
      // Minimal tracker for test environment — no scheduling
      const testTracker: ProgressTrackerState = {
        message,
        guildId,
        getPlayerState: getPlayerState as () => unknown,
        stopped: false,
        timer: null,
        lastSignature: null,
        nextTickAt: 0,
        cooldownUntil: 0,
        consecutiveSlowEdits: 0,
        cooldownStreak: 0,
        lastCooldownEndedAt: 0,
        slowEditThresholdMs: 2500,
        slowEditStreakLimit: 3,
        cooldownMs: 5000,
      };
      session.progressTracker = testTracker;
      void this.updateProgress(guildId);
      return;
    }

    const intervalMs = config.ui?.progressIntervalMs ?? 1000;
    const slowEditThresholdMs = config.ui?.slowEditThresholdMs ?? 2500;
    const slowEditStreakLimit = config.ui?.slowEditStreakLimit ?? 3;
    const cooldownMs = config.ui?.cooldownMs ?? 5000;

    const tracker: ProgressTrackerState = {
      message,
      guildId,
      getPlayerState: getPlayerState as () => unknown,
      stopped: false,
      timer: null,
      lastSignature: null,
      nextTickAt: Date.now() + intervalMs,
      consecutiveSlowEdits: 0,
      cooldownUntil: 0,
      cooldownStreak: 0,
      lastCooldownEndedAt: 0,
      slowEditThresholdMs,
      slowEditStreakLimit,
      cooldownMs,
    };
    session.progressTracker = tracker;

    const scheduleNext = () => {
      if (tracker.stopped) return;
      const delay = Math.max(0, tracker.nextTickAt - Date.now());
      tracker.timer = setTimeout(tick, delay);
      if (typeof tracker.timer.unref === 'function') tracker.timer.unref();
    };

    const tick = async () => {
      if (tracker.stopped) return;
      try {
        await this.updateProgress(guildId);
      } catch (err: unknown) {
        logger.debug('Progress tick swallowed error', {
          guild: guildId,
          error: (err as Error)?.message,
        });
      }
      if (tracker.stopped) return;
      // Absolute-time scheduling: advance planned tick target by one interval.
      // If we fell multiple intervals behind, jump target to `now` to avoid
      // a burst of back-to-back ticks.
      tracker.nextTickAt += intervalMs;
      const now = Date.now();
      if (tracker.nextTickAt < now - intervalMs) {
        tracker.nextTickAt = now;
      }
      scheduleNext();
    };

    scheduleNext();

    logger.info('Started progress tracking', { guild: guildId, intervalMs });
  }

  /**
   * Stop tracking progress for a guild.
   */
  stopTracking(guildId: string): void {
    const session = this.sessionManager.get(guildId);
    const tracker = session.progressTracker;
    if (tracker) {
      tracker.stopped = true;
      if (tracker.timer) clearTimeout(tracker.timer);
      session.progressTracker = null;
      logger.info('Stopped progress tracking', { guild: guildId });
    }
  }

  /**
   * Update progress for a guild (called each tick).
   */
  async updateProgress(guildId: string): Promise<void> {
    const session = this.sessionManager.get(guildId);
    const tracker = session.progressTracker;
    if (!tracker) return;

    // Back-pressure cooldown: skip edit but keep ticking so we can detect
    // playback end and state changes.
    if (Date.now() < tracker.cooldownUntil) {
      logger.debug('Progress tick skipped (cooldown)', {
        guild: guildId,
        remainingMs: tracker.cooldownUntil - Date.now(),
      });
      return;
    }

    try {
      const { message, getPlayerState } = tracker;
      const playerState = (getPlayerState as () => PlayerState | null)();
      if (!playerState) return;

      const track = playerState.currentTrack;
      if (!playerState.isPlaying || !track) return;

      // The break card is static (title only); never animate a progress bar on it.
      if (playerState.isBreak) return;

      if (!track.title || track.duration == null) return;

      const currentTime = playerState.currentTime;

      const updatedEmbed = EmbedBuilders.createNowPlayingEmbed(
        track as unknown as Parameters<typeof EmbedBuilders.createNowPlayingEmbed>[0],
        {
          currentTime,
          requestedBy: track.requestedBy,
          queuePosition: playerState.currentIndex + 1,
          totalQueue: playerState.queueLength,
          loopMode: playerState.loopMode,
          radioMode: playerState.radioMode,
        },
      );

      // Content-hash dedup — skip the Discord round-trip if nothing changed.
      const signature: number = computeProgressSignature(updatedEmbed);
      if (signature === tracker.lastSignature) {
        tracker.consecutiveSlowEdits = 0;
        logger.debug('Progress tick skipped (unchanged)', {
          guild: guildId,
          currentTime: Math.floor(currentTime),
        });
        return;
      }

      // Intentionally NOT sending `components` on tick edits (handled by
      // InterfaceUpdater's state-change path).
      const editStartedAt = Date.now();
      await (message as DiscordMessage).edit({ embeds: [updatedEmbed] });
      const editDuration = Date.now() - editStartedAt;
      tracker.lastSignature = signature;

      // Back-pressure detection: streak of slow edits → enter cooldown.
      if (editDuration >= tracker.slowEditThresholdMs) {
        tracker.consecutiveSlowEdits += 1;
        if (tracker.consecutiveSlowEdits >= tracker.slowEditStreakLimit) {
          const recentCooldown =
            tracker.lastCooldownEndedAt > 0 &&
            Date.now() - tracker.lastCooldownEndedAt < tracker.cooldownMs;
          tracker.cooldownStreak = recentCooldown ? tracker.cooldownStreak + 1 : 1;
          const multiplier = Math.min(2 ** (tracker.cooldownStreak - 1), 4);
          const cooldownDuration = tracker.cooldownMs * multiplier;
          tracker.cooldownUntil = Date.now() + cooldownDuration;
          tracker.lastCooldownEndedAt = tracker.cooldownUntil;
          tracker.consecutiveSlowEdits = 0;
          // Debug, not warn: this is the control loop doing its job, not an
          // anomaly. At warn it was 95% of all warn/error lines in production
          // (1252 of 1321 over 96h) and buried everything worth reading.
          logger.debug('Progress tracker entering cooldown (edit back-pressure)', {
            guild: guildId,
            editDuration,
            cooldownMs: cooldownDuration,
            cooldownStreak: tracker.cooldownStreak,
          });
        }
      } else {
        tracker.consecutiveSlowEdits = 0;
        // A sustained healthy window resets the backoff streak.
        if (
          tracker.cooldownStreak > 0 &&
          Date.now() - tracker.lastCooldownEndedAt > tracker.cooldownMs
        ) {
          tracker.cooldownStreak = 0;
        }
      }

      logger.debug('Progress updated', {
        guild: guildId,
        currentTime: Math.floor(currentTime),
        duration: track.duration,
        editDuration,
      });
    } catch (error: unknown) {
      const err = error as { code?: number; status?: number; message?: string };
      // Discord-side blips (503 storms are routine) aren't ours to fix and
      // self-heal on the next tick — log them at warn so real failures stay
      // visible at error.
      const log = isTransientDiscordFailure(err) ? logger.warn : logger.error;
      log('Failed to update progress', {
        guild: guildId,
        error: (error as Error).message,
      });

      // Stop tracking if message no longer exists or is inaccessible.
      if (err.code === 10008 || err.code === 50001) {
        this.stopTracking(guildId);
      }
    }
  }

  /**
   * Cleanup all trackers.
   */
  cleanup(): void {
    if (!this.sessionManager) return;
    for (const [guildId, session] of this.sessionManager.sessions) {
      if (session.progressTracker) {
        this.stopTracking(guildId);
      }
    }
    logger.info('Progress tracker cleanup completed');
  }
}

export = ProgressTracker;
