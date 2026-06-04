/**
 * Bilibili Audio Extractor
 * Handles video URL processing and audio stream extraction
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as logger from '../services/logger_service';
import NativeBilibiliExtractor = require('./native_extractor');
import { emitPlaybackStage, type PlaybackStageReporter } from '../playback/stage_feedback';
import config = require('../config/config');
import ExpiringCache = require('../utils/expiring_cache');
import UrlValidator = require('./validator');

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

/** Platform-specific HTTP headers for FFmpeg to use when streaming. */
interface StreamHeaders {
  referer: string;
  userAgent: string;
}

interface ExtractedAudio extends VideoMetadata {
  audioUrl: string;
  platform: 'bilibili';
  originalUrl: string;
  normalizedUrl: string;
  extractedAt: string;
  extractionMethod?: 'native' | 'ytdlp' | 'ytdlp_fallback' | 'cache';
  extractionTiming?: Record<string, number | string | boolean | undefined>;
  formatId?: string;
  protocol?: string;
  audioCodec?: string;
  videoCodec?: string;
  /** Platform headers FFmpeg should send when fetching this audio URL. */
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

interface TestExtractionResult {
  success: boolean;
  result?: ExtractedAudio;
  error?: string;
  ytdlpAvailable: boolean;
  timestamp: string;
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
  onStage?: PlaybackStageReporter;
}

interface NativeExtractionPayload {
  metadata: VideoMetadata;
  audioUrl: string;
  selectedFormat: SelectedFormatMetadata;
  timing: {
    metadataApiMs: number;
    playurlApiMs: number;
    totalMs: number;
  };
}

interface ThumbnailEntry {
  url: string;
  width?: number;
  height?: number;
}

class BilibiliExtractor {
  private userAgent: string;
  private _ytdlpChecked: boolean;
  private _cookiesFile: string | null;
  private nativeExtractor: NativeBilibiliExtractor;
  // Shared ExpiringCache owns TTL eviction + size cap + cleanup timer.
  private videoInfoCache: ExpiringCache<VideoMetadata>;
  private extractionCache: ExpiringCache<ExtractedAudio>;
  private inFlightExtractions: Map<string, Promise<ExtractedAudio>>;

  constructor() {
    this.userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    this._ytdlpChecked = false; // Lazy check flag
    this._cookiesFile = this._resolveCookiesFile();
    this.nativeExtractor = new NativeBilibiliExtractor({
      userAgent: this.userAgent,
      cookiesFile: this._cookiesFile,
    });

    // Video metadata: 30-min TTL. Extraction (signed audio URLs): 10-min TTL.
    this.videoInfoCache = new ExpiringCache(30 * 60 * 1000, 100, { label: 'bilibili-videoinfo' });
    this.extractionCache = new ExpiringCache(10 * 60 * 1000, 100, { label: 'bilibili-extraction' });
    this.inFlightExtractions = new Map();
  }

  /**
   * Clear all cache entries
   */
  clearCache(): void {
    this.videoInfoCache.clear();
    this.extractionCache.clear();
    this.inFlightExtractions.clear();
    logger.info("Bilibili extractor caches cleared");
  }

  async prewarm(): Promise<{ ytdlpAvailable: boolean }> {
    const ytdlpAvailable = await this.checkYtDlpAvailability();
    if (ytdlpAvailable) {
      this._ytdlpChecked = true;
    }
    return { ytdlpAvailable };
  }

  /**
   * Cleanup resources when extractor is destroyed
   */
  destroy(): void {
    this.videoInfoCache.dispose();
    this.extractionCache.dispose();
    this.inFlightExtractions.clear();
  }

  /**
   * Resolve the cookies file path from config
   * @returns {string|null} - Resolved cookie file path, or null if not configured/invalid
   */
  _resolveCookiesFile(): string | null {
    const cookiesFile = config.bilibili?.cookiesFile;
    if (!cookiesFile) return null;

    if (fs.existsSync(cookiesFile)) {
      logger.info("Bilibili cookies file configured", { path: cookiesFile });
      return cookiesFile;
    }

    logger.warn("Bilibili cookies file not found", { path: cookiesFile });
    return null;
  }

  /**
   * Get yt-dlp cookie arguments if a cookies file is configured
   * @returns {Array<string>} - Cookie-related args for yt-dlp
   */
  _getCookieArgs(): string[] {
    if (this._cookiesFile && fs.existsSync(this._cookiesFile)) {
      return ["--cookies", this._cookiesFile];
    }
    return [];
  }

  /**
   * Extract audio stream URL and metadata from Bilibili video
   * @param {string} url - Bilibili video URL
   * @param {number} retryCount - Current retry attempt
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<Object>} - Video metadata and audio stream info
   */
  async extractAudio(
    url: string,
    retryCount = 0,
    maxRetries = 2,
    options: ExtractionOptions = {},
  ): Promise<ExtractedAudio> {
    const totalStartedAt = Date.now();
    logger.info("Starting audio extraction", { url, attempt: retryCount + 1 });

    try {
      // Validate URL first
      if (!UrlValidator.isValidBilibiliUrl(url)) {
        throw new Error("Invalid Bilibili URL format");
      }

      // Normalize URL
      const normalizedUrl = UrlValidator.normalizeUrl(url);
      if (!normalizedUrl) {
        throw new Error("Failed to normalize URL");
      }

      const cached = this.extractionCache.get(normalizedUrl);
      if (cached) {
        logger.info("Bilibili extraction cache hit", {
          url: normalizedUrl,
          title: cached.title,
          cacheAgeMs: this.extractionCache.ageMs(normalizedUrl) ?? 0,
        });
        this.logExtractionTiming({
          method: 'cache',
          cacheHit: true,
          ytdlpMs: 0,
          parseMs: 0,
          totalMs: Date.now() - totalStartedAt,
          ...this.selectedFormatFromExtractedAudio(cached),
        });
        return cached;
      }

      if (retryCount === 0) {
        const inFlight = this.inFlightExtractions.get(normalizedUrl);
        if (inFlight) {
          logger.info("Bilibili extraction joined in-flight request", { url: normalizedUrl });
          return inFlight;
        }

        const extraction = this.extractAudioUncached(url, normalizedUrl, retryCount, maxRetries, totalStartedAt, options)
          .finally(() => {
            this.inFlightExtractions.delete(normalizedUrl);
          });
        this.inFlightExtractions.set(normalizedUrl, extraction);
        return extraction;
      }

      return await this.extractAudioUncached(url, normalizedUrl, retryCount, maxRetries, totalStartedAt, options);
    } catch (error) {
      logger.error("Audio extraction failed", {
        url,
        error: (error as Error).message,
        attempt: retryCount + 1,
        maxRetries: maxRetries,
      });

      const message = (error as Error).message;
      throw new Error(message.startsWith('Audio extraction failed:')
        ? message
        : `Audio extraction failed: ${message}`);
    }
  }

  private async extractAudioUncached(
    url: string,
    normalizedUrl: string,
    retryCount: number,
    maxRetries: number,
    totalStartedAt: number,
    options: ExtractionOptions = {},
  ): Promise<ExtractedAudio> {
    let fallbackReason: string | undefined;

    try {
      if (config.bilibili.nativeExtractorEnabled) {
        try {
          const nativePayload = await this.nativeExtractor.extract(normalizedUrl);
          const result = this.createExtractedAudioFromNativePayload(url, normalizedUrl, nativePayload);

          this.extractionCache.set(normalizedUrl, result);

          logger.info("Bilibili native extraction completed successfully", {
            url,
            title: result.title,
            duration: result.duration,
          });

          this.logExtractionTiming({
            method: 'native',
            cacheHit: false,
            ytdlpMs: 0,
            parseMs: 0,
            totalMs: Date.now() - totalStartedAt,
            metadataApiMs: nativePayload.timing.metadataApiMs,
            playurlApiMs: nativePayload.timing.playurlApiMs,
            ...nativePayload.selectedFormat,
          });

          return result;
        } catch (nativeError: unknown) {
          fallbackReason = (nativeError as Error).message;
          logger.warn("Bilibili native extraction failed; falling back to yt-dlp", {
            url: normalizedUrl,
            reason: fallbackReason,
          });
          emitPlaybackStage(options.onStage, 'fallback_to_ytdlp', { reason: fallbackReason });

          if (!config.bilibili.nativeFallbackToYtdlp) {
            throw nativeError;
          }
        }
      }

      // Check yt-dlp availability on first fallback use (lazy check)
      if (!this._ytdlpChecked) {
        const ytdlpAvailable = await this.checkYtDlpAvailability();
        if (!ytdlpAvailable) {
          throw new Error(
            "yt-dlp is not available. Please install it: pip install yt-dlp"
          );
        }
        this._ytdlpChecked = true;
        logger.info("yt-dlp availability confirmed");
      }

      // Single yt-dlp call: --dump-json with --format bestaudio/best gives us
      // both metadata AND the audio URL in one process spawn + HTTP round-trip.
      const { metadata, audioUrl, selectedFormat, ytdlpMs, parseMs } =
        await this.extractMetadataAndUrl(normalizedUrl);

      const result: ExtractedAudio = {
        ...metadata,
        audioUrl,
        ...selectedFormat,
        platform: 'bilibili',
        originalUrl: url,
        normalizedUrl: normalizedUrl,
        extractedAt: new Date().toISOString(),
        extractionMethod: fallbackReason ? 'ytdlp_fallback' : 'ytdlp',
        extractionTiming: {
          method: fallbackReason ? 'ytdlp_fallback' : 'ytdlp',
          ytdlpMs,
          parseMs,
          totalMs: Date.now() - totalStartedAt,
        },
        streamHeaders: {
          referer: 'https://www.bilibili.com/',
          userAgent: this.userAgent,
        },
      };

      this.extractionCache.set(normalizedUrl, result);

      logger.info("Audio extraction completed successfully", {
        url,
        title: result.title,
        duration: result.duration,
      });

      this.logExtractionTiming({
        method: fallbackReason ? 'ytdlp_fallback' : 'ytdlp',
        cacheHit: false,
        ytdlpMs,
        parseMs,
        totalMs: Date.now() - totalStartedAt,
        fallbackReason,
        ...selectedFormat,
      });

      return result;
    } catch (error) {
      logger.error("Audio extraction failed", {
        url,
        error: (error as Error).message,
        attempt: retryCount + 1,
        maxRetries: maxRetries,
      });

      // 如果是网络相关错误且还有重试次数，则重试
      if (retryCount < maxRetries && this.isRetryableError(error as Error)) {
        logger.info("Retrying audio extraction", {
          url,
          nextAttempt: retryCount + 2,
          delay: (retryCount + 1) * 3000,
        });

        // 等待递增延迟后重试
        await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 3000));
        return await this.extractAudioUncached(url, normalizedUrl, retryCount + 1, maxRetries, totalStartedAt, options);
      }

      throw new Error(`Audio extraction failed: ${(error as Error).message}`);
    }
  }

  /**
   * Single yt-dlp invocation: extract both metadata and audio URL.
   * Uses --dump-json --format bestaudio/best which includes the resolved
   * download URL in `requested_downloads[0].url` — eliminating the need for
   * a separate --get-url call (saves 1-3 seconds of network latency).
   */
  private async extractMetadataAndUrl(normalizedUrl: string): Promise<ExtractionPayload> {
    return new Promise((resolve, reject) => {
      const ytdlpStartedAt = Date.now();
      const args = [
        "--dump-json",
        "--format", "bestaudio/best",
        "--no-download",
        "--no-check-certificate",
        "--no-warnings",
        "--user-agent", this.userAgent,
        ...this._getCookieArgs(),
        normalizedUrl,
      ];

      logger.debug("Executing yt-dlp for metadata + audio URL (single call)", { url: normalizedUrl });

      const ytdlp: ChildProcess = spawn("yt-dlp", args);
      let stdout = "";
      let stderr = "";

      ytdlp.stdout!.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      ytdlp.stderr!.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      ytdlp.on("close", (code: number | null) => {
        const ytdlpMs = Date.now() - ytdlpStartedAt;
        if (code !== 0 && code !== null) {
          if (code === 137 || code === 143) {
            reject(new Error("Audio extraction timeout"));
            return;
          }

          let errorMessage = `yt-dlp exited with code ${code}`;
          if (stderr.includes('Video unavailable')) {
            errorMessage = 'Video is unavailable or private';
          } else if (stderr.includes('network') || stderr.includes('timeout')) {
            errorMessage = 'Network connection error';
          } else if (stderr.includes('certificate') || stderr.includes('SSL')) {
            errorMessage = 'SSL certificate error';
          } else if (stderr) {
            errorMessage += `: ${stderr}`;
          }

          reject(new Error(errorMessage));
          return;
        }

        try {
          const parseStartedAt = Date.now();
          const lines = stdout.split('\n').filter(l => l.trim());
          const jsonLine = lines.find(l => l.trim().startsWith('{'));
          if (!jsonLine) {
            throw new Error('No JSON object found in yt-dlp output');
          }
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

          // Cache metadata
          this.videoInfoCache.set(normalizedUrl, metadata);

          resolve({
            metadata,
            audioUrl,
            selectedFormat,
            ytdlpMs,
            parseMs: Date.now() - parseStartedAt,
          });
        } catch (parseError) {
          logger.error("Failed to parse yt-dlp JSON output", {
            error: (parseError as Error).message,
            stdout: stdout.substring(0, 500),
          });
          reject(new Error(`Failed to parse yt-dlp output: ${(parseError as Error).message}`));
        }
      });

      ytdlp.on("error", (error: NodeJS.ErrnoException) => {
        let errorMessage = 'yt-dlp process error';
        if (error.code === 'ENOENT') {
          errorMessage = 'yt-dlp is not installed or not found in PATH';
        } else if (error.message) {
          errorMessage += `: ${error.message}`;
        }
        reject(new Error(errorMessage));
      });

      // 30 second timeout
      const timeoutId = setTimeout(() => {
        ytdlp.kill('SIGTERM');
        setTimeout(() => { if (!ytdlp.killed) ytdlp.kill('SIGKILL'); }, 2000);
        reject(new Error("Audio extraction timeout"));
      }, 30000).unref();

      const clearKillTimeout = () => clearTimeout(timeoutId);
      ytdlp.on('close', clearKillTimeout);
      ytdlp.on('error', clearKillTimeout);
    });
  }

  private createExtractedAudioFromNativePayload(
    originalUrl: string,
    normalizedUrl: string,
    payload: NativeExtractionPayload,
  ): ExtractedAudio {
    const extractionTiming = {
      method: 'native',
      metadataApiMs: payload.timing.metadataApiMs,
      playurlApiMs: payload.timing.playurlApiMs,
      totalMs: payload.timing.totalMs,
    };

    return {
      ...payload.metadata,
      audioUrl: payload.audioUrl,
      ...payload.selectedFormat,
      platform: 'bilibili',
      originalUrl,
      normalizedUrl,
      extractedAt: new Date().toISOString(),
      extractionMethod: 'native',
      extractionTiming,
      streamHeaders: {
        referer: 'https://www.bilibili.com/',
        userAgent: this.userAgent,
      },
    };
  }

  /**
   * Get video metadata using yt-dlp
   * @param {string} url - Normalized Bilibili URL
   * @returns {Promise<Object>} - Video metadata
   */
  /**
   * Get video information with caching support
   * @param {string} url - Bilibili video URL
   * @returns {Promise<Object>} - Video metadata
   */
  async getVideoInfo(url: string): Promise<VideoMetadata> {
    // Create cache key from normalized URL
    const normalizedUrl = UrlValidator.normalizeUrl(url);
    const cacheKey = normalizedUrl || url;

    // Check cache first
    const cached = this.videoInfoCache.get(cacheKey);
    if (cached) {
      logger.debug("Video info retrieved from cache", { url: cacheKey });
      return cached;
    }

    // If not in cache or expired, fetch from yt-dlp
    logger.debug("Fetching video info from yt-dlp", { url: cacheKey });

    return new Promise((resolve, reject) => {
      const args = [
        "--dump-json",
        "--no-download",
        "--no-check-certificate",
        "--no-warnings",
        "--user-agent",
        this.userAgent,
        ...this._getCookieArgs(),
        url,
      ];

      logger.debug("Executing yt-dlp for video info", { args });

      const ytdlp: ChildProcess = spawn("yt-dlp", args);
      let stdout = "";
      let stderr = "";

      ytdlp.stdout!.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      ytdlp.stderr!.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      ytdlp.on("close", (code: number | null) => {
        if (code !== 0 && code !== null) {
          // 忽略进程被终止的情况
          if (code === 137 || code === 143) {
            logger.warn("yt-dlp process was terminated", {
              code,
              url,
            });
            reject(new Error("Video info extraction timeout"));
            return;
          }

          logger.error("yt-dlp failed to get video info", {
            code,
            stderr,
            url,
          });

          // 提供更具体的错误信息
          let errorMessage = `yt-dlp exited with code ${code}`;
          if (stderr.includes('Video unavailable')) {
            errorMessage = 'Video is unavailable or private';
          } else if (stderr.includes('network') || stderr.includes('timeout')) {
            errorMessage = 'Network connection error';
          } else if (stderr.includes('certificate') || stderr.includes('SSL')) {
            errorMessage = 'SSL certificate error';
          } else if (stderr) {
            errorMessage += `: ${stderr}`;
          }

          reject(new Error(errorMessage));
          return;
        }

        try {
          // yt-dlp --dump-json outputs one JSON object per line;
          // extra lines (warnings, progress) may appear — find the first valid JSON line
          const lines = stdout.split('\n').filter(l => l.trim());
          const jsonLine = lines.find(l => l.trim().startsWith('{'));
          if (!jsonLine) {
            throw new Error('No JSON object found in yt-dlp output');
          }
          const videoData = JSON.parse(jsonLine) as Record<string, unknown>;
          const metadata = this.parseVideoMetadata(videoData);

          // Cache the result
          this.videoInfoCache.set(cacheKey, metadata);

          logger.debug("Video info cached", {
            url: cacheKey,
            cacheSize: this.videoInfoCache.size
          });

          resolve(metadata);
        } catch (parseError) {
          logger.error("Failed to parse video metadata", {
            error: (parseError as Error).message,
            stdout: stdout.substring(0, 500),
            stdoutTail: stdout.substring(Math.max(0, stdout.length - 200)),
            stdoutLength: stdout.length,
          });
          reject(
            new Error(`Failed to parse video metadata: ${(parseError as Error).message}`)
          );
        }
      });

      ytdlp.on("error", (error: NodeJS.ErrnoException) => {
        logger.error("yt-dlp process error", { error: error.message });

        // 提供更具体的错误信息
        let errorMessage = 'yt-dlp process error';
        if (error.code === 'ENOENT') {
          errorMessage = 'yt-dlp is not installed or not found in PATH';
        } else if (error.message) {
          errorMessage += `: ${error.message}`;
        }

        reject(new Error(errorMessage));
      });

      // Set timeout for the operation (.unref() so it doesn't block process exit)
      const timeoutId = setTimeout(() => {
        ytdlp.kill('SIGTERM');
        // Force kill after 2 seconds if still running
        setTimeout(() => {
          if (!ytdlp.killed) {
            ytdlp.kill('SIGKILL');
          }
        }, 2000);
        reject(new Error("Video info extraction timeout"));
      }, 30000).unref(); // 30 seconds timeout

      // Clear timeout when process ends (close or error — whichever fires first)
      const clearKillTimeout = () => clearTimeout(timeoutId);
      ytdlp.on('close', clearKillTimeout);
      ytdlp.on('error', clearKillTimeout);
    });
  }

  /**
   * Get audio stream URL using yt-dlp
   * @param {string} url - Normalized Bilibili URL
   * @returns {Promise<string>} - Audio stream URL
   */
  async getAudioStreamUrl(url: string): Promise<string> {
    const normalizedUrl = UrlValidator.normalizeUrl(url) || url;
    if (config.bilibili.nativeExtractorEnabled) {
      try {
        const nativePayload = await this.nativeExtractor.extract(normalizedUrl);
        logger.info("Bilibili native stream URL refresh completed", {
          url: normalizedUrl,
          method: 'native',
          formatId: nativePayload.selectedFormat.formatId,
          protocol: nativePayload.selectedFormat.protocol,
        });
        return nativePayload.audioUrl;
      } catch (nativeError: unknown) {
        logger.warn("Bilibili native stream URL refresh failed; falling back to yt-dlp", {
          url: normalizedUrl,
          reason: (nativeError as Error).message,
        });
        if (!config.bilibili.nativeFallbackToYtdlp) {
          throw nativeError;
        }
      }
    }

    return new Promise((resolve, reject) => {
      const args = [
        "--get-url",
        "--format",
        "bestaudio/best",
        "--no-check-certificate",
        "--no-warnings",
        "--user-agent",
        this.userAgent,
        ...this._getCookieArgs(),
        url,
      ];

      logger.debug("Executing yt-dlp for audio stream URL", { args });

      const ytdlp: ChildProcess = spawn("yt-dlp", args);
      let stdout = "";
      let stderr = "";

      ytdlp.stdout!.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      ytdlp.stderr!.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      ytdlp.on("close", (code: number | null) => {
        if (code !== 0 && code !== null) {
          // 忽略进程被终止的情况
          if (code === 137 || code === 143) {
            logger.warn("yt-dlp process was terminated", {
              code,
              url,
            });
            reject(new Error("Audio stream URL extraction timeout"));
            return;
          }

          logger.error("yt-dlp failed to get audio stream URL", {
            code,
            stderr,
            url,
          });

          // 提供更具体的错误信息
          let errorMessage = `yt-dlp exited with code ${code}`;
          if (stderr.includes('Video unavailable')) {
            errorMessage = 'Video is unavailable or private';
          } else if (stderr.includes('network') || stderr.includes('timeout')) {
            errorMessage = 'Network connection error';
          } else if (stderr.includes('certificate') || stderr.includes('SSL')) {
            errorMessage = 'SSL certificate error';
          } else if (stderr.includes('No audio stream')) {
            errorMessage = 'No audio stream available for this video';
          } else if (stderr) {
            errorMessage += `: ${stderr}`;
          }

          reject(new Error(errorMessage));
          return;
        }

        const audioUrl = stdout.trim();
        if (!audioUrl) {
          reject(new Error("No audio stream URL found"));
          return;
        }

        resolve(audioUrl);
      });

      ytdlp.on("error", (error: NodeJS.ErrnoException) => {
        logger.error("yt-dlp process error for audio stream", {
          error: error.message,
        });

        // 提供更具体的错误信息
        let errorMessage = 'yt-dlp process error';
        if (error.code === 'ENOENT') {
          errorMessage = 'yt-dlp is not installed or not found in PATH';
        } else if (error.message) {
          errorMessage += `: ${error.message}`;
        }

        reject(new Error(errorMessage));
      });

      // Set timeout for the operation (.unref() so it doesn't block process exit)
      const timeoutId = setTimeout(() => {
        ytdlp.kill('SIGTERM');
        // Force kill after 2 seconds if still running
        setTimeout(() => {
          if (!ytdlp.killed) {
            ytdlp.kill('SIGKILL');
          }
        }, 2000);
        reject(new Error("Audio stream URL extraction timeout"));
      }, 30000).unref(); // 30 seconds timeout

      // Clear timeout when process ends (close or error — whichever fires first)
      const clearKillTimeout = () => clearTimeout(timeoutId);
      ytdlp.on('close', clearKillTimeout);
      ytdlp.on('error', clearKillTimeout);
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
    method: 'native' | 'ytdlp' | 'ytdlp_fallback' | 'cache';
    cacheHit: boolean;
    ytdlpMs: number;
    parseMs: number;
    totalMs: number;
    metadataApiMs?: number;
    playurlApiMs?: number;
    fallbackReason?: string;
  } & SelectedFormatMetadata): void {
    logger.info("Bilibili extraction timing", { ...timing });
  }

  /**
   * Parse and normalize video metadata from yt-dlp output
   * @param {Object} videoData - Raw video data from yt-dlp
   * @returns {Object} - Normalized metadata
   */
  parseVideoMetadata(videoData: Record<string, unknown>): VideoMetadata {
    const metadata: VideoMetadata = {
      success: true,
      title: (videoData.title as string) || "Unknown Title",
      description: (videoData.description as string) || "",
      duration: (videoData.duration as number) || 0,
      uploader: (videoData.uploader as string) || (videoData.channel as string) || "Unknown",
      uploadDate: (videoData.upload_date as string) || null,
      viewCount: (videoData.view_count as number) || 0,
      likeCount: (videoData.like_count as number) || 0,
      thumbnail: this.selectBestThumbnail(videoData.thumbnails as ThumbnailEntry[] | undefined),
      videoId: this.extractVideoId(
        (videoData.webpage_url as string) || (videoData.original_url as string)
      ),
      id: this.extractVideoId(
        (videoData.webpage_url as string) || (videoData.original_url as string)
      ),
      url: (videoData.webpage_url as string) || (videoData.original_url as string),
      webpage_url: videoData.webpage_url as string,
    };

    // Parse upload date if available
    if (metadata.uploadDate) {
      try {
        const year = metadata.uploadDate.substring(0, 4);
        const month = metadata.uploadDate.substring(4, 6);
        const day = metadata.uploadDate.substring(6, 8);
        metadata.uploadDateFormatted = `${year}-${month}-${day}`;
      } catch (error) {
        logger.warn("Failed to parse upload date", {
          uploadDate: metadata.uploadDate,
        });
      }
    }

    logger.debug("Parsed video metadata", {
      title: metadata.title,
      duration: metadata.duration,
      uploader: metadata.uploader,
    });

    return metadata;
  }

  /**
   * Select the best thumbnail from available options
   * @param {Array} thumbnails - Array of thumbnail objects
   * @returns {string} - Best thumbnail URL
   */
  selectBestThumbnail(thumbnails: ThumbnailEntry[] | undefined | null): string | null {
    if (!thumbnails || !Array.isArray(thumbnails) || thumbnails.length === 0) {
      return null;
    }

    // Sort by resolution (width * height) and pick the highest
    const sorted = thumbnails
      .filter((thumb) => thumb.url && thumb.width && thumb.height)
      .sort((a, b) => (b.width! * b.height!) - (a.width! * a.height!));

    return sorted.length > 0 ? sorted[0].url : thumbnails[0].url;
  }

  /**
   * Extract video ID from URL
   * @param {string} url - Video URL
   * @returns {string} - Video ID
   */
  extractVideoId(url: string): string | null {
    if (!url) return null;

    const videoInfo = UrlValidator.extractVideoId(url);
    return videoInfo ? videoInfo.id : null;
  }

  /**
   * Check if an error is retryable (network-related)
   * @param {Error} error - The error to check
   * @returns {boolean} - True if the error is retryable
   */
  isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Network-related errors that can be retried
    const retryableErrors = [
      'timeout',
      'network',
      'connection',
      'econnreset',
      'enotfound',
      'econnrefused',
      'etimedout',
      'socket hang up',
      'certificate',
      'ssl',
      'tls',
      'temporary failure',
      'service unavailable',
      '502',
      '503',
      '504'
    ];

    return retryableErrors.some(errorType => message.includes(errorType));
  }

  /**
   * Check if yt-dlp is available on the system
   * @returns {Promise<boolean>} - True if yt-dlp is available
   */
  async checkYtDlpAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      const ytdlp: ChildProcess = spawn("yt-dlp", ["--version"]);

      ytdlp.on("close", (code: number | null) => {
        resolve(code === 0);
      });

      ytdlp.on("error", () => {
        resolve(false);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        ytdlp.kill();
        resolve(false);
      }, 5000);
    });
  }

  /**
   * Test extraction with a sample URL (for development/testing)
   * @param {string} testUrl - Test URL (optional)
   * @returns {Promise<Object>} - Test results
   */
  async testExtraction(
    testUrl = "https://www.bilibili.com/video/BV1uv4y1q7Mv"
  ): Promise<TestExtractionResult> {
    logger.info("Starting extraction test", { testUrl });

    try {
      // Check yt-dlp availability
      const ytdlpAvailable = await this.checkYtDlpAvailability();
      if (!ytdlpAvailable) {
        throw new Error("yt-dlp is not available on this system");
      }

      // Perform extraction
      const result = await this.extractAudio(testUrl);

      return {
        success: true,
        result,
        ytdlpAvailable,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Extraction test failed", {
        testUrl,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: (error as Error).message,
        ytdlpAvailable: await this.checkYtDlpAvailability(),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Search for Bilibili videos by keyword
   * @param {string} keyword - Search keyword
   * @param {number} maxResults - Maximum number of results (default: 10)
   * @returns {Promise<Object>} - Search results with video info
   */
  async searchVideos(keyword: string, maxResults = 10): Promise<SearchResponse> {
    logger.info("Starting Bilibili video search", { keyword, maxResults });

    try {
      // Check yt-dlp availability
      if (!this._ytdlpChecked) {
        const ytdlpAvailable = await this.checkYtDlpAvailability();
        if (!ytdlpAvailable) {
          throw new Error(
            "yt-dlp is not available. Please install it: pip install yt-dlp"
          );
        }
        this._ytdlpChecked = true;
      }

      // Step 1: Get video IDs using bilisearch
      const searchQuery = `bilisearch${maxResults}:${keyword}`;
      const videoIds = await this.getSearchVideoIds(searchQuery);

      if (!videoIds || videoIds.length === 0) {
        return {
          success: true,
          results: [],
          keyword,
          timestamp: new Date().toISOString()
        };
      }

      // Step 2: Get detailed info for each video
      const results = await this.getVideoDetailsForSearch(videoIds);

      logger.info("Search completed successfully", {
        keyword,
        resultCount: results.length
      });

      return {
        success: true,
        results,
        keyword,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error("Search error", { error: (error as Error).message, keyword });
      return {
        success: false,
        error: (error as Error).message,
        keyword,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get video IDs from bilisearch
   * @param {string} searchQuery - Search query for bilisearch
   * @returns {Promise<Array>} - Array of video IDs
   */
  async getSearchVideoIds(searchQuery: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const ytdlpProcess: ChildProcess = spawn("yt-dlp", [
        searchQuery,
        "--get-id",
        "--no-download",
        "--flat-playlist",
        ...this._getCookieArgs()
      ]);

      let stdout = "";
      let stderr = "";

      ytdlpProcess.stdout!.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      ytdlpProcess.stderr!.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      ytdlpProcess.on("close", (code: number | null) => {
        if (code !== 0) {
          logger.error("yt-dlp search failed", { code, stderr, searchQuery });
          reject(new Error(`Search failed: ${stderr}`));
          return;
        }

        const videoIds = stdout.trim().split('\n').filter(id => id.trim());
        resolve(videoIds);
      });

      ytdlpProcess.on("error", (error: Error) => {
        logger.error("yt-dlp process error during search", {
          error: error.message,
          searchQuery
        });
        reject(error);
      });
    });
  }

  /**
   * Get detailed video information for search results
   * @param {Array} videoIds - Array of video IDs
   * @returns {Promise<Array>} - Array of video details
   */
  /**
   * Get detailed video information for search results with optimized batch processing
   * @param {Array} videoIds - Array of video IDs
   * @returns {Promise<Array>} - Array of video details
   */
  async getVideoDetailsForSearch(videoIds: string[]): Promise<SearchResult[]> {
    // Dynamic concurrent limit based on number of videos
    const maxConcurrent = Math.min(5, Math.max(2, Math.ceil(videoIds.length / 3)));

    logger.debug("Starting batch video details extraction", {
      totalVideos: videoIds.length,
      concurrentLimit: maxConcurrent
    });

    // Process all videos concurrently with Promise.allSettled for better performance
    const allPromises = videoIds.map(async (videoId, index) => {
      try {
        // Add staggered delay to avoid overwhelming the server
        const delay = Math.floor(index / maxConcurrent) * 100; // 100ms delay per batch
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Convert numeric ID to BV format URL
        const videoUrl = `https://www.bilibili.com/video/av${videoId}`;

        // Reduced timeout for faster processing
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Video info timeout for ${videoId}`));
          }, 8000); // Reduced to 8 seconds per video
        });

        const videoInfo = await Promise.race([
          this.getVideoInfo(videoUrl),
          timeoutPromise
        ]);

        if (videoInfo.success) {
          return {
            title: videoInfo.title,
            id: videoInfo.id as string,
            url: videoInfo.url,
            duration: videoInfo.duration || 'Unknown',
            uploader: videoInfo.uploader || 'Unknown',
            viewCount: videoInfo.viewCount || '0',
            thumbnail: videoInfo.thumbnail || null,
            index // Keep original order for sorting
          };
        }
      } catch (error) {
        logger.warn("Failed to get video details", {
          videoId,
          error: (error as Error).message
        });
        // Continue with other videos even if one fails
      }
      return null;
    });

    // Wait for all requests to complete
    const allResults = await Promise.allSettled(allPromises);

    // Filter successful results and maintain original order
    type SearchResultWithIndex = SearchResult & { index: number };
    const successfulResults = (allResults as PromiseSettledResult<SearchResult | null>[])
      .filter((result): result is PromiseFulfilledResult<SearchResultWithIndex> =>
        result.status === 'fulfilled' && result.value !== null && result.value !== undefined
      )
      .map(result => result.value)
      .sort((a, b) => a.index - b.index) // Maintain original order
      .map(({ index: _index, ...rest }) => rest); // Remove index field (underscore to satisfy lint)

    logger.debug("Batch video details extraction completed", {
      totalRequested: videoIds.length,
      successfulResults: successfulResults.length,
      failedResults: videoIds.length - successfulResults.length
    });

    return successfulResults;
  }

  /**
   * Parse search results from yt-dlp output
   * @param {string} output - Raw yt-dlp output
   * @returns {Array} - Parsed search results
   */
  parseSearchResults(output: string): SearchResult[] {
    const lines = output.trim().split('\n').filter(line => line.trim());
    const results: SearchResult[] = [];

    for (const line of lines) {
      const parts = line.split('|||');
      if (parts.length >= 6) {
        const [title, id, duration, uploader, viewCount, thumbnail] = parts;

        results.push({
          title: title.trim(),
          id: id.trim(),
          url: `https://www.bilibili.com/video/${id.trim()}`,
          duration: duration.trim() || 'Unknown',
          uploader: uploader.trim() || 'Unknown',
          viewCount: viewCount.trim() || '0',
          thumbnail: thumbnail.trim() || null
        });
      }
    }

    return results;
  }
}

export = BilibiliExtractor;
