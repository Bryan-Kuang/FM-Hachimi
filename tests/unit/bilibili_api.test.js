jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock the extractor to prevent real yt-dlp spawns during fallback
jest.mock("../../src/bilibili/extractor", () => {
  return jest.fn().mockImplementation(() => ({
    searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }),
  }));
});

const BilibiliAPI = require("../../src/bilibili/api");

describe("BilibiliAPI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── parseDuration ───────────────────────────────────────────

  describe("parseDuration", () => {
    test.each([
      ["03:45", 225],
      ["0:30", 30],
      ["10:00", 600],
      ["1:02:03", 3723],
      ["0:00:05", 5],
    ])("'%s' → %i seconds", (input, expected) => {
      expect(BilibiliAPI.parseDuration(input)).toBe(expected);
    });

    test("returns 0 for invalid input", () => {
      expect(BilibiliAPI.parseDuration(null)).toBe(0);
      expect(BilibiliAPI.parseDuration(undefined)).toBe(0);
      expect(BilibiliAPI.parseDuration(123)).toBe(0);
      expect(BilibiliAPI.parseDuration("")).toBe(0);
    });
  });

  // ─── parseVideoInfo ─────────────────────────────────────────

  describe("parseVideoInfo", () => {
    test("strips HTML tags from title", () => {
      const video = {
        bvid: "BV1test",
        title: "<em class='keyword'>Test</em> Video",
        author: "Author",
        duration: "03:00",
        play: 1000,
        like: 50,
      };

      const result = BilibiliAPI.parseVideoInfo(video);

      expect(result.title).toBe("Test Video");
      expect(result.bvid).toBe("BV1test");
      expect(result.author).toBe("Author");
      expect(result.duration).toBe(180);
      expect(result.view).toBe(1000);
      expect(result.like).toBe(50);
      expect(result.url).toBe("https://www.bilibili.com/video/BV1test");
    });

    test("handles missing optional fields", () => {
      const video = {
        bvid: "BV1x",
        title: "Minimal",
        author: "A",
        duration: "1:00",
      };

      const result = BilibiliAPI.parseVideoInfo(video);

      expect(result.description).toBe("");
      expect(result.view).toBe(0);
      expect(result.like).toBe(0);
      expect(result.danmaku).toBe(0);
      expect(result.tag).toBe("");
    });

    test("handles non-number like count", () => {
      const video = {
        bvid: "BV1x",
        title: "Test",
        author: "A",
        duration: "1:00",
        like: "--",
      };

      const result = BilibiliAPI.parseVideoInfo(video);
      expect(result.like).toBe(0);
    });
  });

  // ─── parseSearchResults ─────────────────────────────────────

  describe("parseSearchResults", () => {
    test("parses normal result array", () => {
      const data = {
        result: [
          { bvid: "BV1", title: "Video 1", author: "A", duration: "2:00", play: 100 },
          { bvid: "BV2", title: "Video 2", author: "B", duration: "3:00", play: 200 },
        ],
        numResults: 2,
        page: 1,
        pagesize: 20,
      };

      const result = BilibiliAPI.parseSearchResults(data);

      expect(result.videos).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.videos[0].bvid).toBe("BV1");
      expect(result.videos[1].bvid).toBe("BV2");
    });

    test("returns empty array when no result field", () => {
      const result = BilibiliAPI.parseSearchResults({});

      expect(result.videos).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    test("returns empty array when result is not an array", () => {
      const result = BilibiliAPI.parseSearchResults({ result: "not-array" });

      expect(result.videos).toHaveLength(0);
    });
  });

  // ─── filterQualityVideos ────────────────────────────────────

  describe("filterQualityVideos", () => {
    test("passes videos with high view count", () => {
      const videos = [{ bvid: "1", view: 20000, like: 0 }];
      const result = BilibiliAPI.filterQualityVideos(videos);
      expect(result).toHaveLength(1);
    });

    test("passes videos with high like rate", () => {
      const videos = [{ bvid: "1", view: 100, like: 10 }]; // 10%
      const result = BilibiliAPI.filterQualityVideos(videos);
      expect(result).toHaveLength(1);
    });

    test("rejects videos below both thresholds", () => {
      const videos = [{ bvid: "1", view: 100, like: 1 }]; // 1% rate, low views
      const result = BilibiliAPI.filterQualityVideos(videos);
      expect(result).toHaveLength(0);
    });
  });

  // ─── filterByDuration ───────────────────────────────────────

  describe("filterByDuration", () => {
    test("passes video within range", () => {
      const videos = [{ bvid: "1", duration: 180 }]; // 3 min
      expect(BilibiliAPI.filterByDuration(videos)).toHaveLength(1);
    });

    test("passes video at exact max boundary (360s)", () => {
      const videos = [{ bvid: "1", duration: 360 }];
      expect(BilibiliAPI.filterByDuration(videos)).toHaveLength(1);
    });

    test("rejects video over max (361s)", () => {
      const videos = [{ bvid: "1", duration: 361 }];
      expect(BilibiliAPI.filterByDuration(videos)).toHaveLength(0);
    });

    test("passes video at exact min boundary (60s)", () => {
      const videos = [{ bvid: "1", duration: 60 }];
      expect(BilibiliAPI.filterByDuration(videos)).toHaveLength(1);
    });

    test("rejects video under min (59s)", () => {
      const videos = [{ bvid: "1", duration: 59 }];
      expect(BilibiliAPI.filterByDuration(videos)).toHaveLength(0);
    });

    test("passes video with unknown duration (0) — benefit of the doubt", () => {
      const videos = [{ bvid: "1", duration: 0 }];
      expect(BilibiliAPI.filterByDuration(videos)).toHaveLength(1);
    });

    test("passes video with missing duration field", () => {
      const videos = [{ bvid: "1" }];
      expect(BilibiliAPI.filterByDuration(videos)).toHaveLength(1);
    });

    test("filters mix correctly", () => {
      const videos = [
        { bvid: "short", duration: 30 },   // too short
        { bvid: "ok",    duration: 200 },   // fine
        { bvid: "long",  duration: 1000 },  // too long
        { bvid: "unkn",  duration: 0 },     // unknown → pass
      ];
      const result = BilibiliAPI.filterByDuration(videos);
      expect(result.map(v => v.bvid)).toEqual(["ok", "unkn"]);
    });
  });

  // ─── filterCompilations ─────────────────────────────────────

  describe("filterCompilations", () => {
    test.each([
      ["哈基米歌曲合集 第1-100期", true],
      ["哈基米总集编", true],
      ["哈基米全集合辑", true],
      ["2024鬼畜盘点", true],
      ["哈基米TOP10名曲", true],
      ["哈基米音乐排行榜", true],
      ["第01-24话 哈基米", true],
      // Chinese-numeral ranking patterns (e.g. "十大神曲" = top-10 songs)
      ["哈基米十大神曲，全都听过的，网瘾很大了", true],
      ["鬼畜五大神曲盘点", true],
      ["哈基米百大名曲", true],
      // Arabic-numeral ranking (e.g. "10大")
      ["哈基米10大必听歌曲", true],
      // 大全 (comprehensive collection)
      ["哈基米音乐大全", true],
      // 合辑 (compilation album)
      ["哈基米合辑精选", true],
      // 几百/几千首 — "hundreds/thousands of songs" meta-videos
      ["顶流版哈基米金曲，三个字怎么能创作出几千首歌", true],
      ["哈基米几百首神曲精选", true],
      // 100+ explicit track count
      ["哈基米100首精选", true],
    ])("rejects compilation title: %s", (title, shouldReject) => {
      const videos = [{ bvid: "1", title }];
      const result = BilibiliAPI.filterCompilations(videos);
      expect(result).toHaveLength(shouldReject ? 0 : 1);
    });

    test.each([
      ["哈基米 remix（original）"],
      ["【哈基米】神曲翻唱"],
      ["你真的了解哈基米吗"],
      ["第24话 哈基米"],  // single episode, not a range
      ["哈基米大冒险"],   // 大 as part of a non-ranking word
    ])("passes non-compilation title: %s", (title) => {
      const videos = [{ bvid: "1", title }];
      expect(BilibiliAPI.filterCompilations(videos)).toHaveLength(1);
    });

    test("handles empty title", () => {
      const videos = [{ bvid: "1", title: "" }];
      expect(BilibiliAPI.filterCompilations(videos)).toHaveLength(1);
    });
  });

  // ─── filterHachimiRelevance ──────────────────────────────────

  describe("filterHachimiRelevance", () => {
    test("passes video with 哈基米 in title", () => {
      const videos = [{ bvid: "1", title: "哈基米神曲", tag: "" }];
      expect(BilibiliAPI.filterHachimiRelevance(videos)).toHaveLength(1);
    });

    test("passes video with 哈基米 in tag", () => {
      const videos = [{ bvid: "1", title: "随便一首歌", tag: "哈基米 鬼畜 音乐" }];
      expect(BilibiliAPI.filterHachimiRelevance(videos)).toHaveLength(1);
    });

    test("passes video with 哈基米 in both title and tag", () => {
      const videos = [{ bvid: "1", title: "哈基米最强神曲", tag: "哈基米 remix" }];
      expect(BilibiliAPI.filterHachimiRelevance(videos)).toHaveLength(1);
    });

    test("passes video with 大狗叫 in title", () => {
      const videos = [{ bvid: "1", title: "大狗叫神曲 remix", tag: "" }];
      expect(BilibiliAPI.filterHachimiRelevance(videos)).toHaveLength(1);
    });

    test("passes video with 叮咚鸡 in tag", () => {
      const videos = [{ bvid: "1", title: "随便一首歌", tag: "叮咚鸡 音乐" }];
      expect(BilibiliAPI.filterHachimiRelevance(videos)).toHaveLength(1);
    });

    test("rejects video with none of the tracked meme terms in title or tag", () => {
      const videos = [{ bvid: "1", title: "随机鬼畜视频", tag: "鬼畜 音乐" }];
      expect(BilibiliAPI.filterHachimiRelevance(videos)).toHaveLength(0);
    });

    test("rejects video with empty title and tag", () => {
      const videos = [{ bvid: "1", title: "", tag: "" }];
      expect(BilibiliAPI.filterHachimiRelevance(videos)).toHaveLength(0);
    });

    test("rejects video with missing title/tag fields", () => {
      const videos = [{ bvid: "1" }];
      expect(BilibiliAPI.filterHachimiRelevance(videos)).toHaveLength(0);
    });

    test("filters mix correctly", () => {
      const videos = [
        { bvid: "a", title: "哈基米歌曲",   tag: "" },          // pass (title)
        { bvid: "b", title: "不相关视频",     tag: "搞笑" },     // reject
        { bvid: "c", title: "鬼畜视频",       tag: "哈基米 remix" }, // pass (tag)
      ];
      const result = BilibiliAPI.filterHachimiRelevance(videos);
      expect(result.map(v => v.bvid)).toEqual(["a", "c"]);
    });
  });

  // ─── _fallbackSearch ────────────────────────────────────────

  describe("_fallbackSearch", () => {
    test("fallback results include tid=0 field", async () => {
      const Extractor = require("../../src/bilibili/extractor");
      Extractor.mockImplementationOnce(() => ({
        searchVideos: jest.fn().mockResolvedValue({
          success: true,
          results: [
            {
              id: "BVfallback1",
              title: "Fallback Video",
              uploader: "Author",
              viewCount: 5000,
              duration: 180,
              url: "https://bilibili.com/video/BVfallback1",
            },
          ],
        }),
      }));

      const results = await BilibiliAPI._fallbackSearch("test", 5);

      expect(results).toHaveLength(1);
      expect(results[0].tid).toBe(0);
    });

    test("fallback results preserve url and basic fields", async () => {
      const Extractor = require("../../src/bilibili/extractor");
      Extractor.mockImplementationOnce(() => ({
        searchVideos: jest.fn().mockResolvedValue({
          success: true,
          results: [
            {
              id: "BVfallback2",
              title: "Another Fallback",
              uploader: "Author2",
              viewCount: 12000,
              duration: 240,
              url: "https://bilibili.com/video/BVfallback2",
            },
          ],
        }),
      }));

      const results = await BilibiliAPI._fallbackSearch("test", 5);

      expect(results[0].url).toBe("https://bilibili.com/video/BVfallback2");
      expect(results[0].view).toBe(12000);
      expect(results[0].tid).toBe(0);
    });

    test("returns empty array when extractor fails", async () => {
      const Extractor = require("../../src/bilibili/extractor");
      Extractor.mockImplementationOnce(() => ({
        searchVideos: jest.fn().mockRejectedValue(new Error("yt-dlp not found")),
      }));

      const results = await BilibiliAPI._fallbackSearch("test", 5);

      expect(results).toEqual([]);
    });
  });

  // ─── searchVideos (with axios mock) ─────────────────────────

  describe("searchVideos", () => {
    const axios = require("axios");

    test("returns parsed videos on success", async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            result: [
              { bvid: "BV1abc", title: "Found Video", author: "A", duration: "1:30", play: 500 },
            ],
            numResults: 1,
            page: 1,
            pagesize: 20,
          },
        },
      });

      const results = await BilibiliAPI.searchVideos("test");

      expect(results).toHaveLength(1);
      expect(results[0].bvid).toBe("BV1abc");
    });

    test("falls back to extractor on API error code", async () => {
      axios.get.mockResolvedValueOnce({
        data: { code: -412, message: "请求被拦截" },
      });

      // Fallback will fail too since extractor is not mocked — should return empty
      const results = await BilibiliAPI.searchVideos("test");

      expect(Array.isArray(results)).toBe(true);
    });

    test("falls back to extractor on network error", async () => {
      axios.get.mockRejectedValueOnce(new Error("Network Error"));

      const results = await BilibiliAPI.searchVideos("test");

      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ─── getFavFolderPage (Task 2.4) ─────────────────────────────

  describe("getFavFolderPage", () => {
    const axios = require("axios");

    test("fetches the correct URL/params and shapes the response", async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            info: { id: 123, title: "My Favorites", media_count: 2 },
            medias: [
              { bvid: "BV1abc", type: 2, attr: 0, title: "Song A", duration: 180, upper: { name: "Author A" }, cover: "cover-a" },
            ],
            has_more: true,
          },
        },
      });

      const result = await BilibiliAPI.getFavFolderPage("123456", 1, 20);

      expect(axios.get).toHaveBeenCalledWith(
        "https://api.bilibili.com/x/v3/fav/resource/list",
        expect.objectContaining({
          params: { media_id: "123456", pn: 1, ps: 20, platform: "web" },
        }),
      );
      expect(result).toEqual({
        title: "My Favorites",
        mediaCount: 2,
        hasMore: true,
        items: [{ bvid: "BV1abc", title: "Song A", durationSec: 180, author: "Author A", cover: "cover-a" }],
      });
    });

    test("handles medias: null (empty page)", async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          code: 0,
          data: { info: { title: "Empty", media_count: 0 }, medias: null, has_more: false },
        },
      });

      const result = await BilibiliAPI.getFavFolderPage("1", 2, 20);

      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    test("filters out non-video types and invalidated (attr!==0) entries", async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            info: { title: "Mixed", media_count: 3 },
            medias: [
              { bvid: "BV1valid", type: 2, attr: 0, title: "Valid", duration: 100 },
              { bvid: "BV1invalid", type: 2, attr: 1, title: "Invalidated", duration: 100 },
              { bvid: "", type: 2, attr: 0, title: "No bvid", duration: 100 },
              { bvid: "BV1notvideo", type: 24, attr: 0, title: "Not a video (e.g. article)", duration: 100 },
            ],
            has_more: false,
          },
        },
      });

      const result = await BilibiliAPI.getFavFolderPage("1", 1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].bvid).toBe("BV1valid");
    });

    test("throws BILIBILI_FAV_PRIVATE on code -403", async () => {
      axios.get.mockResolvedValueOnce({ data: { code: -403, message: "访问权限不足" } });

      await expect(BilibiliAPI.getFavFolderPage("1", 1, 20)).rejects.toThrow("BILIBILI_FAV_PRIVATE");
    });

    test("throws BILIBILI_FAV_PRIVATE on code 11010", async () => {
      axios.get.mockResolvedValueOnce({ data: { code: 11010, message: "收藏夹不存在" } });

      await expect(BilibiliAPI.getFavFolderPage("1", 1, 20)).rejects.toThrow("BILIBILI_FAV_PRIVATE");
    });

    test("throws a generic error on other non-zero codes", async () => {
      axios.get.mockResolvedValueOnce({ data: { code: -1, message: "系统错误" } });

      await expect(BilibiliAPI.getFavFolderPage("1", 1, 20)).rejects.toThrow(/Failed to get fav folder/);
    });
  });

  // ─── getCollectionPage (Task 2.4) ────────────────────────────

  describe("getCollectionPage", () => {
    const axios = require("axios");

    test("season: fetches seasons_archives_list with exact params", async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            archives: [{ bvid: "BV1s1", title: "Part 1", duration: 200, pic: "pic1" }],
            meta: { name: "My Collection", total: 5 },
            page: { page_num: 1, page_size: 30, total: 5 },
          },
        },
      });

      const result = await BilibiliAPI.getCollectionPage("999", "555", 1, "season", 30);

      expect(axios.get).toHaveBeenCalledWith(
        "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list",
        expect.objectContaining({
          params: { mid: "999", season_id: "555", sort_reverse: false, page_num: 1, page_size: 30 },
        }),
      );
      expect(result).toEqual({
        title: "My Collection",
        total: 5,
        items: [{ bvid: "BV1s1", title: "Part 1", durationSec: 200, cover: "pic1" }],
      });
    });

    test("series: fetches series/archives with exact params and falls back to '合集' title", async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            archives: [{ bvid: "BV1ser1", title: "Ep 1", duration: 150, pic: "pic-ep1" }],
            page: { num: 1, size: 30, total: 3 },
          },
        },
      });

      const result = await BilibiliAPI.getCollectionPage("999", "777", 1, "series", 30);

      expect(axios.get).toHaveBeenCalledWith(
        "https://api.bilibili.com/x/series/archives",
        expect.objectContaining({
          params: { mid: "999", series_id: "777", pn: 1, ps: 30 },
        }),
      );
      expect(result.title).toBe("合集");
      expect(result.total).toBe(3);
      expect(result.items).toEqual([{ bvid: "BV1ser1", title: "Ep 1", durationSec: 150, cover: "pic-ep1" }]);
    });

    test("throws on non-zero code", async () => {
      axios.get.mockResolvedValueOnce({ data: { code: -1, message: "error" } });

      await expect(BilibiliAPI.getCollectionPage("1", "2", 1, "season", 30)).rejects.toThrow(/Failed to get season archives/);
    });
  });

  // ─── getVideoPages (Task 2.4) ────────────────────────────────

  describe("getVideoPages", () => {
    const axios = require("axios");

    test("reuses getVideoDetails and maps pages", async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            title: "Multipart Video",
            pages: [
              { page: 1, part: "Part One", duration: 120, cid: 111 },
              { page: 2, part: "Part Two", duration: 90, cid: 222 },
            ],
          },
        },
      });

      const result = await BilibiliAPI.getVideoPages("BV1multi");

      expect(result).toEqual({
        title: "Multipart Video",
        pages: [
          { page: 1, part: "Part One", durationSec: 120, cid: 111 },
          { page: 2, part: "Part Two", durationSec: 90, cid: 222 },
        ],
      });
    });

    test("returns an empty pages array for a single-part video (no pages field)", async () => {
      axios.get.mockResolvedValueOnce({
        data: { code: 0, data: { title: "Single Part Video" } },
      });

      const result = await BilibiliAPI.getVideoPages("BV1single");

      expect(result.pages).toEqual([]);
    });
  });
});
