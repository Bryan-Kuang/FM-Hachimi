import * as logger from '../services/logger_service';
import UrlValidator = require('../bilibili/validator');
import config = require('../config/config');

type PreExtractionSource = 'play_search' | 'search_command' | 'daily_recommendation';

interface BilibiliExtractorLike {
  extractAudio(url: string): Promise<unknown>;
}

interface PreExtractionContext {
  source: PreExtractionSource;
  guildId?: string;
  keyword?: string;
}

interface PreExtractionServiceOptions {
  bilibiliExtractor: BilibiliExtractorLike;
  enabled?: boolean;
  concurrency?: number;
  maxPerCardSet?: number;
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
  private bilibiliExtractor: BilibiliExtractorLike;
  private enabled: boolean;
  private concurrency: number;
  private maxPerCardSet: number;
  private queue: PreExtractionQueueItem[];
  private queuedOrRunning: Set<string>;
  private activeCount: number;

  constructor(options: PreExtractionServiceOptions) {
    this.bilibiliExtractor = options.bilibiliExtractor;
    this.enabled = options.enabled ?? config.bilibili.preextractEnabled;
    this.concurrency = Math.max(1, options.concurrency ?? config.bilibili.preextractConcurrency);
    this.maxPerCardSet = Math.max(1, options.maxPerCardSet ?? config.bilibili.preextractMaxPerCardSet);
    this.queue = [];
    this.queuedOrRunning = new Set();
    this.activeCount = 0;
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
}

export = PreExtractionService;
