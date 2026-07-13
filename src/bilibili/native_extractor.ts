/**
 * Thin adapter over the extracted `@bryan-kuang/bilibili-audio-extractor`
 * package (which grew out of this file). Preserves the payload shape
 * BilibiliExtractor and its tests expect; the extraction mechanics — WBI
 * request signing, anonymous buvid bootstrap (avoids Bilibili's risk-control
 * HTTP 412 on a made-up cookie), DASH stream selection, b23.tv short-link
 * resolution — live upstream.
 */

import { BilibiliAudioExtractor } from '@bryan-kuang/bilibili-audio-extractor';

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
  selectedFormat: SelectedFormatMetadata;
  timing: {
    metadataApiMs: number;
    playurlApiMs: number;
    totalMs: number;
  };
}

class NativeBilibiliExtractor {
  private extractor: BilibiliAudioExtractor;

  constructor(options: NativeExtractorOptions) {
    this.extractor = new BilibiliAudioExtractor({
      userAgent: options.userAgent,
      cookiesFile: options.cookiesFile ?? null,
    });
  }

  async extract(normalizedUrl: string): Promise<NativeExtractionPayload> {
    const result = await this.extractor.extract(normalizedUrl);

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
      selectedFormat: {
        formatId: result.format.formatId,
        protocol: result.format.protocol,
        audioCodec: result.format.audioCodec,
        videoCodec: 'none',
      },
      timing: result.timing,
    };
  }
}

export = NativeBilibiliExtractor;
