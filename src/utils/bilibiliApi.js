/**
 * Bilibili API utilities for searching and fetching video information
 */

const axios = require("axios");
const logger = require("../services/logger_service");

class BilibiliAPI {
  constructor() {
    this.baseURL = "https://api.bilibili.com";
    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://www.bilibili.com/",
    };
  }

  /**
   * Search for videos on Bilibili
   * @param {string} keyword - Search keyword
   * @param {number} page - Page number (default: 1)
   * @param {number} pageSize - Number of results per page (default: 20)
   * @returns {Promise<Array>} Array of video objects
   */
  async searchVideos(keyword, page = 1, pageSize = 20) {
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
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Referer: "https://www.bilibili.com/",
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            Connection: "keep-alive",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
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
        error: error.message,
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
  parseSearchResults(data) {
    const videos = [];

    // Extract video results from the response
    // For endpoint: /x/web-interface/search/type?search_type=video
    // The response structure is: data.result: Array<Video>
    if (Array.isArray(data.result)) {
      for (const video of data.result) {
        videos.push(this.parseVideoInfo(video));
      }
    }

    return {
      videos,
      total: data.numResults || 0,
      page: data.page || 1,
      pageSize: data.pagesize || 20,
    };
  }

  /**
   * Parse individual video information
   * @param {Object} video - Raw video data
   * @returns {Object} Parsed video info
   */
  parseVideoInfo(video) {
    return {
      bvid: video.bvid,
      aid: video.aid,
      title: video.title.replace(/<[^>]*>/g, ""), // Remove HTML tags
      author: video.author,
      mid: video.mid,
      description: video.description || "",
      pic: video.pic,
      duration: this.parseDuration(video.duration),
      pubdate: video.pubdate,
      // Note: search API often doesn't include like count; default to 0
      view: video.play || 0,
      like: typeof video.like === "number" ? video.like : 0,
      danmaku: video.danmaku || 0,
      tag: video.tag || "",
      url: `https://www.bilibili.com/video/${video.bvid}`,
    };
  }

  /**
   * Parse duration string to seconds
   * @param {string} duration - Duration string (e.g., "03:45")
   * @returns {number} Duration in seconds
   */
  parseDuration(duration) {
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
  async _fallbackSearch(keyword, maxResults = 10) {
    try {
      const Extractor = require("../audio/extractor");
      const extractor = new Extractor();
      const res = await extractor.searchVideos(keyword, maxResults);
      if (!res || res.success !== true || !Array.isArray(res.results))
        return [];

      // 将 extractor 的结果映射为 BilibiliAPI 的视频结构
      return res.results.map((item) => ({
        bvid: item.id || undefined,
        aid: undefined,
        title: item.title || "",
        author: item.uploader || "",
        mid: undefined,
        description: "",
        pic: item.thumbnail || "",
        duration: typeof item.duration === "number" ? item.duration : 0,
        pubdate: undefined,
        view:
          (typeof item.viewCount === "number"
            ? item.viewCount
            : parseInt(item.viewCount || 0, 10)) || 0,
        like: 0,
        danmaku: 0,
        tag: "",
        url: item.url,
      }));
    } catch (err) {
      logger.warn("Fallback search via extractor failed", {
        error: err.message,
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
  filterQualityVideos(videos) {
    if (!Array.isArray(videos)) return [];
    const qualified = [];
    for (const v of videos) {
      const views = Number(v.view || 0);
      const likes = Number(v.like || 0);
      const likeRate = views > 0 ? likes / views : 0;

      // New Criteria: Like Rate > 5% OR Views > 10,000
      const pass = likeRate > 0.05 || views > 10000;

      if (pass) {
        v.likeRate = likeRate;
        v.qualificationReason =
          views > 10000 ? "Views > 10,000" : "Like rate > 5%";
        qualified.push(v);
      }
    }
    return qualified;
  }

  /**
   * Search for Hachimi videos with quality filtering (Redesigned)
   * @param {number} maxResults - Maximum number of results to return (default: 5)
   * @returns {Promise<Array>} Array of qualified video objects
   */
  async fetchRawCandidates(
    keyword,
    { maxPages = 3, pageSize = 50, timeoutMs = 8000 } = {}
  ) {
    try {
      // Always include page 1 for relevance
      const pages = [1];
      // Randomly add 1-2 pages from [2,10]
      const extraCount = Math.floor(Math.random() * 2) + 1; // 1 or 2
      const candidates = new Set();
      for (let i = 0; i < extraCount; i++) {
        const p = 2 + Math.floor(Math.random() * 9); // 2..10
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
            order: "totalrank",
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

      const all = [];
      for (const r of responses) {
        if (r.status === "fulfilled" && r.value?.data?.code === 0) {
          const parsed = this.parseSearchResults(r.value.data.data);
          all.push(...parsed.videos);
        } else if (r.status === "rejected") {
          logger.warn("Page fetch rejected", { reason: r.reason?.message });
        }
      }

      return all;
    } catch (error) {
      logger.warn("fetchRawCandidates failed, using fallback", {
        error: error.message,
      });
      return await this._fallbackSearch(keyword, 50);
    }
  }

  processCandidates(rawList, guildId, maxResults = 5) {
    const HistoryStore = require("../utils/history_store");
    // Deduplicate by bvid
    const seen = new Set();
    const deduped = [];
    for (const v of Array.isArray(rawList) ? rawList : []) {
      const id = v.bvid || v.aid || v.url;
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      deduped.push(v);
    }

    const qualified = this.filterQualityVideos(deduped);
    const afterHistory = HistoryStore.filter(guildId, qualified);
    const softFallback = afterHistory.length === 0 && qualified.length > 0;
    const pool = softFallback ? qualified : afterHistory;

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
        qualifiedCount: qualified.length,
        excludedByHistory: qualified.length - afterHistory.length,
        softFallbackApplied: softFallback,
        returnedCount: selected.length,
      },
    };
  }

  async searchHachimiVideos(maxResults = 5, guildId = null) {
    try {
      logger.info("Searching for Hachimi videos (Randomized)", {
        maxResults,
        guildId,
      });

      const rawCandidates = await this.fetchRawCandidates("哈基米", {
        maxPages: 3,
        pageSize: 50,
        timeoutMs: 8000,
      });

      if (!rawCandidates || rawCandidates.length === 0) {
        logger.warn("No Hachimi videos found in search results");
        return [];
      }

      const { results, meta } = this.processCandidates(
        rawCandidates,
        guildId,
        maxResults
      );

      logger.info("Hachimi video search completed", meta);

      return results;
    } catch (error) {
      logger.error("Error searching Hachimi videos", {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * Get video details by BVID
   * @param {string} bvid - Bilibili video ID
   * @returns {Promise<Object>} Video details
   */
  async getVideoDetails(bvid) {
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
        error: error.message,
        bvid,
      });
      throw error;
    }
  }
}

module.exports = new BilibiliAPI();
