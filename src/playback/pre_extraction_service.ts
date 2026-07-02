import * as logger from '../services/logger_service';
import UrlValidator = require('../bilibili/validator');
import YouTubeValidator = require('../youtube/validator');
import config = require('../config/config');
import type { AudioExtractorLike } from '../services/types';

type PreExtractionSource = 'play_search' | 'search_command' | 'daily_recommendation';

interface PreExtractionContext {
  source: PreExtractionSource;
  guildId?: string;
  keyword?: string;
}

interface PreExtractionServiceOptions {
  bilibiliExtractor: AudioExtractorLike;
  youtubeExtractor?: AudioExtractorLike | null;
  enabled?: boolean;
  concurrency?: number;
  maxPerCardSet?: number;
  youtubeEnabled?: boolean;
  youtubeConcurrency?: number;
  youtubeMaxPerCardSet?: number;
}

interface PreExtractionQueueItem {
  url: string;
  context: PreExtractionContext;
}

interface PreExtractionSummary {
  queued: number;
  skipped: number;
}

class PreExtractionService {
  private bilibiliExtractor: AudioExtractorLike;
  private youtubeExtractor: AudioExtractorLike | null;
  private enabled: boolean;
  private concurrency: number;
  private maxPerCardSet: number;
  private queue: PreExtractionQueueItem[];
  private queuedOrRunning: Set<string>;
  private activeCount: number;
  private youtubeEnabled: boolean;
  private youtubeConcurrency: number;
  private youtubeMaxPerCardSet: number;
  private youtubeQueue: PreExtractionQueueItem[];
  private youtubeQueuedOrRunning: Set<string>;
  private youtubeActiveCount: number;

  constructor(options: PreExtractionServiceOptions) {
    this.bilibiliExtractor = options.bilibiliExtractor;
    this.youtubeExtractor = options.youtubeExtractor ?? null;
    this.enabled = options.enabled ?? config.bilibili.preextractEnabled;
    this.concurrency = Math.max(1, options.concurrency ?? config.bilibili.preextractConcurrency);
    this.maxPerCardSet = Math.max(1, options.maxPerCardSet ?? config.bilibili.preextractMaxPerCardSet);
    this.queue = [];
    this.queuedOrRunning = new Set();
    this.activeCount = 0;
    this.youtubeEnabled = options.youtubeEnabled ?? config.youtube.preextractEnabled;
    this.youtubeConcurrency = Math.max(1, options.youtubeConcurrency ?? config.youtube.preextractConcurrency);
    this.youtubeMaxPerCardSet = Math.max(1, options.youtubeMaxPerCardSet ?? config.youtube.preextractMaxPerCardSet);
    this.youtubeQueue = [];
    this.youtubeQueuedOrRunning = new Set();
    this.youtubeActiveCount = 0;
  }

  prewarmBilibiliUrls(urls: string[], context: PreExtractionContext): PreExtractionSummary {
    if (!this.enabled) {
      return { queued: 0, skipped: Array.isArray(urls) ? urls.length : 0 };
    }

    const input = Array.isArray(urls) ? urls : [];
    const selected: string[] = [];
    const seenInBatch = new Set<string>();
    let skipped = 0;

    for (const rawUrl of input) {
      const normalizedUrl = this.normalizeBilibiliUrl(rawUrl);
      if (!normalizedUrl) {
        skipped++;
        continue;
      }

      if (seenInBatch.has(normalizedUrl)) {
        skipped++;
        continue;
      }
      seenInBatch.add(normalizedUrl);

      if (selected.length >= this.maxPerCardSet) {
        skipped++;
        continue;
      }

      selected.push(normalizedUrl);
    }

    let queued = 0;
    for (const url of selected) {
      if (this.queuedOrRunning.has(url)) {
        skipped++;
        continue;
      }

      this.queue.push({ url, context });
      this.queuedOrRunning.add(url);
      queued++;
    }

    if (queued > 0) {
      logger.info('Bilibili pre-extraction queued', {
        queued,
        skipped,
        source: context.source,
        guildId: context.guildId,
        keyword: context.keyword,
      });
      this.pump();
    }

    return { queued, skipped };
  }

  private normalizeBilibiliUrl(rawUrl: string): string | null {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!UrlValidator.isValidBilibiliUrl(trimmed)) return null;
    return UrlValidator.normalizeUrl(trimmed) || trimmed;
  }

  prewarmYouTubeUrls(urls: string[], context: PreExtractionContext): PreExtractionSummary {
    const input = Array.isArray(urls) ? urls : [];
    // Previously gated to the test guild during rollout — that made pre-extraction
    // a silent no-op in every real server, so playback always paid the full cold
    // yt-dlp cost. Now runs anywhere YouTube pre-extraction is enabled, matching
    // prewarmBilibiliUrls. Disable per-deployment via YOUTUBE_PREEXTRACT_ENABLED=false.
    if (!this.youtubeEnabled || !this.youtubeExtractor) {
      return { queued: 0, skipped: input.length };
    }

    const selected: string[] = [];
    const seenInBatch = new Set<string>();
    let skipped = 0;

    for (const rawUrl of input) {
      const normalizedUrl = this.normalizeYouTubeUrl(rawUrl);
      if (!normalizedUrl) {
        skipped++;
        continue;
      }

      if (seenInBatch.has(normalizedUrl)) {
        skipped++;
        continue;
      }
      seenInBatch.add(normalizedUrl);

      if (selected.length >= this.youtubeMaxPerCardSet) {
        skipped++;
        continue;
      }

      selected.push(normalizedUrl);
    }

    let queued = 0;
    for (const url of selected) {
      if (this.youtubeQueuedOrRunning.has(url)) {
        skipped++;
        continue;
      }

      this.youtubeQueue.push({ url, context });
      this.youtubeQueuedOrRunning.add(url);
      queued++;
    }

    if (queued > 0) {
      logger.info('YouTube pre-extraction queued', {
        queued,
        skipped,
        source: context.source,
        guildId: context.guildId,
        keyword: context.keyword,
      });
      this.pumpYouTube();
    }

    return { queued, skipped };
  }

  private normalizeYouTubeUrl(rawUrl: string): string | null {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!YouTubeValidator.isValidYouTubeUrl(trimmed)) return null;
    return YouTubeValidator.normalizeUrl(trimmed) || trimmed;
  }

  private pump(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;

      this.activeCount++;
      void Promise.resolve()
        .then(() => this.bilibiliExtractor.extractAudio(item.url))
        .then(() => {
          logger.info('Bilibili pre-extraction completed', {
            source: item.context.source,
            guildId: item.context.guildId,
            keyword: item.context.keyword,
          });
        })
        .catch((error: unknown) => {
          logger.warn('Bilibili pre-extraction failed', {
            source: item.context.source,
            guildId: item.context.guildId,
            keyword: item.context.keyword,
            error: (error as Error).message,
          });
        })
        .finally(() => {
          this.activeCount--;
          this.queuedOrRunning.delete(item.url);
          this.pump();
        });
    }
  }

  private pumpYouTube(): void {
    while (this.youtubeActiveCount < this.youtubeConcurrency && this.youtubeQueue.length > 0) {
      const item = this.youtubeQueue.shift();
      if (!item || !this.youtubeExtractor) return;

      this.youtubeActiveCount++;
      void Promise.resolve()
        .then(() => this.youtubeExtractor!.extractAudio(item.url, {
          priority: 'background',
          source: item.context.source,
        }))
        .then(() => {
          logger.info('YouTube pre-extraction completed', {
            source: item.context.source,
            guildId: item.context.guildId,
            keyword: item.context.keyword,
          });
        })
        .catch((error: unknown) => {
          logger.warn('YouTube pre-extraction failed', {
            source: item.context.source,
            guildId: item.context.guildId,
            keyword: item.context.keyword,
            error: (error as Error).message,
          });
        })
        .finally(() => {
          this.youtubeActiveCount--;
          this.youtubeQueuedOrRunning.delete(item.url);
          this.pumpYouTube();
        });
    }
  }
}

export = PreExtractionService;
