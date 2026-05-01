/**
 * Session Manager
 * Manages GuildSession instances across Discord guilds.
 * Central cleanup: removing a session tears down player, progress interval,
 * and UI context in one place.
 */

import GuildSession = require('./guild_session');
import * as logger from '../services/logger_service';

class SessionManager {
  /** Public so audio_manager and progress_tracker can iterate all sessions. */
  sessions: Map<string, GuildSession>;

  constructor() {
    this.sessions = new Map();
  }

  /**
   * Get or create a session for the given guild.
   */
  get(guildId: string): GuildSession {
    if (!this.sessions.has(guildId)) {
      this.sessions.set(guildId, new GuildSession(guildId));
    }
    return this.sessions.get(guildId) as GuildSession;
  }

  /**
   * Check if a session exists for the given guild.
   */
  has(guildId: string): boolean {
    return this.sessions.has(guildId);
  }

  /**
   * Remove and clean up a guild session.
   * This is the central cleanup point — player, progress tracker, and UI
   * context are all torn down here instead of being scattered across modules.
   */
  remove(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    if (!session) return false;

    // 1. Stop progress tracking timer.
    // Field name changed from `.interval` (setInterval era) to `.timer`
    // (self-clocking setTimeout chain era — see progress_tracker.js header).
    // We mark the tracker stopped BEFORE clearing so any in-flight tick that
    // has already passed its initial `if (tracker.stopped) return` exits at
    // the post-update stopped-check instead of rescheduling.
    if (session.progressTracker) {
      try {
        session.progressTracker.stopped = true;
        if (session.progressTracker.timer) {
          clearTimeout(session.progressTracker.timer);
        }
      } catch (_) { /* ignore */ }
      session.progressTracker = null;
    }

    // 2. Leave voice channel and clean up player
    if (session.player) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        session.player.leaveVoiceChannel();
      } catch (_) { /* ignore */ }
      session.player = null;
    }

    // 3. Clear UI context
    session.uiContext = null;
    session.uiSeq = 0;

    // 4. Delete the session
    this.sessions.delete(guildId);

    logger.info('Guild session removed', { guildId });
    return true;
  }

  /**
   * Remove and clean up all sessions.
   */
  cleanup(): void {
    for (const guildId of this.sessions.keys()) {
      this.remove(guildId);
    }
    logger.info('All guild sessions cleaned up');
  }

  /**
   * Number of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }
}

export = SessionManager;
