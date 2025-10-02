/**
 * Bilibili API utilities for searching and fetching video information
 */

const axios = require("axios");
const logger = require("./logger");

class BilibiliAPI {
  constructor() {
    this.baseURL = "https://api.bilibili.com";
    this.headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://www.bilibili.com/",
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
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.bilibili.com/",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
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
      if (!res || res.success !== true || !Array.isArray(res.results)) return [];

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
        view: (typeof item.viewCount === "number" ? item.viewCount : parseInt(item.viewCount || 0, 10)) || 0,
        like: 0,
        danmaku: 0,
        tag: "",
        url: item.url,
      }));
    } catch (err) {
      logger.warn("Fallback search via extractor failed", { error: err.message, keyword });
      return [];
    }
  }

  /**
   * 质量过滤：点赞率>5%且播放>10k，或播放>200k
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
      const pass = (views >= 10000 && likeRate >= 0.05) || views >= 200000;
      if (pass) {
        v.likeRate = likeRate;
        v.qualificationReason = views >= 200000 ? 
          "Views ≥ 200k" : 
          "Views ≥ 10k & Like rate ≥ 5%";
        qualified.push(v);
      }
    }
    return qualified;
  }

  /**
   * Search for Hachimi videos with quality filtering
   * @param {number} maxResults - Maximum number of results to return (default: 10)
   * @returns {Promise<Array>} Array of qualified video objects
   */
  async searchHachimiVideos(maxResults = 10) {
    try {
      logger.info("Searching for Hachimi videos", { maxResults });

      // Search for videos with "哈基米" keyword
      const searchResults = await this.searchVideos("哈基米", 1, 50); // 返回数组

      // Handle case where search returns empty array
      if (!searchResults || searchResults.length === 0) {
        logger.warn("No Hachimi videos found in search results");
        return [];
      }

      // Filter videos based on quality criteria
      const qualifiedVideos = this.filterQualityVideos(searchResults);

      // Limit to maxResults
      const limitedResults = qualifiedVideos.slice(0, maxResults);

      logger.info("Hachimi video search completed", {
        totalFound: searchResults.length,
        qualified: qualifiedVideos.length,
      });

      return limitedResults;

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
        throw new Error(`Failed to get video details: ${response.data.message}`);
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