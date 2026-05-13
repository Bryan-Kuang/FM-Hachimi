import axios from 'axios';
import { createHash } from 'crypto';
import * as fs from 'fs';
import config = require('../config/config');
import UrlValidator = require('./validator');

type BilibiliIdentity =
  | { type: 'BV'; bvid: string }
  | { type: 'AV'; aid: string };

interface NativeExtractorOptions {
  userAgent: string;
  cookiesFile?: string | null;
}

interface ViewApiOwner {
  name?: string;
}

interface ViewApiStat {
  view?: number;
  like?: number;
}

interface ViewApiData {
  bvid?: string;
  aid?: number;
  cid?: number;
  title?: string;
  desc?: string;
  duration?: number;
  owner?: ViewApiOwner;
  pubdate?: number;
  stat?: ViewApiStat;
  pic?: string;
}

interface DashAudioItem {
  id?: number | string;
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  bandwidth?: number;
  codecs?: string;
  mimeType?: string;
  mime_type?: string;
}

interface PlayUrlData {
  dash?: {
    audio?: DashAudioItem[];
  };
}

interface NativeAudioSelection {
  url: string;
  formatId?: string;
  protocol?: string;
  audioCodec?: string;
  videoCodec: string;
}

interface SelectedNativeAudio {
  formatId?: string;
  protocol?: string;
  audioCodec?: string;
  videoCodec: string;
}

interface NativeExtractionTiming {
  metadataApiMs: number;
  playurlApiMs: number;
  totalMs: number;
}

interface NativeExtractionPayload {
  metadata: {
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
  };
  audioUrl: string;
  selectedFormat: SelectedNativeAudio;
  timing: NativeExtractionTiming;
}

interface WbiKeys {
  imgKey: string;
  subKey: string;
  expiresAt: number;
}

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32,
  15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19,
  29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 34, 44, 52,
];

class NativeBilibiliExtractor {
  private userAgent: string;
  private cookiesFile: string | null;
  private baseURL: string;
  private wbiKeys: WbiKeys | null;

  constructor(options: NativeExtractorOptions) {
    this.userAgent = options.userAgent;
    this.cookiesFile = options.cookiesFile ?? null;
    this.baseURL = 'https://api.bilibili.com';
    this.wbiKeys = null;
  }

  async extract(normalizedUrl: string): Promise<NativeExtractionPayload> {
    const startedAt = Date.now();
    const identity = this.parseIdentity(normalizedUrl);

    const metadataStartedAt = Date.now();
    const view = await this.fetchView(identity);
    const metadataApiMs = Date.now() - metadataStartedAt;

    const playurlStartedAt = Date.now();
    const playUrlData = await this.fetchPlayUrl(identity, view);
    const selectedAudio = this.selectAudio(playUrlData);
    const { url: audioUrl, ...selectedFormat } = selectedAudio;
    const playurlApiMs = Date.now() - playurlStartedAt;

    return {
      metadata: this.toMetadata(view, normalizedUrl),
      audioUrl,
      selectedFormat,
      timing: {
        metadataApiMs,
        playurlApiMs,
        totalMs: Date.now() - startedAt,
      },
    };
  }

  private parseIdentity(url: string): BilibiliIdentity {
    const videoId = UrlValidator.extractVideoId(url);
    if (!videoId) {
      throw new Error('Native extractor could not parse Bilibili video ID');
    }

    if (videoId.type === 'BV') return { type: 'BV', bvid: videoId.id };
    if (videoId.type === 'AV') return { type: 'AV', aid: videoId.id };
    throw new Error('Native extractor does not support unresolved short links');
  }

  private async fetchView(identity: BilibiliIdentity): Promise<ViewApiData> {
    const params = identity.type === 'BV'
      ? { bvid: identity.bvid }
      : { aid: identity.aid };

    const response = await axios.get(`${this.baseURL}/x/web-interface/view`, {
      params,
      headers: this.headers(),
      timeout: config.audio.extractionTimeout,
    });

    const body = response.data as { code?: number; message?: string; data?: ViewApiData };
    if (body.code !== 0 || !body.data) {
      throw new Error(`Bilibili view API failed: ${body.message || body.code || 'unknown error'}`);
    }

    if (!body.data.cid) {
      throw new Error('Bilibili view API did not return cid');
    }

    return body.data;
  }

  private async fetchPlayUrl(identity: BilibiliIdentity, view: ViewApiData): Promise<PlayUrlData> {
    const baseParams: Record<string, string | number> = {
      cid: view.cid!,
      fnval: 16,
      fnver: 0,
      fourk: 0,
      qn: 64,
    };

    if (identity.type === 'BV') {
      baseParams.bvid = identity.bvid;
    } else {
      baseParams.avid = identity.aid;
    }

    const params = await this.signWbiParams(baseParams);
    const response = await axios.get(`${this.baseURL}/x/player/wbi/playurl`, {
      params,
      headers: this.headers(),
      timeout: config.audio.extractionTimeout,
    });

    const body = response.data as { code?: number; message?: string; data?: PlayUrlData };
    if (body.code !== 0 || !body.data) {
      throw new Error(`Bilibili playurl API failed: ${body.message || body.code || 'unknown error'}`);
    }

    return body.data;
  }

  private selectAudio(playUrlData: PlayUrlData): NativeAudioSelection {
    const audioItems = playUrlData.dash?.audio ?? [];
    const candidates = audioItems
      .map((item) => {
        const url = item.baseUrl || item.base_url || item.backupUrl?.[0] || item.backup_url?.[0] || '';
        return {
          item,
          url,
          directScore: /^https?:\/\//i.test(url) && !/\.m3u8(?:\?|$)/i.test(url) ? 1 : 0,
          codecScore: (item.codecs || '').toLowerCase().includes('mp4a') ? 1 : 0,
          bandwidth: item.bandwidth ?? 0,
        };
      })
      .filter((candidate) => candidate.url);

    if (candidates.length === 0) {
      throw new Error('Native Bilibili playurl API returned no audio streams');
    }

    candidates.sort((a, b) =>
      b.directScore - a.directScore ||
      b.codecScore - a.codecScore ||
      b.bandwidth - a.bandwidth
    );

    const selected = candidates[0];
    return {
      url: selected.url,
      formatId: selected.item.id === undefined ? undefined : String(selected.item.id),
      protocol: this.protocolFromUrl(selected.url),
      audioCodec: selected.item.codecs,
      videoCodec: 'none',
    };
  }

  private toMetadata(view: ViewApiData, normalizedUrl: string): NativeExtractionPayload['metadata'] {
    const uploadDate = typeof view.pubdate === 'number'
      ? new Date(view.pubdate * 1000).toISOString().slice(0, 10).replace(/-/g, '')
      : null;
    const identity = this.parseIdentity(normalizedUrl);
    const bvid = view.bvid || (identity.type === 'BV' ? identity.bvid : null);
    const id = bvid || (view.aid ? `av${view.aid}` : null);

    return {
      success: true,
      title: view.title || 'Unknown Title',
      description: view.desc || '',
      duration: view.duration || 0,
      uploader: view.owner?.name || 'Unknown',
      uploadDate,
      uploadDateFormatted: uploadDate ? `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}` : undefined,
      viewCount: view.stat?.view || 0,
      likeCount: view.stat?.like || 0,
      thumbnail: view.pic || null,
      videoId: id,
      id,
      url: normalizedUrl,
      webpage_url: normalizedUrl,
    };
  }

  private async signWbiParams(params: Record<string, string | number>): Promise<Record<string, string | number>> {
    const keys = await this.fetchWbiKeys();
    const mixinKey = this.getMixinKey(keys.imgKey + keys.subKey);
    const signed: Record<string, string | number> = {
      ...params,
      wts: Math.round(Date.now() / 1000),
    };
    const query = this.sortedQuery(signed);
    signed.w_rid = createHash('md5').update(query + mixinKey).digest('hex');
    return signed;
  }

  private async fetchWbiKeys(): Promise<WbiKeys> {
    if (this.wbiKeys && Date.now() < this.wbiKeys.expiresAt) {
      return this.wbiKeys;
    }

    const response = await axios.get(`${this.baseURL}/x/web-interface/nav`, {
      headers: this.headers(),
      timeout: config.audio.extractionTimeout,
    });
    const body = response.data as {
      code?: number;
      message?: string;
      data?: { wbi_img?: { img_url?: string; sub_url?: string } };
    };
    const imgUrl = body.data?.wbi_img?.img_url;
    const subUrl = body.data?.wbi_img?.sub_url;
    const imgKey = this.extractWbiKey(imgUrl);
    const subKey = this.extractWbiKey(subUrl);
    if (!imgKey || !subKey) {
      throw new Error(`Bilibili WBI key fetch failed: ${body.message || body.code || 'missing key'}`);
    }

    this.wbiKeys = {
      imgKey,
      subKey,
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    };
    return this.wbiKeys;
  }

  private getMixinKey(rawKey: string): string {
    return MIXIN_KEY_ENC_TAB.map((index) => rawKey[index]).join('').slice(0, 32);
  }

  private sortedQuery(params: Record<string, string | number>): string {
    return Object.keys(params)
      .sort()
      .map((key) => {
        const value = String(params[key]).replace(/[!'()*]/g, '');
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      })
      .join('&');
  }

  private extractWbiKey(url: string | undefined): string | null {
    if (!url) return null;
    const file = url.split('/').pop();
    return file ? file.split('.')[0] : null;
  }

  private protocolFromUrl(url: string): string | undefined {
    try {
      return new URL(url).protocol.replace(':', '');
    } catch {
      return undefined;
    }
  }

  private headers(): Record<string, string> {
    const cookieHeader = this.readCookieHeader();
    return {
      'User-Agent': this.userAgent,
      Referer: 'https://www.bilibili.com/',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Cookie: cookieHeader || 'buvid3=infoc;',
    };
  }

  private readCookieHeader(): string | null {
    if (!this.cookiesFile || !fs.existsSync(this.cookiesFile)) return null;

    try {
      const raw = fs.readFileSync(this.cookiesFile, 'utf8');
      const cookies: string[] = [];
      const rawCookieLines: string[] = [];

      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const cookieLine = trimmed.startsWith('#HttpOnly_')
          ? trimmed.replace(/^#HttpOnly_/, '')
          : trimmed;
        if (cookieLine.startsWith('#')) continue;

        const fields = cookieLine.split('\t');
        if (fields.length >= 7) {
          const name = fields[5]?.trim();
          const value = fields[6]?.trim();
          if (name && value) cookies.push(`${name}=${value}`);
          continue;
        }

        if (cookieLine.includes('=')) {
          rawCookieLines.push(cookieLine.replace(/;$/, ''));
        }
      }

      if (cookies.length > 0) return cookies.join('; ');
      if (rawCookieLines.length > 0) return rawCookieLines.join('; ');
      return null;
    } catch {
      return null;
    }
  }
}

export = NativeBilibiliExtractor;
