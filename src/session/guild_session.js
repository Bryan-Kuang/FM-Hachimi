/**
 * Guild Session
 * Per-guild state container for player, UI, and playback tracking
 */

class GuildSession {
  constructor(guildId) {
    this.guildId = guildId;
    this.player = null;          // AudioPlayer instance
    this.uiContext = null;       // { channelId, messageId }
    this.uiSeq = 0;             // UI update sequence number
    this.progressTracker = null; // see progress_tracker.js for shape — { message, timer, stopped, lastSignature, nextTickAt, cooldownUntil, ... }
    this.history = new Set();    // Play history bvids (for dedup)
    this.historyLimit = 50;      // Max history entries before eviction
  }

  /**
   * Add a bvid to the play history, evicting oldest if over limit.
   * @param {string} bvid
   */
  addHistory(bvid) {
    // Move to tail (newest) by re-inserting
    if (this.history.has(bvid)) this.history.delete(bvid);
    this.history.add(bvid);
    // Evict oldest if over limit
    while (this.history.size > this.historyLimit) {
      const oldest = this.history.values().next().value;
      this.history.delete(oldest);
    }
  }

  /**
   * Check if a bvid exists in the play history.
   * @param {string} bvid
   * @returns {boolean}
   */
  hasHistory(bvid) {
    return this.history.has(bvid);
  }

  /**
   * Filter candidates that are not in the play history.
   * @param {Array} candidates - Array of objects with bvid property
   * @returns {Array}
   */
  filterHistory(candidates) {
    return (Array.isArray(candidates) ? candidates : []).filter(
      (v) => !this.history.has(v.bvid)
    );
  }
}

module.exports = GuildSession;
