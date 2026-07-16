/**
 * YouTube Audio Extractor
 * Handles YouTube video URL processing and audio stream extraction via yt-dlp.
 * Mirrors the BilibiliExtractor interface for seamless platform switching.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as logger from '../services/logger_service';
import config = require('../config/config');
import ExpiringCache = require('../utils/expiring_cache');
import MediaCache = require('../audio/media_cache');
import YouTubeValidator = require('./validator');
import { emitPlaybackStage, type PlaybackStageReporter } from '../playback/stage_feedback';

interface VideoMetadata {
  success: boolean;
  title: string;
  description: string;
  duration: number;
  uploader: string;
  uploadDate: string | null;
  uploadDateFormatted?: string;
  viewCount: number;
  likeCount: number;
  thumbnail: string | null;
  videoId: string | null;
  id: string | null;
  url: string;
  webpage_url: string;
}

interface StreamHeaders {
  referer: string;
  userAgent: string;
}

interface ExtractedAudio extends VideoMetadata {
  audioUrl: string;
  platform: 'youtube';
  originalUrl: string;
  normalizedUrl: string;
  extractedAt: string;
  formatId?: string;
  protocol?: string;
  audioCodec?: string;
  videoCodec?: string;
  streamHeaders: StreamHeaders;
  /** True when audioUrl is a local media-cache file (skip stale-URL refresh). */
  cached?: boolean;
}

interface SearchResult {
  title: string;
  id: string;
  url: string;
  duration: number | string;
  uploader: string;
  viewCount: number | string;
  thumbnail: string | null;
  index?: number;
}

interface SearchResponse {
  success: boolean;
  results?: SearchResult[];
  error?: string;
  keyword: string;
  timestamp: string;
  authFailure?: boolean;
}

interface ThumbnailEntry {
  url: string;
  width?: number;
  height?: number;
}

interface SelectedFormatMetadata {
  formatId?: string;
  protocol?: string;
  audioCodec?: string;
  videoCodec?: string;
}

interface ExtractionPayload {
  metadata: VideoMetadata;
  audioUrl: string;
  selectedFormat: SelectedFormatMetadata;
  ytdlpMs: number;
  parseMs: number;
}

interface ExtractionOptions {
  priority?: 'foreground' | 'background';
  source?: string;
  onStage?: PlaybackStageReporter;
}

interface ResolvedExtractionOptions {
  priority: 'foreground' | 'background';
  source: string;
  onStage?: PlaybackStageReporter;
}

interface YtFlatPlaylistEntry {
  id: string;
  title: string;
  duration: number;
  uploader: string;
  url: string;
}

interface YtFlatPlaylistResult {
  success: boolean;
  playlistTitle?: string;
  entries?: YtFlatPlaylistEntry[];
  error?: string;
}

interface CookieRefreshServiceLike {
  refreshNow(context?: { reason?: string; source?: string; force?: boolean }): Promise<{
    success: boolean;
    refreshed: boolean;
    skipped?: boolean;
    error?: string;
  }>;
}

const AUDIO_FORMAT_SELECTOR =
  'bestaudio[vcodec=none][protocol^=http][acodec!=none]/bestaudio[vcodec=none][acodec!=none]/best[height<=360][protocol^=http][acodec!=none]/best[height<=360][protocol=m3u8_native][acodec!=none]/best[height<=360][acodec!=none]/worst[acodec!=none]';

class YouTubeExtractor {
  private userAgent: string;
  private _ytdlpChecked: boolean;
  private _cookiesFile: string | null;
  private _cookieRefreshService: CookieRefreshServiceLike | null;

  // Extraction result cache — avoids repeated yt-dlp calls for the same video.
  // Shared ExpiringCache owns TTL eviction + size cap + cleanup timer.
  private _cache: ExpiringCache<ExtractedAudio>;
  private _inFlightExtractions: Map<string, Promise<ExtractedAudio>>;
  // Persistent downloaded-audio cache (injected by the composition root).
  private _mediaCache: MediaCache | null;

  constructor() {
    this.userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this._ytdlpChecked = false;
    this._cookiesFile = this._resolveCookiesFile();
    this._cookieRefreshService = null;
    this._mediaCache = null;

    // 25-min TTL — signed stream URLs are short-lived.
    this._cache = new ExpiringCache(25 * 60 * 1000, 50, { label: 'youtube-extraction' });
    this._inFlightExtractions = new Map();
  }

  /** Stop the cache cleanup timer. Call on shutdown. */
  destroy(): void {
    this._cache.dispose();
    this._inFlightExtractions.clear();
  }

  setCookieRefreshService(service: CookieRefreshServiceLike | null): void {
    this._cookieRefreshService = service;
  }

  setMediaCache(cache: MediaCache | null): void {
    this._mediaCache = cache;
  }

  clearCacheForUrl(url: string): void {
    const normalizedUrl = YouTubeValidator.normalizeUrl(url) || url;
    this._cache.delete(normalizedUrl);
    this._inFlightExtractions.delete(normalizedUrl);
  }

  clearCache(): void {
    this._cache.clear();
    this._inFlightExtractions.clear();
  }

  async prewarm(): Promise<{ ytdlpAvailable: boolean }> {
    const ytdlpAvailable = await this.checkYtDlpAvailability();
    if (ytdlpAvailable) {
      this._ytdlpChecked = true;
    }
    return { ytdlpAvailable };
  }

  /**
   * Resolve cookies file path. Checks YOUTUBE_COOKIES_FILE env var,
   * then falls back to the shared cookies.txt used by Bilibili extractor.
   */
  private _resolveCookiesFile(): string | null {
    const candidates = [
      process.env.YOUTUBE_COOKIES_FILE,
      '/app/secrets/youtube_cookies.txt',
      'youtube_cookies.txt',
      'bilibili_cookies.txt',
    ];

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        logger.info('YouTube cookies file found', { path: candidate });
        return candidate;
      }
    }

    logger.warn('No YouTube cookies file found — bot-detection may block requests');
    return null;
  }

  /**
   * Get yt-dlp cookie arguments using a read-only temp copy.
   *
   * yt-dlp writes back to the cookies file on every call, overwriting
   * the original with rotated tokens from the data-center IP response.
   * This degrades the session until YouTube kills it — often within an hour.
   *
   * Fix: copy the original cookies to a temp file, pass that to yt-dlp,
   * then delete it. The original file stays untouched.
   */
  private _getCookieArgs(): string[] {
    if (this._cookiesFile && fs.existsSync(this._cookiesFile)) {
      try {
        const tmpFile = path.join(os.tmpdir(), `yt-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
        fs.copyFileSync(this._cookiesFile, tmpFile);
        // Schedule cleanup — delete temp file after yt-dlp finishes (60s buffer)
        setTimeout(() => {
          try { fs.unlinkSync(tmpFile); } catch { /* already gone */ }
        }, 60000).unref();
        return ['--cookies', tmpFile];
      } catch (err) {
        logger.warn('Failed to create temp cookies copy, using original', { error: (err as Error).message });
        return ['--cookies', this._cookiesFile];
      }
    }
    return [];
  }

  /** Common yt-dlp args shared across all invocations. */
  private _baseArgs(): string[] {
    return [
      '--no-check-certificate',
      '--no-warnings',
      ...this._playerClientArgs(),
      ...this._potProviderArgs(),
      '--user-agent', this.userAgent,
      ...this._getCookieArgs(),
    ];
  }

  /**
   * bgutil PO-token provider selector. When YTDLP_POT_PROVIDER_URL points at
   * a bgutil-ytdlp-pot-provider sidecar, yt-dlp (with the matching plugin
   * installed in the image) fetches GVS PO tokens on demand — required by a
   * growing set of YouTube clients for stream URLs to not 403.
   */
  private _potProviderArgs(): string[] {
    const base = config.youtube.potProviderUrl;
    if (!base) return [];
    return ['--extractor-args', `youtubepot-bgutilhttp:base_url=${base}`];
  }

  /**
   * Player-client selector. Empty spec (the default) lets yt-dlp pick its own
   * clients and solve the nsig player JS via node — yt-dlp's maintainers track
   * YouTube's per-client PO-token enforcement, so this stays working across
   * rollouts. A pinned spec (e.g. 'tv,ios') returns pre-signed stream URLs and
   * skips the JS solve (faster), but breaks when YouTube tightens that client:
   * pinned 'tv' began returning 403 stream URLs on 2026-07-01.
   */
  private _playerClientArgs(): string[] {
    const spec = config.youtube.playerClient;
    if (!spec) return ['--js-runtimes', 'node'];
    return ['--extractor-args', `youtube:player_client=${spec}`];
  }

  /**
   * Extract audio from a YouTube video URL.
   * Single yt-dlp invocation with an audio-first format selector.
   * Results are cached for 25 minutes to reduce yt-dlp calls.
   */
  async extractAudio(
    url: string,
    retryOrOptions: number | ExtractionOptions = 0,
    maxRetries = 2,
  ): Promise<ExtractedAudio> {
    const retryCount = typeof retryOrOptions === 'number' ? retryOrOptions : 0;
    const options = this.resolveExtractionOptions(
      typeof retryOrOptions === 'number' ? undefined : retryOrOptions,
    );
    const totalStartedAt = Date.now();
    logger.info('Starting YouTube audio extraction', {
      url,
      attempt: retryCount + 1,
      priority: options.priority,
      source: options.source,
    });

    try {
      if (!this._ytdlpChecked) {
        const available = await this.checkYtDlpAvailability();
        if (!available) {
          throw new Error('yt-dlp is not available. Please install it: pip install yt-dlp');
        }
        this._ytdlpChecked = true;
      }

      if (!YouTubeValidator.isValidYouTubeUrl(url)) {
        throw new Error('Invalid YouTube URL format');
      }

      const normalizedUrl = YouTubeValidator.normalizeUrl(url);
      if (!normalizedUrl) {
        throw new Error('Failed to normalize YouTube URL');
      }

      // Persistent media cache: if we have the audio downloaded locally, play
      // from the file — instant, and immune to signed-URL expiry. Checked before
      // the URL cache because the local file never goes stale.
      const mediaHit = this._mediaCache?.getEntry(normalizedUrl);
      if (mediaHit) {
        const data = mediaHit.meta as ExtractedAudio;
        logger.info('YouTube media cache hit — playing local file', {
          url: normalizedUrl,
          title: data.title,
          source: options.source,
        });
        emitPlaybackStage(options.onStage, 'using_cached');
        this.logExtractionTiming({
          cacheHit: true,
          joinedInFlight: false,
          ytdlpMs: 0,
          parseMs: 0,
          totalMs: Date.now() - totalStartedAt,
          priority: options.priority,
          source: `${options.source}:media`,
          ...this.selectedFormatFromExtractedAudio(data),
        });
        return { ...data, audioUrl: mediaHit.path, cached: true };
      }

      // Check cache first — skip yt-dlp entirely on hit
      const cached = this._cache.get(normalizedUrl);
      if (cached) {
        logger.info('YouTube cache hit — skipping yt-dlp', {
          url: normalizedUrl,
          title: cached.title,
          cacheAgeMin: Math.round((this._cache.ageMs(normalizedUrl) ?? 0) / 60000),
          source: options.source,
          priority: options.priority,
        });
        emitPlaybackStage(options.onStage, 'using_cached');
        this.logExtractionTiming({
          cacheHit: true,
          joinedInFlight: false,
          ytdlpMs: 0,
          parseMs: 0,
          totalMs: Date.now() - totalStartedAt,
          priority: options.priority,
          source: options.source,
          ...this.selectedFormatFromExtractedAudio(cached),
        });
        return cached;
      }

      if (retryCount === 0) {
        const inFlight = this._inFlightExtractions.get(normalizedUrl);
        if (inFlight) {
          logger.info('YouTube extraction joined in-flight request', {
            url: normalizedUrl,
            source: options.source,
            priority: options.priority,
          });
          emitPlaybackStage(options.onStage, 'using_cached');
          const joinedStartedAt = Date.now();
          const result = await inFlight;
          this.logExtractionTiming({
            cacheHit: false,
            joinedInFlight: true,
            ytdlpMs: 0,
            parseMs: 0,
            totalMs: Date.now() - joinedStartedAt,
            priority: options.priority,
            source: options.source,
            ...this.selectedFormatFromExtractedAudio(result),
          });
          return result;
        }

        const extraction = this._extractAudioUncached(url, normalizedUrl, retryCount, maxRetries, totalStartedAt, options)
          .finally(() => {
            this._inFlightExtractions.delete(normalizedUrl);
          });
        this._inFlightExtractions.set(normalizedUrl, extraction);
        return extraction;
      }

      return await this._extractAudioUncached(url, normalizedUrl, retryCount, maxRetries, totalStartedAt, options);
    } catch (error) {
      logger.error('YouTube audio extraction failed', {
        url,
        error: (error as Error).message,
        attempt: retryCount + 1,
      });

      throw new Error(`YouTube extraction failed: ${(error as Error).message}`);
    }
  }

  private async _extractAudioUncached(
    url: string,
    normalizedUrl: string,
    retryCount: number,
    maxRetries: number,
    totalStartedAt: number,
    options: ResolvedExtractionOptions,
  ): Promise<ExtractedAudio> {
    try {
      const { metadata, audioUrl, selectedFormat, ytdlpMs, parseMs } =
        await this.extractMetadataAndUrlWithCookieRefresh(normalizedUrl, options);

      const result: ExtractedAudio = {
        ...metadata,
        audioUrl,
        ...selectedFormat,
        platform: 'youtube',
        originalUrl: url,
        normalizedUrl,
        extractedAt: new Date().toISOString(),
        streamHeaders: {
          referer: 'https://www.youtube.com/',
          userAgent: this.userAgent,
        },
      };

      // Cache the result
      this._cache.set(normalizedUrl, result);
      // Fire-and-forget: download the audio so future plays (incl. after the
      // signed URL expires) hit the local file. Stores the full metadata.
      this._mediaCache?.put(normalizedUrl, result.audioUrl, result.streamHeaders, result);

      logger.info('YouTube audio extraction completed', {
        url,
        title: result.title,
        duration: result.duration,
      });

      this.logExtractionTiming({
        cacheHit: false,
        joinedInFlight: false,
        ytdlpMs,
        parseMs,
        totalMs: Date.now() - totalStartedAt,
        priority: options.priority,
        source: options.source,
        ...selectedFormat,
      });

      return result;
    } catch (error) {
      if (retryCount < maxRetries && this.isRetryableError(error as Error)) {
        const delay = (retryCount + 1) * 2000;
        logger.info('Retrying YouTube extraction', { url, nextAttempt: retryCount + 2, delay });
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._extractAudioUncached(url, normalizedUrl, retryCount + 1, maxRetries, totalStartedAt, options);
      }

      throw error;
    }
  }

  /**
   * Get audio stream URL only (for CDN URL refresh on stale tracks).
   */
  async getAudioStreamUrl(url: string): Promise<string> {
    try {
      return await this.getAudioStreamUrlOnce(url);
    } catch (error: unknown) {
      if (!this.isAuthFailureError(error as Error)) throw error;

      await this.refreshCookiesForAuthFailure('stream_refresh');
      try {
        return await this.getAudioStreamUrlOnce(url);
      } catch (retryError: unknown) {
        if (this.isAuthFailureError(retryError as Error)) {
          throw new Error(`YouTube auth/bot check failed after automatic cookie refresh: ${(retryError as Error).message}`);
        }
        throw retryError;
      }
    }
  }

  private async getAudioStreamUrlOnce(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '--get-url',
        '--format', AUDIO_FORMAT_SELECTOR,
        '--no-playlist',
        ...this._baseArgs(),
        url,
      ];

      const ytdlp: ChildProcess = spawn('yt-dlp', args);
      let stdout = '';
      let stderr = '';

      ytdlp.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
      ytdlp.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

      ytdlp.on('close', (code: number | null) => {
        if (code !== 0 && code !== null) {
          reject(new Error(this.formatYtDlpError(code, stderr)));
          return;
        }
        const audioUrl = stdout.trim().split('\n')[0];
        if (!audioUrl) {
          reject(new Error('No audio stream URL found'));
          return;
        }
        resolve(audioUrl);
      });

      ytdlp.on('error', (error: NodeJS.ErrnoException) => {
        reject(new Error(`yt-dlp process error: ${error.message}`));
      });

      const timeoutId = setTimeout(() => {
        ytdlp.kill('SIGTERM');
        setTimeout(() => { if (!ytdlp.killed) ytdlp.kill('SIGKILL'); }, 2000);
        reject(new Error('YouTube audio URL extraction timeout'));
      }, 30000).unref();

      ytdlp.on('close', () => clearTimeout(timeoutId));
      ytdlp.on('error', () => clearTimeout(timeoutId));
    });
  }

  /**
   * Search YouTube videos by keyword.
   */
  async searchVideos(keyword: string, limit = 5): Promise<SearchResponse> {
    const first = await this.searchVideosOnce(keyword, limit);
    if (!first.authFailure) return first;

    try {
      await this.refreshCookiesForAuthFailure('search');
    } catch (error: unknown) {
      return {
        success: false,
        error: `Search failed after automatic cookie refresh failed: ${(error as Error).message}`,
        keyword,
        timestamp: new Date().toISOString(),
      };
    }

    return this.searchVideosOnce(keyword, limit);
  }

  private async searchVideosOnce(keyword: string, limit = 5): Promise<SearchResponse> {
    return new Promise((resolve) => {
      const args = [
        `ytsearch${limit}:${keyword}`,
        '--dump-json',
        '--flat-playlist',
        '--no-download',
        ...this._baseArgs(),
      ];

      logger.debug('YouTube search via yt-dlp', { keyword, limit });

      const ytdlp: ChildProcess = spawn('yt-dlp', args);
      let stdout = '';
      let stderr = '';

      ytdlp.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
      ytdlp.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

      ytdlp.on('close', (code: number | null) => {
        if (code !== 0 && code !== null) {
          const errorMessage = this.formatYtDlpError(code, stderr);
          logger.error('YouTube search failed', { code, stderr });
          resolve({
            success: false,
            error: `Search failed: ${errorMessage}`,
            keyword,
            timestamp: new Date().toISOString(),
            authFailure: this.isAuthFailureMessage(errorMessage),
          });
          return;
        }

        try {
          const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
          const results: SearchResult[] = lines.map((line, index) => {
            const data = JSON.parse(line) as Record<string, unknown>;
            return {
              title: (data.title as string) || 'Unknown',
              id: (data.id as string) || '',
              url: (data.url as string) || (data.webpage_url as string) || `https://www.youtube.com/watch?v=${data.id}`,
              duration: (data.duration as number) || 0,
              uploader: (data.uploader as string) || (data.channel as string) || 'Unknown',
              viewCount: (data.view_count as number) || 0,
              thumbnail: this.selectBestThumbnail(data.thumbnails as ThumbnailEntry[] | undefined),
              index,
            };
          });

          resolve({
            success: true,
            results,
            keyword,
            timestamp: new Date().toISOString(),
          });
        } catch (parseError) {
          logger.error('Failed to parse YouTube search results', { error: (parseError as Error).message });
          resolve({
            success: false,
            error: `Parse error: ${(parseError as Error).message}`,
            keyword,
            timestamp: new Date().toISOString(),
          });
        }
      });

      ytdlp.on('error', (error: NodeJS.ErrnoException) => {
        resolve({
          success: false,
          error: `yt-dlp error: ${error.message}`,
          keyword,
          timestamp: new Date().toISOString(),
        });
      });

      const timeoutId = setTimeout(() => {
        ytdlp.kill('SIGTERM');
        resolve({
          success: false,
          error: 'Search timeout',
          keyword,
          timestamp: new Date().toISOString(),
        });
      }, 20000).unref();

      ytdlp.on('close', () => clearTimeout(timeoutId));
      ytdlp.on('error', () => clearTimeout(timeoutId));
    });
  }

  /**
   * List the items of a YouTube playlist (flat — no per-item metadata fetch,
   * just id/title/duration/uploader from the playlist page itself). Used by
   * the bulk-enqueue playlist path; each returned entry becomes a
   * lazily-extracted pending track (see src/playlists/youtube_playlist_resolver.ts).
   */
  async listPlaylistItems(playlistUrl: string, limit: number): Promise<YtFlatPlaylistResult> {
    return new Promise((resolve) => {
      const args = [
        playlistUrl,
        '--flat-playlist',
        '--dump-json',
        '--no-download',
        '--playlist-end', String(limit),
        ...this._baseArgs(),
      ];

      logger.debug('YouTube playlist listing via yt-dlp', { playlistUrl, limit });

      const ytdlp: ChildProcess = spawn('yt-dlp', args);
      let stdout = '';
      let stderr = '';

      ytdlp.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
      ytdlp.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

      ytdlp.on('close', (code: number | null) => {
        if (code !== 0 && code !== null) {
          const errorMessage = this.formatYtDlpError(code, stderr);
          logger.error('YouTube playlist listing failed', { code, stderr, playlistUrl });
          resolve({ success: false, error: `Playlist listing failed: ${errorMessage}` });
          return;
        }

        try {
          const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
          let playlistTitle: string | undefined;
          const entries: YtFlatPlaylistEntry[] = [];

          for (const line of lines) {
            const data = JSON.parse(line) as Record<string, unknown>;
            if (!playlistTitle && typeof data.playlist_title === 'string') {
              playlistTitle = data.playlist_title;
            }

            const title = (data.title as string) || '';
            if (title === '[Private video]' || title === '[Deleted video]') continue;

            const id = (data.id as string) || '';
            if (!id) continue;

            entries.push({
              id,
              title: title || 'Unknown',
              duration: (data.duration as number) || 0,
              uploader: (data.uploader as string) || (data.channel as string) || 'Unknown',
              // Never trust entry.url for flat-playlist output — build the
              // canonical watch URL from the id instead.
              url: `https://www.youtube.com/watch?v=${id}`,
            });
          }

          resolve({ success: true, playlistTitle, entries });
        } catch (parseError) {
          logger.error('Failed to parse YouTube playlist listing', { error: (parseError as Error).message });
          resolve({ success: false, error: `Parse error: ${(parseError as Error).message}` });
        }
      });

      ytdlp.on('error', (error: NodeJS.ErrnoException) => {
        resolve({ success: false, error: `yt-dlp error: ${error.message}` });
      });

      const timeoutId = setTimeout(() => {
        ytdlp.kill('SIGTERM');
        setTimeout(() => { if (!ytdlp.killed) ytdlp.kill('SIGKILL'); }, 2000);
        resolve({ success: false, error: 'Playlist listing timeout' });
      }, config.playlists.resolveTimeoutMs).unref();

      ytdlp.on('close', () => clearTimeout(timeoutId));
      ytdlp.on('error', () => clearTimeout(timeoutId));
    });
  }

  // ─── Private helpers ───────��──────────────────────────────────────────

  private async extractMetadataAndUrlWithCookieRefresh(
    normalizedUrl: string,
    options: ResolvedExtractionOptions,
  ): Promise<ExtractionPayload> {
    try {
      return await this.extractMetadataAndUrl(normalizedUrl);
    } catch (error: unknown) {
      if (!this.isAuthFailureError(error as Error)) throw error;

      await this.refreshCookiesForAuthFailure(options.source || 'playback');
      this.clearCacheForUrl(normalizedUrl);
      try {
        return await this.extractMetadataAndUrl(normalizedUrl);
      } catch (retryError: unknown) {
        if (this.isAuthFailureError(retryError as Error)) {
          throw new Error(`YouTube auth/bot check failed after automatic cookie refresh: ${(retryError as Error).message}`);
        }
        throw retryError;
      }
    }
  }

  private async refreshCookiesForAuthFailure(source: string): Promise<void> {
    if (!this._cookieRefreshService) {
      throw new Error('YouTube auth/bot check failed; automatic cookie refresh is not configured.');
    }

    const result = await this._cookieRefreshService.refreshNow({
      reason: 'youtube_auth_failure',
      source,
    });

    if (!result.success) {
      throw new Error(`YouTube auth/bot check failed; automatic cookie refresh failed: ${result.error || 'unknown error'}`);
    }

    logger.info('Automatic YouTube cookie refresh completed after auth failure', {
      source,
      refreshed: result.refreshed,
      skipped: result.skipped,
    });
  }

  private isAuthFailureError(error: Error): boolean {
    return this.isAuthFailureMessage(error.message);
  }

  private isAuthFailureMessage(message: string): boolean {
    const msg = message.toLowerCase();
    return (
      msg.includes('youtube auth/bot check failed') ||
      msg.includes('cookies are no longer valid') ||
      msg.includes('cookies expired') ||
      msg.includes('sign in to confirm') ||
      msg.includes('not a bot')
    );
  }

  private formatYtDlpError(code: number | null, stderr: string): string {
    if (stderr.includes('Sign in to confirm your age')) {
      return 'Age-restricted video (login required)';
    }
    if (
      stderr.includes('Sign in to confirm') ||
      stderr.includes('not a bot') ||
      stderr.includes('cookies are no longer valid') ||
      stderr.includes('cookies expired')
    ) {
      return 'YouTube auth/bot check failed';
    }
    if (stderr.includes('Video unavailable') || stderr.includes('Private video')) {
      return 'Video is unavailable or private';
    }
    if (stderr.includes('network') || stderr.includes('timeout')) {
      return 'Network connection error';
    }
    if (stderr) {
      return `yt-dlp exited with code ${code}: ${stderr.substring(0, 200)}`;
    }
    return `yt-dlp exited with code ${code}`;
  }

  private async extractMetadataAndUrl(normalizedUrl: string): Promise<ExtractionPayload> {
    return new Promise((resolve, reject) => {
      const ytdlpStartedAt = Date.now();
      const args = [
        '--dump-json',
        '--format', AUDIO_FORMAT_SELECTOR,
        '--no-download',
        '--no-playlist',
        ...this._baseArgs(),
        normalizedUrl,
      ];

      const ytdlp: ChildProcess = spawn('yt-dlp', args);
      let stdout = '';
      let stderr = '';

      ytdlp.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
      ytdlp.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

      ytdlp.on('close', (code: number | null) => {
        const ytdlpMs = Date.now() - ytdlpStartedAt;
        if (code !== 0 && code !== null) {
          if (code === 137 || code === 143) {
            reject(new Error('YouTube extraction timeout'));
            return;
          }
          reject(new Error(this.formatYtDlpError(code, stderr)));
          return;
        }

        try {
          const parseStartedAt = Date.now();
          const lines = stdout.split('\n').filter(l => l.trim());
          const jsonLine = lines.find(l => l.trim().startsWith('{'));
          if (!jsonLine) throw new Error('No JSON object in yt-dlp output');

          const videoData = JSON.parse(jsonLine) as Record<string, unknown>;
          const metadata = this.parseVideoMetadata(videoData);
          const selectedFormat = this.extractSelectedFormat(videoData);

          // Extract audio URL from requested_downloads or url field
          let audioUrl = '';
          const requestedDownloads = videoData.requested_downloads as Array<{ url?: string }> | undefined;
          if (requestedDownloads && requestedDownloads.length > 0 && requestedDownloads[0].url) {
            audioUrl = requestedDownloads[0].url;
          } else if (videoData.url && typeof videoData.url === 'string') {
            audioUrl = videoData.url;
          }

          if (!audioUrl) {
            reject(new Error('No audio URL found in yt-dlp JSON output'));
            return;
          }

          resolve({
            metadata,
            audioUrl,
            selectedFormat,
            ytdlpMs,
            parseMs: Date.now() - parseStartedAt,
          });
        } catch (parseError) {
          reject(new Error(`Parse error: ${(parseError as Error).message}`));
        }
      });

      ytdlp.on('error', (error: NodeJS.ErrnoException) => {
        reject(new Error(`yt-dlp error: ${error.message}`));
      });

      const timeoutId = setTimeout(() => {
        ytdlp.kill('SIGTERM');
        setTimeout(() => { if (!ytdlp.killed) ytdlp.kill('SIGKILL'); }, 2000);
        reject(new Error('YouTube extraction timeout'));
      }, 30000).unref();

      ytdlp.on('close', () => clearTimeout(timeoutId));
      ytdlp.on('error', () => clearTimeout(timeoutId));
    });
  }

  private extractSelectedFormat(videoData: Record<string, unknown>): SelectedFormatMetadata {
    const requestedDownloads = videoData.requested_downloads as Array<Record<string, unknown>> | undefined;
    const selected = requestedDownloads?.[0] ?? videoData;
    return {
      formatId: this.asString(selected.format_id ?? videoData.format_id),
      protocol: this.asString(selected.protocol ?? videoData.protocol),
      audioCodec: this.asString(selected.acodec ?? videoData.acodec),
      videoCodec: this.asString(selected.vcodec ?? videoData.vcodec),
    };
  }

  private selectedFormatFromExtractedAudio(data: ExtractedAudio): SelectedFormatMetadata {
    return {
      formatId: data.formatId,
      protocol: data.protocol,
      audioCodec: data.audioCodec,
      videoCodec: data.videoCodec,
    };
  }

  private asString(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    return String(value);
  }

  private logExtractionTiming(timing: {
    cacheHit: boolean;
    joinedInFlight?: boolean;
    ytdlpMs: number;
    parseMs: number;
    totalMs: number;
    priority?: string;
    source?: string;
  } & SelectedFormatMetadata): void {
    logger.info('YouTube extraction timing', { ...timing });
  }

  private resolveExtractionOptions(options?: ExtractionOptions): ResolvedExtractionOptions {
    return {
      priority: options?.priority ?? 'foreground',
      source: options?.source ?? 'playback',
      onStage: options?.onStage,
    };
  }

  private parseVideoMetadata(videoData: Record<string, unknown>): VideoMetadata {
    const metadata: VideoMetadata = {
      success: true,
      title: (videoData.title as string) || 'Unknown Title',
      description: (videoData.description as string) || '',
      duration: (videoData.duration as number) || 0,
      uploader: (videoData.uploader as string) || (videoData.channel as string) || 'Unknown',
      uploadDate: (videoData.upload_date as string) || null,
      viewCount: (videoData.view_count as number) || 0,
      likeCount: (videoData.like_count as number) || 0,
      thumbnail: this.selectBestThumbnail(videoData.thumbnails as ThumbnailEntry[] | undefined),
      videoId: (videoData.id as string) || null,
      id: (videoData.id as string) || null,
      url: (videoData.webpage_url as string) || (videoData.original_url as string) || '',
      webpage_url: (videoData.webpage_url as string) || '',
    };

    if (metadata.uploadDate) {
      try {
        const y = metadata.uploadDate.substring(0, 4);
        const m = metadata.uploadDate.substring(4, 6);
        const d = metadata.uploadDate.substring(6, 8);
        metadata.uploadDateFormatted = `${y}-${m}-${d}`;
      } catch { /* ignore */ }
    }

    return metadata;
  }

  private selectBestThumbnail(thumbnails: ThumbnailEntry[] | undefined): string | null {
    if (!thumbnails || thumbnails.length === 0) return null;
    // Prefer medium-sized thumbnail for embed display
    const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
    const medium = sorted.find(t => (t.width || 0) >= 320 && (t.width || 0) <= 720);
    return (medium || sorted[0])?.url || null;
  }

  private async checkYtDlpAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      const ytdlp: ChildProcess = spawn('yt-dlp', ['--version']);
      ytdlp.on('close', (code) => resolve(code === 0));
      ytdlp.on('error', () => resolve(false));
    });
  }

  private isRetryableError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    // bot-detection is intentionally NOT retried — retrying just burns cookies faster
    return (
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('connection') ||
      msg.includes('rate') ||
      msg.includes('429') ||
      msg.includes('503')
    );
  }
}

export = YouTubeExtractor;
