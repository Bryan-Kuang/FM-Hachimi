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
}

interface ThumbnailEntry {
  url: string;
  width?: number;
  height?: number;
}

interface CacheEntry {
  data: ExtractedAudio;
  cachedAt: number;
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

const AUDIO_FORMAT_SELECTOR =
  'bestaudio[vcodec=none][protocol^=http][acodec!=none]/bestaudio[vcodec=none][acodec!=none]/best[height<=360][protocol^=http][acodec!=none]/best[height<=360][protocol=m3u8_native][acodec!=none]/best[height<=360][acodec!=none]/worst[acodec!=none]';

class YouTubeExtractor {
  private userAgent: string;
  private _ytdlpChecked: boolean;
  private _cookiesFile: string | null;

  // Extraction result cache — avoids repeated yt-dlp calls for the same video
  private _cache: Map<string, CacheEntry>;
  private _inFlightExtractions: Map<string, Promise<ExtractedAudio>>;
  private _cacheExpiry: number;
  private _maxCacheSize: number;
  private _cacheCleanupInterval: NodeJS.Timeout | null;

  constructor() {
    this.userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this._ytdlpChecked = false;
    this._cookiesFile = this._resolveCookiesFile();

    // URL cache (mirrors BilibiliExtractor pattern)
    this._cache = new Map();
    this._inFlightExtractions = new Map();
    this._cacheExpiry = 25 * 60 * 1000; // 25 minutes
    this._maxCacheSize = 50;
    this._cacheCleanupInterval = setInterval(() => {
      this._cleanupExpiredCache();
    }, 10 * 60 * 1000).unref();
  }

  /** Clean up expired cache entries and enforce size limit. */
  private _cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this._cache) {
      if (now - entry.cachedAt > this._cacheExpiry) {
        this._cache.delete(key);
      }
    }
    // Enforce size limit — evict oldest entries
    if (this._cache.size > this._maxCacheSize) {
      const sorted = [...this._cache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt);
      const excess = this._cache.size - this._maxCacheSize;
      for (let i = 0; i < excess; i++) {
        this._cache.delete(sorted[i][0]);
      }
    }
  }

  /** Stop the cache cleanup timer. Call on shutdown. */
  destroy(): void {
    if (this._cacheCleanupInterval) {
      clearInterval(this._cacheCleanupInterval);
      this._cacheCleanupInterval = null;
    }
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
      'youtube_cookies.txt',
      'cookies.txt',
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
      '--user-agent', this.userAgent,
      ...this._getCookieArgs(),
    ];
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

      // Check cache first — skip yt-dlp entirely on hit
      const cached = this._cache.get(normalizedUrl);
      if (cached && (Date.now() - cached.cachedAt < this._cacheExpiry)) {
        logger.info('YouTube cache hit — skipping yt-dlp', {
          url: normalizedUrl,
          title: cached.data.title,
          cacheAgeMin: Math.round((Date.now() - cached.cachedAt) / 60000),
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
          ...this.selectedFormatFromExtractedAudio(cached.data),
        });
        return cached.data;
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
        await this.extractMetadataAndUrl(normalizedUrl);

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
      this._cache.set(normalizedUrl, { data: result, cachedAt: Date.now() });

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
    return new Promise((resolve, reject) => {
      const args = [
        '--get-url',
        '--format', AUDIO_FORMAT_SELECTOR,
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
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
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
          logger.error('YouTube search failed', { code, stderr });
          resolve({
            success: false,
            error: `Search failed: ${stderr || `exit code ${code}`}`,
            keyword,
            timestamp: new Date().toISOString(),
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

  // ─── Private helpers ───────��──────────────────────────────────────────

  private async extractMetadataAndUrl(normalizedUrl: string): Promise<ExtractionPayload> {
    return new Promise((resolve, reject) => {
      const ytdlpStartedAt = Date.now();
      const args = [
        '--dump-json',
        '--format', AUDIO_FORMAT_SELECTOR,
        '--no-download',
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
          let errorMessage = `yt-dlp exited with code ${code}`;
          if (stderr.includes('Sign in to confirm') || stderr.includes('not a bot')) {
            errorMessage = 'YouTube cookies expired. Run: bash scripts/refresh-cookies.sh';
          } else if (stderr.includes('Video unavailable') || stderr.includes('Private video')) {
            errorMessage = 'Video is unavailable or private';
          } else if (stderr.includes('Sign in to confirm your age')) {
            errorMessage = 'Age-restricted video (login required)';
          } else if (stderr.includes('network') || stderr.includes('timeout')) {
            errorMessage = 'Network connection error';
          } else if (stderr) {
            errorMessage += `: ${stderr.substring(0, 200)}`;
          }
          reject(new Error(errorMessage));
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
