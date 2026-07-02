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

/**
 * One background pre-fetch lane per platform. Lanes are fully independent —
 * the same URL queued on both platforms is never cross-deduped.
 */
interface PlatformLane {
  label: 'Bilibili' | 'YouTube';
  extractor: AudioExtractorLike | null;
  enabled: boolean;
  concurrency: number;
  maxPerCardSet: number;
  queue: PreExtractionQueueItem[];
  queuedOrRunning: Set<string>;
  activeCount: number;
  normalize(rawUrl: string): string | null;
  /** Platform-specific extract call (YouTube passes background priority). */
  invoke(url: string, context: PreExtractionContext): Promise<unknown>;
}

function normalizeBilibiliUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!UrlValidator.isValidBilibiliUrl(trimmed)) return null;
  return UrlValidator.normalizeUrl(trimmed) || trimmed;
}

function normalizeYouTubeUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!YouTubeValidator.isValidYouTubeUrl(trimmed)) return null;
  return YouTubeValidator.normalizeUrl(trimmed) || trimmed;
}

class PreExtractionService {
  private bilibili: PlatformLane;
  private youtube: PlatformLane;

  constructor(options: PreExtractionServiceOptions) {
    this.bilibili = {
      label: 'Bilibili',
      extractor: options.bilibiliExtractor,
      enabled: options.enabled ?? config.bilibili.preextractEnabled,
      concurrency: Math.max(1, options.concurrency ?? config.bilibili.preextractConcurrency),
      maxPerCardSet: Math.max(1, options.maxPerCardSet ?? config.bilibili.preextractMaxPerCardSet),
      queue: [],
      queuedOrRunning: new Set(),
      activeCount: 0,
      normalize: normalizeBilibiliUrl,
      invoke: (url) => options.bilibiliExtractor.extractAudio(url),
    };
    // Previously gated to the test guild during rollout — that made pre-extraction
    // a silent no-op in every real server, so playback always paid the full cold
    // yt-dlp cost. Now runs anywhere YouTube pre-extraction is enabled, matching
    // the Bilibili lane. Disable per-deployment via YOUTUBE_PREEXTRACT_ENABLED=false.
    const youtubeExtractor = options.youtubeExtractor ?? null;
    this.youtube = {
      label: 'YouTube',
      extractor: youtubeExtractor,
      enabled: (options.youtubeEnabled ?? config.youtube.preextractEnabled) && youtubeExtractor !== null,
      concurrency: Math.max(1, options.youtubeConcurrency ?? config.youtube.preextractConcurrency),
      maxPerCardSet: Math.max(1, options.youtubeMaxPerCardSet ?? config.youtube.preextractMaxPerCardSet),
      queue: [],
      queuedOrRunning: new Set(),
      activeCount: 0,
      normalize: normalizeYouTubeUrl,
      invoke: (url, context) => youtubeExtractor!.extractAudio(url, {
        priority: 'background',
        source: context.source,
      }),
    };
  }

  prewarmBilibiliUrls(urls: string[], context: PreExtractionContext): PreExtractionSummary {
    return this.prewarm(this.bilibili, urls, context);
  }

  prewarmYouTubeUrls(urls: string[], context: PreExtractionContext): PreExtractionSummary {
    return this.prewarm(this.youtube, urls, context);
  }

  private prewarm(
    lane: PlatformLane,
    urls: string[],
    context: PreExtractionContext,
  ): PreExtractionSummary {
    const input = Array.isArray(urls) ? urls : [];
    if (!lane.enabled) {
      return { queued: 0, skipped: input.length };
    }

    // normalize → per-batch dedupe → cap per card set
    const selected: string[] = [];
    const seenInBatch = new Set<string>();
    let skipped = 0;

    for (const rawUrl of input) {
      const normalizedUrl = lane.normalize(rawUrl);
      if (!normalizedUrl || seenInBatch.has(normalizedUrl) || selected.length >= lane.maxPerCardSet) {
        skipped++;
        if (normalizedUrl) seenInBatch.add(normalizedUrl);
        continue;
      }
      seenInBatch.add(normalizedUrl);
      selected.push(normalizedUrl);
    }

    // queue-level dedupe against in-flight/queued work
    let queued = 0;
    for (const url of selected) {
      if (lane.queuedOrRunning.has(url)) {
        skipped++;
        continue;
      }
      lane.queue.push({ url, context });
      lane.queuedOrRunning.add(url);
      queued++;
    }

    if (queued > 0) {
      logger.info(`${lane.label} pre-extraction queued`, {
        queued,
        skipped,
        source: context.source,
        guildId: context.guildId,
        keyword: context.keyword,
      });
      this.pump(lane);
    }

    return { queued, skipped };
  }

  private pump(lane: PlatformLane): void {
    while (lane.activeCount < lane.concurrency && lane.queue.length > 0) {
      const item = lane.queue.shift();
      if (!item) return;

      lane.activeCount++;
      void Promise.resolve()
        .then(() => lane.invoke(item.url, item.context))
        .then(() => {
          logger.info(`${lane.label} pre-extraction completed`, {
            source: item.context.source,
            guildId: item.context.guildId,
            keyword: item.context.keyword,
          });
        })
        .catch((error: unknown) => {
          logger.warn(`${lane.label} pre-extraction failed`, {
            source: item.context.source,
            guildId: item.context.guildId,
            keyword: item.context.keyword,
            error: (error as Error).message,
          });
        })
        .finally(() => {
          lane.activeCount--;
          lane.queuedOrRunning.delete(item.url);
          this.pump(lane);
        });
    }
  }
}

export = PreExtractionService;
