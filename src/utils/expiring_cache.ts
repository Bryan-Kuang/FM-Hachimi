/**
 * ExpiringCache
 * Small TTL + max-size in-memory cache shared by the Bilibili and YouTube
 * extractors, which previously each hand-rolled the same Map + cleanup-interval
 * + oldest-first eviction logic. Entries expire after `ttlMs`; an unref'd timer
 * periodically prunes expired entries and enforces `maxSize` (oldest evicted
 * first). `get` lazily evicts on read, so callers never see a stale value even
 * between cleanup ticks.
 */

import * as logger from '../services/logger_service';

interface CacheNode<V> {
  value: V;
  storedAt: number;
}

interface ExpiringCacheOptions {
  /** Cleanup sweep interval. Default 10 min; 0 disables the timer. */
  cleanupIntervalMs?: number;
  /** Label included in debug logs. */
  label?: string;
}

class ExpiringCache<V> {
  private store: Map<string, CacheNode<V>>;
  private timer: ReturnType<typeof setInterval> | null;
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly label: string;

  constructor(ttlMs: number, maxSize: number, opts: ExpiringCacheOptions = {}) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.label = opts.label ?? 'cache';
    this.store = new Map();

    const interval = opts.cleanupIntervalMs ?? 10 * 60 * 1000;
    this.timer = interval > 0 ? setInterval(() => this.cleanup(), interval) : null;
    this.timer?.unref?.();
  }

  /** Live value for `key`, or null if missing/expired. Evicts expired entries. */
  get(key: string): V | null {
    const node = this.store.get(key);
    if (!node) return null;
    if (Date.now() - node.storedAt > this.ttlMs) {
      this.store.delete(key);
      return null;
    }
    return node.value;
  }

  /** Age in ms of a live entry, or null if missing/expired. */
  ageMs(key: string): number | null {
    const node = this.store.get(key);
    if (!node) return null;
    const age = Date.now() - node.storedAt;
    return age > this.ttlMs ? null : age;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, storedAt: Date.now() });
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  /** Prune expired entries, then enforce maxSize (oldest first). Returns removed count. */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, node] of this.store) {
      if (now - node.storedAt > this.ttlMs) {
        this.store.delete(key);
        removed++;
      }
    }

    if (this.store.size > this.maxSize) {
      const sorted = [...this.store.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt);
      const excess = this.store.size - this.maxSize;
      for (let i = 0; i < excess; i++) {
        this.store.delete(sorted[i][0]);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Cache cleanup completed', { label: this.label, removed, remaining: this.store.size });
    }
    return removed;
  }

  /** Stop the cleanup timer and drop all entries. Call on shutdown. */
  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.store.clear();
  }
}

export = ExpiringCache;
