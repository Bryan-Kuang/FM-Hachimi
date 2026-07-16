/**
 * Direct Spotify audio extraction via a librespot-family sidecar (Project B).
 *
 * Spotify never exposes public CDN URLs (unlike Bilibili/YouTube) — the only
 * way to get real Spotify audio is a client that speaks Spotify's own
 * (Connect) protocol, authenticated as a real account. That's what the
 * sidecar CLI does: given a track id and cached OAuth credentials, it logs in
 * and writes the decoded audio to a local file, then exits. No streaming URL
 * is ever produced, so — unlike the YouTube/Bilibili extractors — the result
 * is always `cached: true` with a local file path; there is nothing to
 * refresh (see `ExtractedTrackData.cached` in services/types.ts).
 *
 * Sidecar: zotify (github.com/Googolplexed0/zotify), a maintained fork of the
 * original zotify-dev project, itself built on a maintained librespot-python
 * fork. Chosen over the official librespot-org/librespot binary because that
 * binary is a Spotify Connect *receiver* — it needs another Spotify client
 * (phone/desktop) to act as a remote control and select what plays, so it
 * can't be driven as a plain "fetch this track id and exit" subprocess.
 * zotify is built for exactly that: `zotify <track-url>` downloads one track
 * non-interactively once credentials are cached. See OPERATIONS.md's
 * "Spotify direct playback" section for the one-time login bootstrap that
 * produces `credentials.json` (password auth is dead; OAuth is the only
 * login path zotify — and librespot generally — supports today).
 *
 * Caching: rather than layering on `audio/media_cache.ts` (whose `put()` API
 * downloads a *remote* URL in the background — not applicable here, since
 * the sidecar already writes straight to a local file), this class keeps its
 * own flat cache directory keyed by track id (`{trackId}.<ext>`, extension
 * chosen by the sidecar). A pre-existing file is treated as a cache hit and
 * the sidecar is never invoked. That gives the same "instant repeat plays"
 * behavior as MediaCache with a lot less code, at the cost of not sharing
 * MediaCache's LRU eviction — left unbounded deliberately for now (an
 * individual Spotify account's realistic repeat-play set is small; revisit
 * if `cacheDir` grows unexpectedly on a deployed box).
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../services/logger_service';

interface SpotifyDirectExtractorOptions {
  /** Directory containing the sidecar's cached login (`credentials.json`). */
  credentialsDir: string;
  /** Directory downloaded audio files are written to / read back from. */
  cacheDir: string;
  /** Sidecar executable name/path (resolved on PATH by default: `zotify`). */
  sidecarCommand: string;
  /** Kill timer for the sidecar subprocess. */
  timeoutMs: number;
}

interface SpotifyDirectExtractedTrack {
  title: string;
  audioUrl: string;
  duration: number;
  cached: true;
  extractedAt: string;
}

interface ExtractAudioMeta {
  title: string;
  durationSec?: number;
}

const CREDENTIALS_FILE = 'credentials.json';

class SpotifyDirectExtractor {
  private readonly credentialsDir: string;
  private readonly cacheDir: string;
  private readonly sidecarCommand: string;
  private readonly timeoutMs: number;

  constructor(opts: SpotifyDirectExtractorOptions) {
    this.credentialsDir = opts.credentialsDir;
    this.cacheDir = opts.cacheDir;
    this.sidecarCommand = opts.sidecarCommand;
    this.timeoutMs = opts.timeoutMs;
  }

  /** True when the sidecar's cached login is present (one-time manual bootstrap — see OPERATIONS.md). */
  isConfigured(): boolean {
    try {
      return fs.existsSync(path.join(this.credentialsDir, CREDENTIALS_FILE));
    } catch {
      return false;
    }
  }

  /**
   * Extract (or reuse a cached copy of) one track's audio. Always resolves to
   * a local file path (`cached: true`) or rejects — callers (the playback
   * resolver seam) are expected to fall back to the YouTube-match path on
   * any rejection.
   */
  async extractAudio(trackId: string, meta: ExtractAudioMeta): Promise<SpotifyDirectExtractedTrack> {
    if (!trackId) {
      throw new Error('Spotify direct extraction requires a track id');
    }

    const cached = this.findCachedFile(trackId);
    if (cached) {
      logger.info('Spotify direct extraction cache hit', { trackId, path: cached });
      return this.buildResult(meta, cached);
    }

    const startedAt = Date.now();
    await this.runSidecar(trackId);

    const output = this.findCachedFile(trackId);
    if (!output) {
      throw new Error('Spotify sidecar exited successfully but produced no output file');
    }

    logger.info('Spotify direct extraction completed', {
      trackId,
      title: meta.title,
      ms: Date.now() - startedAt,
    });

    return this.buildResult(meta, output);
  }

  private buildResult(meta: ExtractAudioMeta, filePath: string): SpotifyDirectExtractedTrack {
    return {
      title: meta.title,
      audioUrl: filePath,
      duration: meta.durationSec ?? 0,
      cached: true,
      extractedAt: new Date().toISOString(),
    };
  }

  /** `{cacheDir}/{trackId}.*` — extension is whatever the sidecar wrote (native codec, "copy" mode). */
  private findCachedFile(trackId: string): string | null {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const prefix = `${trackId}.`;
      const match = fs.readdirSync(this.cacheDir).find((f) => f.startsWith(prefix));
      return match ? path.join(this.cacheDir, match) : null;
    } catch (error: unknown) {
      logger.warn('Spotify direct cache dir read failed', { error: (error as Error).message });
      return null;
    }
  }

  private runSidecar(trackId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(this.cacheDir, { recursive: true });

      const args = [
        '--no-splash',
        '--creds', this.credentialsDir,
        '--root-path', this.cacheDir,
        '--output-single', '{id}',
        '--codec', 'copy',
        '-q', 'auto',
        `https://open.spotify.com/track/${trackId}`,
      ];

      const child: ChildProcess = spawn(this.sidecarCommand, args);
      let stderr = '';

      child.stdout?.on('data', () => { /* progress output — not needed */ });
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000);
        reject(new Error('Spotify direct extraction timeout'));
      }, this.timeoutMs).unref();

      child.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        if (code !== 0 && code !== null) {
          reject(new Error(`Spotify sidecar exited with code ${code}: ${stderr.trim().substring(0, 300)}`));
          return;
        }
        resolve();
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timeoutId);
        reject(new Error(`Spotify sidecar process error: ${error.message}`));
      });
    });
  }
}

export = SpotifyDirectExtractor;
