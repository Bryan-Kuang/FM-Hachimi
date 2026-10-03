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

class NativeBilibiliExtractor {
  private extractor: upstream.BilibiliAudioExtractor;
  // Preserve upstream's WBI/buvid caches without sharing one video's manifest
  // with another guild's concurrent extraction.
  private audioSources = new asyncHooks.AsyncLocalStorage<{ audio: DashAudioSource[] }>();

  constructor(options: NativeExtractorOptions) {
    this.extractor = new upstream.BilibiliAudioExtractor({
      userAgent: options.userAgent,
      cookiesFile: options.cookiesFile ?? null,
      fetchJson: async (url, init) => {
        const response = await fetch(url, {
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

  async extract(normalizedUrl: string): Promise<NativeExtractionPayload> {
    return this.audioSources.run({ audio: [] }, async () => {
      const result = await this.extractor.extract(normalizedUrl);
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

export = NativeBilibiliExtractor;
