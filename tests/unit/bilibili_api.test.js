jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock the extractor to prevent real yt-dlp spawns during fallback
jest.mock("../../src/audio/extractor", () => {
  return jest.fn().mockImplementation(() => ({
    searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }),
  }));
});

const BilibiliAPI = require("../../src/utils/bilibiliApi");

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
});
