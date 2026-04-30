/**
 * History Store
 * Thin facade that delegates per-guild play history to GuildSession via SessionManager.
 * Maintains the same public API so existing callers (e.g. bilibiliApi.js) keep working.
 */

// Duck-typed interface for the subset of SessionManager used here.
// filterHistory is generic (T extends { bvid: string }) to preserve the real
// runtime behaviour: callers pass VideoInfo objects (not bare strings) and get
// the same objects back filtered. The `string[]` simplification that was here
// before Task 10 required ugly `as unknown as` casts at every call site.
interface SessionManagerLike {
  get(guildId: string): {
    hasHistory(bvid: string): boolean;
    addHistory(bvid: string): void;
    filterHistory<T extends { bvid?: string }>(candidates: T[]): T[];
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

  filter<T extends { bvid?: string }>(guildId: string, candidates: T[]): T[] {
    return this.sessionManager.get(guildId).filterHistory(candidates);
  }
}

export = HistoryStore;
