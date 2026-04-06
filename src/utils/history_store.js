/**
 * History Store
 * Thin facade that delegates per-guild play history to GuildSession via SessionManager.
 * Maintains the same public API so existing callers (e.g. bilibiliApi.js) keep working.
 */

class HistoryStore {
  /**
   * @param {Object} sessionManager - SessionManager instance
   */
  constructor(sessionManager) {
    this.sessionManager = sessionManager
  }

  has(guildId, bvid) {
    return this.sessionManager.get(guildId).hasHistory(bvid)
  }

  add(guildId, bvid) {
    this.sessionManager.get(guildId).addHistory(bvid)
  }

  filter(guildId, candidates) {
    return this.sessionManager.get(guildId).filterHistory(candidates)
  }
}

module.exports = HistoryStore
