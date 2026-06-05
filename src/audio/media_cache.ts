/**
 * MediaCache
 * Persistent on-disk cache of extracted audio files, keyed by an opaque id
 * (the video id). A hit lets playback read a local file instead of a signed,
 * expiring CDN URL — instant, and immune to URL expiry. LRU-evicted by both an
 * entry count and a total-bytes cap. The metadata stored per entry is opaque to
 * this class, so it stays decoupled from any platform-specific type.
 *
 * Single-process (one container) — the in-memory index is the source of truth
 * and is mirrored to <dir>/index.json so it survives restarts.
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../services/logger_service';

interface StreamHeaders {
  referer?: string;
  userAgent?: string;
}

interface IndexEntry {
  file: string;
  bytes: number;
  lastAccess: number;
  /** Monotonic access counter — the LRU ordering key (immune to ms-resolution ties). */
  seq: number;
  meta: unknown;
}

interface DownloadTask {
  id: string;
  audioUrl: string;
  headers?: StreamHeaders;
  meta?: unknown;
}

interface MediaCacheOptions {
  dir: string;
  maxEntries: number;
  maxBytes: number;
  enabled?: boolean;
  downloadTimeoutMs?: number;
}

const INDEX_FILE = 'index.json';

class MediaCache {
  private readonly dir: string;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly enabled: boolean;
  private readonly downloadTimeoutMs: number;
  private readonly indexPath: string;
  private index: Map<string, IndexEntry>;
  // Downloads run serially (one at a time) so they don't contend with the live
  // playback stream for the box's limited CPU/bandwidth. `queued` dedups ids
  // sitting in the queue or actively downloading.
  private queue: DownloadTask[];
  private queued: Set<string>;
  private worker: Promise<void> | null;
  private seq: number;

  constructor(opts: MediaCacheOptions) {
    this.seq = 0;
    this.dir = opts.dir;
    this.maxEntries = Math.max(1, opts.maxEntries);
    this.maxBytes = Math.max(1, opts.maxBytes);
    this.enabled = opts.enabled ?? true;
    this.downloadTimeoutMs = opts.downloadTimeoutMs ?? 60_000;
    this.indexPath = path.join(this.dir, INDEX_FILE);
    this.index = new Map();
    this.queue = [];
    this.queued = new Set();
    this.worker = null;
    if (this.enabled) this._load();
  }

  /** Local file path for a cached id (bumps LRU), or null on miss. */
  get(id: string): string | null {
    if (!this.enabled || !id) return null;
    const entry = this.index.get(id);
    if (!entry) return null;
    const full = path.join(this.dir, entry.file);
    if (!fs.existsSync(full)) {
      this.index.delete(id);
      this._persist();
      return null;
    }
    entry.lastAccess = Date.now();
    entry.seq = ++this.seq;
    this._persist();
    return full;
  }

  /** Cached file path + stored opaque metadata, or null on miss. */
  getEntry(id: string): { path: string; meta: unknown } | null {
    const p = this.get(id);
    if (!p) return null;
    return { path: p, meta: this.index.get(id)!.meta };
  }

  has(id: string): boolean {
    return this.get(id) !== null;
  }

  /**
   * Fire-and-forget background download of `audioUrl` into the cache. No-op if
   * disabled, already cached, in-flight, or the URL isn't a direct media file
   * (HLS/DASH manifests are skipped). Never throws.
   */
  put(id: string, audioUrl: string, headers?: StreamHeaders, meta?: unknown): void {
    if (!this.enabled || !id || !audioUrl) return;
    if (this.index.has(id) || this.queued.has(id)) return;
    if (/\.m3u8(\?|$)/i.test(audioUrl) || /\.mpd(\?|$)/i.test(audioUrl) || /[?&]manifest/i.test(audioUrl)) {
      return;
    }
    this.queue.push({ id, audioUrl, headers, meta });
    this.queued.add(id);
    this._pump();
  }

  /** Await all queued + in-flight downloads (for graceful shutdown / tests). */
  async drain(): Promise<void> {
    while (this.worker) await this.worker;
  }

  /** Start the single serial worker if it isn't already running. */
  private _pump(): void {
    if (this.worker) return;
    this.worker = this._runQueue().finally(() => { this.worker = null; });
  }

  /** Process queued downloads one at a time. Picks up items enqueued mid-run. */
  private async _runQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        if (!this.index.has(task.id)) {
          await this._download(task.id, task.audioUrl, task.headers, task.meta);
        }
      } catch (error: unknown) {
        logger.warn('Media cache download failed', { id: task.id, error: (error as Error).message });
      } finally {
        this.queued.delete(task.id);
      }
    }
  }

  get size(): number {
    return this.index.size;
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async _download(id: string, audioUrl: string, headers?: StreamHeaders, meta?: unknown): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = `${this._safeId(id)}.${this._ext(audioUrl)}`;
    const finalPath = path.join(this.dir, file);
    const tmpPath = `${finalPath}.tmp`;

    const reqHeaders: Record<string, string> = {};
    if (headers?.referer) reqHeaders.Referer = headers.referer;
    if (headers?.userAgent) reqHeaders['User-Agent'] = headers.userAgent;

    const response = await axios.get(audioUrl, {
      responseType: 'stream',
      timeout: this.downloadTimeoutMs,
      maxContentLength: this.maxBytes,
      maxRedirects: 5,
      headers: reqHeaders,
      validateStatus: (s: number) => s >= 200 && s < 300,
    });

    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(tmpPath);
      let bytes = 0;
      let aborted = false;
      const fail = (err: Error) => {
        aborted = true;
        response.data.destroy();
        ws.destroy();
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        reject(err);
      };
      response.data.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > this.maxBytes) fail(new Error('download exceeds maxBytes'));
      });
      response.data.on('error', fail);
      ws.on('error', fail);
      ws.on('finish', () => { if (!aborted) resolve(); });
      response.data.pipe(ws);
    });

    const bytes = fs.statSync(tmpPath).size;
    if (bytes <= 0) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw new Error('empty download');
    }
    fs.renameSync(tmpPath, finalPath);

    this.index.set(id, { file, bytes, lastAccess: Date.now(), seq: ++this.seq, meta });
    this._evict();
    this._persist();
    logger.info('Media cached', { id, bytes, entries: this.index.size });
  }

  private _evict(): void {
    while (this.index.size > this.maxEntries || this._totalBytes() > this.maxBytes) {
      let lruId: string | null = null;
      let lruSeq = Infinity;
      for (const [id, entry] of this.index) {
        if (entry.seq < lruSeq) { lruSeq = entry.seq; lruId = id; }
      }
      if (!lruId) break;
      const entry = this.index.get(lruId)!;
      try { fs.unlinkSync(path.join(this.dir, entry.file)); } catch { /* ignore */ }
      this.index.delete(lruId);
      logger.info('Media cache evicted', { id: lruId });
    }
  }

  private _totalBytes(): number {
    let total = 0;
    for (const entry of this.index.values()) total += entry.bytes;
    return total;
  }

  private _load(): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });

      if (fs.existsSync(this.indexPath)) {
        const raw = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')) as Record<string, IndexEntry>;
        for (const [id, entry] of Object.entries(raw)) {
          if (entry && typeof entry.file === 'string' && fs.existsSync(path.join(this.dir, entry.file))) {
            this.index.set(id, entry);
          }
        }
      }

      // Resume the access counter above any persisted value.
      for (const entry of this.index.values()) this.seq = Math.max(this.seq, entry.seq || 0);

      // Reconcile: drop media files not referenced by the (surviving) index and
      // any leftover .tmp partials.
      const known = new Set<string>([INDEX_FILE]);
      for (const entry of this.index.values()) known.add(entry.file);
      for (const f of fs.readdirSync(this.dir)) {
        if (known.has(f)) continue;
        try { fs.unlinkSync(path.join(this.dir, f)); } catch { /* ignore */ }
      }

      this._persist();
      logger.info('Media cache loaded', { entries: this.index.size, dir: this.dir });
    } catch (error: unknown) {
      logger.warn('Media cache load failed', { error: (error as Error).message });
    }
  }

  private _persist(): void {
    if (!this.enabled) return;
    try {
      const obj: Record<string, IndexEntry> = {};
      for (const [id, entry] of this.index) obj[id] = entry;
      fs.writeFileSync(this.indexPath, JSON.stringify(obj));
    } catch (error: unknown) {
      logger.warn('Media cache index persist failed', { error: (error as Error).message });
    }
  }

  private _ext(url: string): string {
    const mime = /[?&]mime=audio(?:%2F|\/)([a-z0-9]+)/i.exec(url);
    const dotted = /\.(m4a|webm|opus|mp3|ogg|aac|mp4)(\?|$)/i.exec(url);
    const raw = (mime?.[1] || dotted?.[1] || 'm4a').toLowerCase();
    return raw === 'mp4' ? 'm4a' : raw;
  }

  private _safeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  }
}

export = MediaCache;
