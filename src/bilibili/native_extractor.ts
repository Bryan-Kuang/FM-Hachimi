/**
 * Thin adapter over the extracted `@bryan-kuang/bilibili-audio-extractor`
 * package (which grew out of this file). Preserves the payload shape
 * BilibiliExtractor and its tests expect; the extraction mechanics — WBI
 * request signing, anonymous buvid bootstrap (avoids Bilibili's risk-control
 * HTTP 412 on a made-up cookie), DASH stream selection, b23.tv short-link
 * resolution — live upstream.
 */

import upstream = require('@bryan-kuang/bilibili-audio-extractor');
import asyncHooks = require('node:async_hooks');
import * as logger from '../services/logger_service';
import * as requestGuard from './request_guard';
import { isRiskControlRejection } from './request_guard';

interface DashAudioSource {
  id?: number;
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
}

interface NativeExtractorOptions {
  userAgent: string;
  cookiesFile?: string | null;
}

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

interface SelectedFormatMetadata {
  formatId?: string;
  protocol?: string;
  audioCodec?: string;
  videoCodec: string;
}

interface NativeExtractionPayload {
  metadata: VideoMetadata;
  audioUrl: string;
  backupAudioUrls: string[];
  selectedFormat: SelectedFormatMetadata;
  timing: {
    metadataApiMs: number;
    playurlApiMs: number;
    totalMs: number;
  };
}

const COOKIE_REJECTION_COOLDOWN_MS = 60 * 60 * 1000;

class NativeBilibiliExtractor {
  private options: NativeExtractorOptions;
  private extractor: upstream.BilibiliAudioExtractor;
  // Built on first risk-control rejection; see extractWithRiskControlFallback().
  private anonymousExtractor: upstream.BilibiliAudioExtractor | null = null;
  private cookiesRejectedUntil = 0;
  // Preserve upstream's WBI/buvid caches without sharing one video's manifest
  // with another guild's concurrent extraction.
  private audioSources = new asyncHooks.AsyncLocalStorage<{ audio: DashAudioSource[] }>();

  constructor(options: NativeExtractorOptions) {
    this.options = options;
    this.extractor = this.createUpstream(options.cookiesFile ?? null);
  }

  private createUpstream(cookiesFile: string | null): upstream.BilibiliAudioExtractor {
    return new upstream.BilibiliAudioExtractor({
      userAgent: this.options.userAgent,
      cookiesFile,
      fetchJson: async (url, init) => {
        await requestGuard.acquireSlot(requestKind(url));
        const response = await fetch(toRiskControlTolerantUrl(url), {
          headers: init.headers,
          signal: AbortSignal.timeout(init.timeoutMs),
        });
        if (!response.ok) {
          throw new Error(`Bilibili API request failed: HTTP ${response.status}`);
        }
        const body = await response.json() as { data?: { dash?: { audio?: DashAudioSource[] } } };
        const sources = this.audioSources.getStore();
        if (sources && new URL(url).pathname === '/x/player/wbi/playurl') {
          sources.audio = body.data?.dash?.audio ?? [];
        }
        return body;
      },
    });
  }

  /**
   * HTTP 412 is Bilibili risk control rejecting the client fingerprint, and
   * the configured cookie file *is* that fingerprint (buvid3/buvid4 plus any
   * X-BILI-SEC-TOKEN it picked up). Retrying with the same cookies can never
   * succeed — on 2026-10-11 it kept every extraction failing for days across
   * restarts — so fall back to an anonymous session with a freshly issued
   * buvid, and stay anonymous for a while instead of re-offering the rejected
   * cookies on every track.
   */
  private async extractWithRiskControlFallback(normalizedUrl: string) {
    const useCookies = Boolean(this.options.cookiesFile) && Date.now() >= this.cookiesRejectedUntil;
    if (useCookies) {
      try {
        return await this.extractor.extract(normalizedUrl);
      } catch (error) {
        if (!isRiskControlRejection(error)) throw error;
        this.cookiesRejectedUntil = Date.now() + COOKIE_REJECTION_COOLDOWN_MS;
        logger.warn('Bilibili rejected configured cookies (HTTP 412); using anonymous session', {
          url: normalizedUrl,
          cooldownMs: COOKIE_REJECTION_COOLDOWN_MS,
        });
      }
    }

    const anonymous = this.options.cookiesFile
      ? (this.anonymousExtractor ??= this.createUpstream(null))
      : this.extractor;
    try {
      return await anonymous.extract(normalizedUrl);
    } catch (error) {
      // A rejected anonymous buvid is cached upstream; drop it so the next
      // attempt bootstraps a new one.
      if (isRiskControlRejection(error)) {
        requestGuard.noteRiskControl('native');
        if (this.options.cookiesFile) this.anonymousExtractor = null;
        else this.extractor = this.createUpstream(null);
      }
      throw error;
    }
  }

  async extract(normalizedUrl: string): Promise<NativeExtractionPayload> {
    return this.audioSources.run({ audio: [] }, async () => {
      const result = await this.extractWithRiskControlFallback(normalizedUrl);
      const selected = this.audioSources.getStore()?.audio.find(source =>
        result.format.formatId !== undefined
          ? String(source.id) === result.format.formatId
          : (source.baseUrl || source.base_url || source.backupUrl?.[0] || source.backup_url?.[0]) === result.audioUrl,
      );
      const backupAudioUrls = [...new Set([
        ...(selected?.backupUrl ?? []),
        ...(selected?.backup_url ?? []),
      ])].filter(url => typeof url === 'string' && /^https?:\/\//i.test(url) && url !== result.audioUrl);

      return {
        metadata: {
          success: true,
          title: result.title,
          description: result.description,
          duration: result.duration,
          uploader: result.uploader,
          // Package reports uploadDate as YYYY-MM-DD; this class's contract is
          // the compact YYYYMMDD form (+ a separately dashed `...Formatted`).
          uploadDate: result.uploadDate ? result.uploadDate.replace(/-/g, '') : null,
          uploadDateFormatted: result.uploadDate ?? undefined,
          viewCount: result.viewCount,
          likeCount: result.likeCount,
          thumbnail: result.thumbnail,
          videoId: result.videoId,
          id: result.videoId,
          // pageUrl is the resolved canonical watch URL — matches the input for
          // BV/AV URLs, and (new) a real bilibili.com link for b23.tv shorts.
          url: result.pageUrl,
          webpage_url: result.pageUrl,
        },
        audioUrl: result.audioUrl,
        backupAudioUrls,
        selectedFormat: {
          formatId: result.format.formatId,
          protocol: result.format.protocol,
          audioCodec: result.format.audioCodec,
          videoCodec: 'none',
        },
        timing: result.timing,
      };
    });
  }
}

/**
 * Since 2026-10-11 Bilibili answers the legacy `/x/web-interface/view` (and
 * the watch page yt-dlp scrapes) with HTTP 412 for the production VPS IP, even
 * anonymously, while `/x/web-interface/wbi/view` — the endpoint the current
 * web player uses, same query and response shape — keeps returning 200.
 * Upstream still calls the legacy path, so route it to the WBI one here.
 */
function toRiskControlTolerantUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname !== 'api.bilibili.com' || parsed.pathname !== '/x/web-interface/view') return url;
  parsed.pathname = '/x/web-interface/wbi/view';
  return parsed.toString();
}

function requestKind(url: string): requestGuard.BilibiliRequestKind {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith('/view')) return 'view';
  if (pathname.endsWith('/playurl')) return 'playurl';
  if (pathname.endsWith('/nav')) return 'nav';
  if (pathname.endsWith('/spi')) return 'spi';
  return 'other';
}

export = NativeBilibiliExtractor;
