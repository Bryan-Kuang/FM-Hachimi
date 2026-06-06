/**
 * Bilibili API utilities for searching and fetching video information
 */

import axios from 'axios';
import * as logger from '../services/logger_service';
import config = require('../config/config');
import HistoryStoreClass = require('../utils/history_store');

type HistoryStoreInstance = InstanceType<typeof HistoryStoreClass>;

interface VideoInfo {
  bvid: string | undefined;
  aid: number | undefined;
  title: string;
  author: string;
  mid: number | undefined;
  description: string;
  pic: string;
  duration: number;
  pubdate: number | undefined;
  view: number;
  like: number;
  danmaku: number;
  tag: string;
  tid: number;
  url: string;
  likeRate?: number;
  qualificationReason?: string;
}

interface ParsedSearchResults {
  videos: VideoInfo[];
  total: number;
  page: number;
  pageSize: number;
}

interface ProcessCandidatesResult {
  results: VideoInfo[];
  meta: {
    totalRaw: number;
    dedupedCount: number;
    partitionFilteredCount: number;
    relevanceFilteredCount: number;
    durationFilteredCount: number;
    compilationFilteredCount: number;
    qualifiedCount: number;
    excludedByExplicit: number;
    excludedByHistory: number;
    softFallbackApplied: boolean;
    historyBackfillApplied: boolean;
    explicitBackfillApplied: boolean;
    returnedCount: number;
  };
}

interface ProcessCandidatesOptions {
  excludeBvids?: string[];
  fillFromHistory?: boolean;
  fillFromExcluded?: boolean;
}

interface SearchHachimiResult {
  results: VideoInfo[];
  failReason?: string;
  meta?: ProcessCandidatesResult['meta'];
  error?: string;
}

class BilibiliAPI {
  private baseURL: string;
  private headers: Record<string, string>;
  historyStore: HistoryStoreInstance | null;

  constructor() {
    this.baseURL = "https://api.bilibili.com";
    this.historyStore = null;
    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://www.bilibili.com/",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, br", // axios handles decompression, but sending this header mimics browser
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      Cookie: "buvid3=infoc;",
    };
  }

  /**
   * Set the HistoryStore instance (injected from composition root)
   * @param {Object} historyStore - HistoryStore instance
   */
  setHistoryStore(historyStore: HistoryStoreInstance): void {
    this.historyStore = historyStore;
  }

  recordHachimiHistory(guildId: string, bvid: string): void {
    if (!this.historyStore || !guildId || !bvid) return;
    this.historyStore.add(guildId, bvid);
  }

  /**
   * Search for videos on Bilibili
   * @param {string} keyword - Search keyword
   * @param {number} page - Page number (default: 1)
   * @param {number} pageSize - Number of results per page (default: 20)
   * @returns {Promise<Array>} Array of video objects
   */
  async searchVideos(keyword: string, page = 1, pageSize = 20): Promise<VideoInfo[]> {
    try {
      logger.info("Searching Bilibili videos", {
        keyword,
        page,
        pageSize,
      });

      const response = await axios.get(
        "https://api.bilibili.com/x/web-interface/search/type",
        {
          params: {
            search_type: "video",
            keyword: keyword,
            page: page,
            pagesize: pageSize,
            order: "totalrank",
            duration: 0,
            tids: 0,
          },
          headers: {
            ...this.headers,
            Connection: "keep-alive",
          },
          timeout: 10000,
        }
      );

      if (response.data && response.data.code === 0) {
        const parsed = this.parseSearchResults(response.data.data);
        return parsed.videos; // 返回数组，便于调用方直接使用
      } else {
        logger.warn("Bilibili API returned error", {
          code: response.data?.code,
          message: response.data?.message,
        });
        // 回退到 extractor 搜索
        return await this._fallbackSearch(keyword, pageSize);
      }
    } catch (error) {
      logger.error("Error searching Bilibili videos", {
        error: (error as Error).message,
        keyword,
        page,
      });
      // 出错（例如 412）时回退到 extractor 搜索
      return await this._fallbackSearch(keyword, pageSize);
    }
  }

  /**
   * Parse search results and extract video information
   * @param {Object} data - Raw search data from API
   * @returns {Object} Parsed video results
   */
  parseSearchResults(data: Record<string, unknown>): ParsedSearchResults {
    const videos: VideoInfo[] = [];

    // Extract video results from the response
    // For endpoint: /x/web-interface/search/type?search_type=video
    // The response structure is: data.result: Array<Video>
    if (Array.isArray(data.result)) {
      for (const video of data.result) {
        videos.push(this.parseVideoInfo(video as Record<string, unknown>));
      }
    }

    return {
      videos,
      total: (data.numResults as number) || 0,
      page: (data.page as number) || 1,
      pageSize: (data.pagesize as number) || 20,
    };
  }

  /**
   * Parse individual video information
   * @param {Object} video - Raw video data
   * @returns {Object} Parsed video info
   */
  parseVideoInfo(video: Record<string, unknown>): VideoInfo {
    return {
      bvid: video.bvid as string | undefined,
      aid: video.aid as number | undefined,
      title: (video.title as string).replace(/<[^>]*>/g, ""), // Remove HTML tags
      author: video.author as string,
      mid: video.mid as number | undefined,
      description: (video.description as string) || "",
      pic: video.pic as string,
      duration: this.parseDuration(video.duration as string),
      pubdate: video.pubdate as number | undefined,
      // Note: search API often doesn't include like count; default to 0
      view: (video.play as number) || 0,
      like: typeof video.like === "number" ? video.like : 0,
      danmaku: (video.danmaku as number) || 0,
      tag: (video.tag as string) || "",
      tid: Number(video.typeid) || 0,
      url: `https://www.bilibili.com/video/${video.bvid as string}`,
    };
  }

  /**
   * Parse duration string to seconds
   * @param {string} duration - Duration string (e.g., "03:45")
   * @returns {number} Duration in seconds
   */
  parseDuration(duration: string): number {
    if (!duration || typeof duration !== "string") return 0;

    const parts = duration.split(":").map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1]; // MM:SS
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]; // HH:MM:SS
    }
    return 0;
  }

  /**
   * 当官方接口失败时，使用音频 extractor 的搜索作为回退
   * @param {string} keyword
   * @param {number} maxResults
   * @returns {Promise<Array>} 与 parseVideoInfo 结构一致的数组
   */
  async _fallbackSearch(keyword: string, maxResults = 10): Promise<VideoInfo[]> {
    try {
      // Lazy require to avoid circular import at module load time
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Extractor: typeof import('./extractor') = require('./extractor');
      const extractor = new Extractor();
      const res = await extractor.searchVideos(keyword, maxResults);
      if (!res || res.success !== true || !Array.isArray(res.results))
        return [];

      // 将 extractor 的结果映射为 BilibiliAPI 的视频结构
      return (res.results as unknown as Record<string, unknown>[]).map((item: Record<string, unknown>) => ({
        bvid: (item.id as string) || undefined,
        aid: undefined,
        title: (item.title as string) || "",
        author: (item.uploader as string) || "",
        mid: undefined,
        description: "",
        pic: (item.thumbnail as string) || "",
        duration: typeof item.duration === "number" ? item.duration : 0,
        pubdate: undefined,
        view:
          (typeof item.viewCount === "number"
            ? item.viewCount
            : parseInt((item.viewCount as string) || "0", 10)) || 0,
        like: 0,
        danmaku: 0,
        tag: "",
        tid: 0,
        url: item.url as string,
      }));
    } catch (err) {
      logger.warn("Fallback search via extractor failed", {
        error: (err as Error).message,
        keyword,
      });
      return [];
    }
  }

  /**
   * 质量过滤：点赞率>5%或播放>10k
   * @param {Array} videos
   * @returns {Array}
   */
  filterQualityVideos(videos: VideoInfo[]): VideoInfo[] {
    if (!Array.isArray(videos)) return [];
    const qualified: VideoInfo[] = [];
    for (const v of videos) {
      const views = Number(v.view || 0);
      const likes = Number(v.like || 0);
      const likeRate = views > 0 ? likes / views : 0;

      const pass = likeRate > config.bilibili.likeRateThreshold || views > config.bilibili.viewCountThreshold;

      if (pass) {
        v.likeRate = likeRate;
        v.qualificationReason =
          views > config.bilibili.viewCountThreshold
            ? `Views > ${config.bilibili.viewCountThreshold.toLocaleString()}`
            : `Like rate > ${(config.bilibili.likeRateThreshold * 100).toFixed(0)}%`;
        qualified.push(v);
      }
    }
    return qualified;
  }

  /**
   * Filter videos to only those in allowed Bilibili partitions
   * @param {Array} videos - Video objects with tid field
   * @param {number[]} allowedTids - Allowed partition TIDs
   * @returns {Array}
   */
  filterByPartition(videos: VideoInfo[], allowedTids: number[]): VideoInfo[] {
    if (!Array.isArray(videos) || !Array.isArray(allowedTids)) return [];
    const allowed = new Set(allowedTids);
    return videos.filter(v => v.tid === 0 || allowed.has(v.tid));
  }

  /**
   * Filter videos by duration.
   * Rejects anything shorter than hachimiMinDurationSec (clips/previews) or
   * longer than hachimiMaxDurationSec (compilations / long edits).
   * Videos with duration === 0 (API didn't return it or parsing failed) are
   * passed through — we don't penalise valid content for missing metadata.
   * @param {Array} videos
   * @returns {Array}
   */
  filterByDuration(videos: VideoInfo[]): VideoInfo[] {
    if (!Array.isArray(videos)) return [];
    const max = config.bilibili.hachimiMaxDurationSec;
    const min = config.bilibili.hachimiMinDurationSec;
    return videos.filter(v => {
      const d = Number(v.duration || 0);
      if (d === 0) return true; // unknown duration — give benefit of the doubt
      return d >= min && d <= max;
    });
  }

  /**
   * Filter out obvious compilation / summary / off-topic videos by title.
   * Targets patterns that appear in 总集/合集 uploads but almost never in
   * standalone music or 鬼畜 clips.
   * @param {Array} videos
   * @returns {Array}
   */
  filterCompilations(videos: VideoInfo[]): VideoInfo[] {
    if (!Array.isArray(videos)) return [];
    // "合集" / "总集" / "全集" / "合辑" — obvious compilation markers
    // "第X-Y话/集/期" — episode-range notation (e.g. "第01-24话")
    // "盘点" / "精选集" — list/ranking videos
    // "TOP\d+" / "排行榜" / "大全" — chart/ranking videos
    // "[一二三四五六七八九十百千]+大" — Chinese-numeral ranking: 十大, 五大, 百大, etc.
    // "\d+大" — Arabic-numeral ranking: 10大, 5大, etc.
    // "几[百千万][首曲歌]" — "hundreds/thousands of songs": 几百首, 几千首歌, etc.
    // "\d{3,}[首曲]" — explicit large counts: 100首, 500曲, etc.
    const COMPILATION_RE = /合集|总集|全集|合辑|精选集|盘点|大全|TOP\s*\d+|排行榜|第\s*\d+\s*[-~—至]\s*\d+\s*[集话期]|[一二三四五六七八九十百千]+大|\d+大|几[百千万][首曲歌]|\d{3,}[首曲]/;
    return videos.filter(v => !COMPILATION_RE.test(v.title || ""));
  }

  /**
   * Keep only videos that are genuinely about 哈基米.
   * At least one of title or tag must contain the keyword "哈基米".
   * Using the search query "哈基米" already biases results, but random
   * page sampling (pages 2-10) can surface drift content that happens to
   * rank for the term without being hachimi-related. This hard filter
   * prevents those from reaching the queue.
   * @param {Array} videos
   * @returns {Array}
   */
  filterHachimiRelevance(videos: VideoInfo[]): VideoInfo[] {
    if (!Array.isArray(videos)) return [];
    return videos.filter(v => {
      const title = v.title || "";
      const tag = v.tag || "";
      return title.includes("哈基米") || tag.includes("哈基米");
    });
  }

  /**
   * Search for Hachimi videos with quality filtering (Redesigned)
   * @param {number} maxResults - Maximum number of results to return (default: 5)
   * @returns {Promise<Array>} Array of qualified video objects
   */
  async fetchRawCandidates(
    keyword: string,
    { maxPages = 3, pageSize = 50, timeoutMs = 8000 } = {}
  ): Promise<VideoInfo[]> {
    try {
      // Vary the sort order so we don't always draw the same "totalrank" top set.
      // Each order (most-played, newest, most-danmaku, most-favorited, …) surfaces
      // a different slice of the Hachimi corpus — the main lever for variety.
      // page 1 of the chosen order stays the relevance anchor; the hard 哈基米
      // relevance filter downstream guards against drift on deeper/other orders.
      const ORDERS = ['totalrank', 'click', 'pubdate', 'dm', 'stow', 'scores'];
      const order = ORDERS[Math.floor(Math.random() * ORDERS.length)];

      const pages = [1];
      // Randomly add 1-2 pages from a wider range [2,14].
      const extraCount = Math.floor(Math.random() * 2) + 1; // 1 or 2
      const candidates = new Set<number>();
      for (let i = 0; i < extraCount; i++) {
        const p = 2 + Math.floor(Math.random() * 13); // 2..14
        candidates.add(p);
      }
      const extraPages = Array.from(candidates).slice(
        0,
        Math.max(0, maxPages - 1)
      );
      const fetchPages = pages.concat(extraPages);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const requests = fetchPages.map((p) =>
        axios.get("https://api.bilibili.com/x/web-interface/search/type", {
          params: {
            search_type: "video",
            keyword: keyword,
            page: p,
            pagesize: pageSize,
            order,
            duration: 0,
            tids: 0,
          },
          headers: this.headers,
          timeout: timeoutMs,
          signal: controller.signal,
        })
      );

      const responses = await Promise.allSettled(requests);
      clearTimeout(timeout);

      const all: VideoInfo[] = [];
      let apiBlocked = false;
      for (const r of responses) {
        if (r.status === "fulfilled" && r.value?.data?.code === 0) {
          const parsed = this.parseSearchResults(r.value.data.data as Record<string, unknown>);
          all.push(...parsed.videos);
        } else if (r.status === "fulfilled") {
          apiBlocked = true;
          logger.warn("Bilibili API returned non-zero code", {
            code: r.value?.data?.code,
            message: r.value?.data?.message,
          });
        } else {
          const rejected = r as PromiseRejectedResult;
          logger.warn("Page fetch rejected", {
            reason: (rejected.reason as Error)?.message,
            status: ((rejected.reason as Record<string, unknown>)?.response as Record<string, unknown> | undefined)?.status,
          });
        }
      }

      if (all.length === 0) {
        const reason = apiBlocked
          ? "API blocked (cookie/auth issue)"
          : "network error or empty response";
        logger.warn(
          `fetchRawCandidates: no results from API (${reason}), using extractor fallback`
        );
        return await this._fallbackSearch(keyword, 50);
      }

      return all;
    } catch (error) {
      logger.warn("fetchRawCandidates failed, using fallback", {
        error: (error as Error).message,
      });
      return await this._fallbackSearch(keyword, 50);
    }
  }

  private getCandidateKey(video: VideoInfo): string | null {
    if (video.bvid) return video.bvid;
    if (video.aid) return `av${video.aid}`;
    return null;
  }

  private addUniqueCandidates(target: VideoInfo[], source: VideoInfo[], limit: number): void {
    const seen = new Set(target.map((video) => this.getCandidateKey(video) || video.url));
    for (const video of source) {
      if (target.length >= limit) break;
      const key = this.getCandidateKey(video) || video.url;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      target.push(video);
    }
  }

  processCandidates(
    rawList: VideoInfo[],
    guildId: string | null,
    maxResults = 5,
    options: ProcessCandidatesOptions = {},
  ): ProcessCandidatesResult {
    // Deduplicate by bvid
    const seen = new Set<string>();
    const deduped: VideoInfo[] = [];
    for (const v of Array.isArray(rawList) ? rawList : []) {
      const id = v.bvid || v.aid?.toString() || v.url;
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      deduped.push(v);
    }

    // Partition filter: only allow 鬼畜区 and 音乐区
    const partitionFiltered = this.filterByPartition(deduped, config.bilibili.hachimiAllowedTids);
    // Relevance filter: at least one of title / tag must contain "哈基米"
    const relevanceFiltered = this.filterHachimiRelevance(partitionFiltered);
    // Duration filter: ≥ hachimiMinDurationSec and ≤ hachimiMaxDurationSec
    const durationFiltered = this.filterByDuration(relevanceFiltered);
    // Compilation filter: reject obvious 合集/总集/排行 videos by title pattern
    const compilationFiltered = this.filterCompilations(durationFiltered);
    const qualified = this.filterQualityVideos(compilationFiltered);

    const explicitExcludes = new Set((options.excludeBvids || []).filter(Boolean));
    const explicitFresh: VideoInfo[] = [];
    const explicitExcluded: VideoInfo[] = [];
    for (const video of qualified) {
      const key = this.getCandidateKey(video);
      if (key && explicitExcludes.has(key)) {
        explicitExcluded.push(video);
      } else {
        explicitFresh.push(video);
      }
    }

    // historyStore.filter is now generic (T extends { bvid: string }) so no
    // cast is needed — VideoInfo has a `bvid` field.
    const afterHistory: VideoInfo[] = this.historyStore && guildId
      ? this.historyStore.filter(guildId, explicitFresh)
      : explicitFresh;

    const pool = afterHistory.slice();
    const fillFromHistory = options.fillFromHistory !== false;
    const historyBeforeBackfill = pool.length;
    if (fillFromHistory && pool.length < maxResults) {
      this.addUniqueCandidates(pool, explicitFresh, maxResults);
    }
    const historyBackfillApplied = pool.length > historyBeforeBackfill;

    const explicitBeforeBackfill = pool.length;
    if (options.fillFromExcluded && pool.length < maxResults) {
      this.addUniqueCandidates(pool, explicitExcluded, maxResults);
    }
    const explicitBackfillApplied = pool.length > explicitBeforeBackfill;
    const softFallback = historyBackfillApplied && afterHistory.length === 0 && explicitFresh.length > 0;

    // Fisher–Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }

    const selected = pool.slice(0, maxResults);
    return {
      results: selected,
      meta: {
        totalRaw: (rawList || []).length,
        dedupedCount: deduped.length,
        partitionFilteredCount: partitionFiltered.length,
        relevanceFilteredCount: relevanceFiltered.length,
        durationFilteredCount: durationFiltered.length,
        compilationFilteredCount: compilationFiltered.length,
        qualifiedCount: qualified.length,
        excludedByExplicit: explicitExcluded.length,
        excludedByHistory: explicitFresh.length - afterHistory.length,
        softFallbackApplied: softFallback,
        historyBackfillApplied,
        explicitBackfillApplied,
        returnedCount: selected.length,
      },
    };
  }

  async searchHachimiVideos(
    maxResults = 5,
    guildId: string | null = null,
    options: ProcessCandidatesOptions = {},
  ): Promise<SearchHachimiResult> {
    try {
      logger.info("Searching for Hachimi videos (Randomized)", {
        maxResults,
        guildId,
      });

      const rawCandidates = await this.fetchRawCandidates("哈基米", {
        maxPages: config.bilibili.hachimiMaxPages,
        pageSize: config.bilibili.hachimiPageSize,
        timeoutMs: config.bilibili.searchTimeout,
      });

      if (!rawCandidates || rawCandidates.length === 0) {
        logger.warn("No Hachimi videos found even after fallback");
        return { results: [], failReason: "search_failed" };
      }

      const { results, meta } = this.processCandidates(
        rawCandidates,
        guildId,
        maxResults,
        options
      );

      logger.info("Hachimi video search completed", meta);

      if (results.length === 0) {
        return { results: [], failReason: "quality_filter", meta };
      }
      return { results, meta };
    } catch (error) {
      logger.error("Error searching Hachimi videos", {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      return { results: [], failReason: "exception", error: (error as Error).message };
    }
  }

  /**
   * Get video details by BVID
   * @param {string} bvid - Bilibili video ID
   * @returns {Promise<Object>} Video details
   */
  async getVideoDetails(bvid: string): Promise<unknown> {
    try {
      const url = `${this.baseURL}/x/web-interface/view`;
      const params = { bvid };

      const response = await axios.get(url, {
        params,
        headers: this.headers,
        timeout: 10000,
      });

      if (response.data.code !== 0) {
        throw new Error(
          `Failed to get video details: ${response.data.message}`
        );
      }

      return response.data.data;
    } catch (error) {
      logger.error("Error getting video details", {
        error: (error as Error).message,
        bvid,
      });
      throw error;
    }
  }
}

export = new BilibiliAPI();
