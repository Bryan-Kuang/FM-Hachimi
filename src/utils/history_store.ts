/**
 * History Store
 * Thin facade that delegates per-guild play history to GuildSession via SessionManager.
 * Maintains the same public API so existing callers (e.g. bilibiliApi.js) keep working.
 */

// Duck-typed interface for the subset of SessionManager used here
// (SessionManager itself migrates in Task 10)
interface SessionManagerLike {
  get(guildId: string): {
    hasHistory(bvid: string): boolean;
    addHistory(bvid: string): void;
    filterHistory(candidates: string[]): string[];
  };
}

class HistoryStore {
  private sessionManager: SessionManagerLike;

  constructor(sessionManager: SessionManagerLike) {
    this.sessionManager = sessionManager;
  }

  has(guildId: string, bvid: string): boolean {
    return this.sessionManager.get(guildId).hasHistory(bvid);
  }

  add(guildId: string, bvid: string): void {
    this.sessionManager.get(guildId).addHistory(bvid);
  }

  filter(guildId: string, candidates: string[]): string[] {
    return this.sessionManager.get(guildId).filterHistory(candidates);
  }
}

export = HistoryStore;
