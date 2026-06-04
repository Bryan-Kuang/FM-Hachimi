const { createMockProcess } = require("../utils/mock_spawn");

// Mock child_process before requiring extractor
jest.mock("child_process", () => ({
  spawn: jest.fn(),
  execFile: jest.fn(),
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { spawn } = require("child_process");
const logger = require("../../src/services/logger_service");
const Extractor = require("../../src/bilibili/extractor");

describe("Extractor", () => {
  let extractor;

  beforeEach(() => {
    extractor = new Extractor();
    jest.clearAllMocks();
  });

  // ─── Layer 1: Pure Functions ──────────────────────────────────

  describe("parseVideoMetadata", () => {
    test("parses complete video data", () => {
      const data = {
        title: "Test Video",
        description: "A test",
        duration: 180,
        uploader: "TestUser",
        upload_date: "20260208",
        view_count: 1000,
        like_count: 50,
        thumbnails: [{ url: "https://img.example.com/1.jpg", width: 320, height: 180 }],
        webpage_url: "https://www.bilibili.com/video/BV1test123",
      };

      const result = extractor.parseVideoMetadata(data);

      expect(result.success).toBe(true);
      expect(result.title).toBe("Test Video");
      expect(result.duration).toBe(180);
      expect(result.uploader).toBe("TestUser");
      expect(result.uploadDateFormatted).toBe("2026-02-08");
      expect(result.viewCount).toBe(1000);
      expect(result.likeCount).toBe(50);
      expect(result.thumbnail).toBe("https://img.example.com/1.jpg");
    });

    test("handles missing fields with defaults", () => {
      const result = extractor.parseVideoMetadata({});

      expect(result.title).toBe("Unknown Title");
      expect(result.description).toBe("");
      expect(result.duration).toBe(0);
      expect(result.uploader).toBe("Unknown");
      expect(result.viewCount).toBe(0);
      expect(result.likeCount).toBe(0);
      expect(result.thumbnail).toBeNull();
    });

    test("uses channel as fallback uploader", () => {
      const result = extractor.parseVideoMetadata({ channel: "ChannelName" });
      expect(result.uploader).toBe("ChannelName");
    });

    test("formats upload_date correctly", () => {
      const result = extractor.parseVideoMetadata({ upload_date: "20251225" });
      expect(result.uploadDateFormatted).toBe("2025-12-25");
    });
  });

  describe("selectBestThumbnail", () => {
    test("selects highest resolution thumbnail", () => {
      const thumbs = [
        { url: "small.jpg", width: 160, height: 90 },
        { url: "large.jpg", width: 1280, height: 720 },
        { url: "medium.jpg", width: 640, height: 360 },
      ];
      expect(extractor.selectBestThumbnail(thumbs)).toBe("large.jpg");
    });

    test("returns null for empty/invalid input", () => {
      expect(extractor.selectBestThumbnail(null)).toBeNull();
      expect(extractor.selectBestThumbnail([])).toBeNull();
      expect(extractor.selectBestThumbnail("not-array")).toBeNull();
    });

    test("falls back to first thumbnail when none have dimensions", () => {
      const thumbs = [{ url: "only.jpg" }];
      expect(extractor.selectBestThumbnail(thumbs)).toBe("only.jpg");
    });
  });

  describe("isRetryableError", () => {
    test.each([
      ["timeout", true],
      ["Network connection failed", true],
      ["ECONNRESET", true],
      ["ENOTFOUND", true],
      ["socket hang up", true],
      ["SSL certificate error", true],
      ["502 Bad Gateway", true],
      ["503 Service Unavailable", true],
      ["Invalid Bilibili URL", false],
      ["No audio stream", false],
      ["Video unavailable", false],
    ])("error '%s' → retryable: %s", (msg, expected) => {
      expect(extractor.isRetryableError(new Error(msg))).toBe(expected);
    });
  });

  // ─── Layer 2: Subprocess Integration ──────────────────────────

  describe("getVideoInfo", () => {
    // Skip yt-dlp availability check
    beforeEach(() => {
      extractor._ytdlpChecked = true;
      extractor.videoInfoCache.clear();
    });

    test("parses normal JSON output", async () => {
      const json = JSON.stringify({
        title: "Normal Video",
        duration: 120,
        uploader: "Author",
        webpage_url: "https://www.bilibili.com/video/BV1abc",
      });
      spawn.mockImplementation(() => createMockProcess({ stdout: json, exitCode: 0 }));

      const result = await extractor.getVideoInfo("https://www.bilibili.com/video/BV1abc");

      expect(result.title).toBe("Normal Video");
      expect(result.duration).toBe(120);
    });

    test("handles multi-line output (JSON + extra lines) — regression for #bug-20260208", async () => {
      const json = JSON.stringify({ title: "Multi Line", duration: 60, webpage_url: "https://www.bilibili.com/video/BV1abc" });
      const stdout = json + "\nsome extra yt-dlp output\nanother line";
      spawn.mockReturnValue(createMockProcess({ stdout, exitCode: 0 }));

      const result = await extractor.getVideoInfo("https://www.bilibili.com/video/BV1abc");

      expect(result.title).toBe("Multi Line");
    });

    test("handles warning lines before JSON", async () => {
      const json = JSON.stringify({ title: "After Warning", duration: 30, webpage_url: "https://www.bilibili.com/video/BV1abc" });
      const stdout = "WARNING: some yt-dlp warning\n" + json;
      spawn.mockReturnValue(createMockProcess({ stdout, exitCode: 0 }));

      const result = await extractor.getVideoInfo("https://www.bilibili.com/video/BV1abc");

      expect(result.title).toBe("After Warning");
    });

    test("rejects when stdout has no JSON", async () => {
      spawn.mockReturnValue(createMockProcess({ stdout: "no json here\njust text", exitCode: 0 }));

      await expect(
        extractor.getVideoInfo("https://www.bilibili.com/video/BV1abc")
      ).rejects.toThrow("No JSON object found");
    });

    test("rejects with specific message for video unavailable", async () => {
      spawn.mockReturnValue(createMockProcess({
        stderr: "ERROR: Video unavailable",
        exitCode: 1,
      }));

      await expect(
        extractor.getVideoInfo("https://www.bilibili.com/video/BV1abc")
      ).rejects.toThrow("Video is unavailable or private");
    });

    test("rejects with network error message", async () => {
      spawn.mockReturnValue(createMockProcess({
        stderr: "ERROR: network connection failed",
        exitCode: 1,
      }));

      await expect(
        extractor.getVideoInfo("https://www.bilibili.com/video/BV1abc")
      ).rejects.toThrow("Network connection error");
    });

    test("rejects when yt-dlp process errors (ENOENT)", async () => {
      spawn.mockReturnValue(createMockProcess({
        error: Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" }),
      }));

      await expect(
        extractor.getVideoInfo("https://www.bilibili.com/video/BV1abc")
      ).rejects.toThrow("not installed");
    });

    test("caches successful results", async () => {
      const json = JSON.stringify({ title: "Cached", duration: 60, webpage_url: "https://www.bilibili.com/video/BV1abc" });
      spawn.mockImplementation(() => createMockProcess({ stdout: json, exitCode: 0 }));

      await extractor.getVideoInfo("https://www.bilibili.com/video/BV1abc");

      expect(extractor.videoInfoCache.size).toBe(1);
    });
  });

  describe("getAudioStreamUrl", () => {
    test("returns trimmed URL", async () => {
      spawn.mockReturnValue(createMockProcess({
        stdout: "  https://cdn.bilibili.com/audio.m4a  \n",
        exitCode: 0,
      }));

      const url = await extractor.getAudioStreamUrl("https://www.bilibili.com/video/BV1abc");

      expect(url).toBe("https://cdn.bilibili.com/audio.m4a");
    });

    test("rejects on empty output", async () => {
      spawn.mockReturnValue(createMockProcess({ stdout: "", exitCode: 0 }));

      await expect(
        extractor.getAudioStreamUrl("https://www.bilibili.com/video/BV1abc")
      ).rejects.toThrow("No audio stream URL found");
    });

    test("rejects with SSL error message", async () => {
      spawn.mockReturnValue(createMockProcess({
        stderr: "ERROR: SSL certificate verify failed",
        exitCode: 1,
      }));

      await expect(
        extractor.getAudioStreamUrl("https://www.bilibili.com/video/BV1abc")
      ).rejects.toThrow("SSL certificate error");
    });
  });

  describe("extractAudio caching", () => {
    const url = "https://www.bilibili.com/video/BV1xx411c7BF";

    beforeEach(() => {
      extractor._ytdlpChecked = true;
      extractor.videoInfoCache.clear();
    });

    function mockExtractionProcess(title = "Cached Audio") {
      const json = JSON.stringify({
        id: "BV1xx411c7BF",
        title,
        duration: 120,
        webpage_url: url,
        requested_downloads: [{
          url: "https://cdn.bilibili.com/audio.m4a",
          format_id: "30280",
          protocol: "https",
          acodec: "mp4a.40.2",
          vcodec: "none",
        }],
      });
      spawn.mockImplementation(() => createMockProcess({ stdout: json, exitCode: 0 }));
    }

    test("full extraction cache skips a second yt-dlp call for the same URL", async () => {
      mockExtractionProcess();

      const first = await extractor.extractAudio(url);
      const second = await extractor.extractAudio(url);

      expect(first.audioUrl).toBe("https://cdn.bilibili.com/audio.m4a");
      expect(second.audioUrl).toBe("https://cdn.bilibili.com/audio.m4a");
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    test("duplicate in-flight extractions share one yt-dlp process", async () => {
      mockExtractionProcess("Shared Audio");

      const [first, second] = await Promise.all([
        extractor.extractAudio(url),
        extractor.extractAudio(url),
      ]);

      expect(first.title).toBe("Shared Audio");
      expect(second.title).toBe("Shared Audio");
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    test("preserves selected format metadata and logs extraction timing", async () => {
      mockExtractionProcess("Timed Bilibili");

      const result = await extractor.extractAudio(url);

      expect(result).toMatchObject({
        formatId: "30280",
        protocol: "https",
        audioCodec: "mp4a.40.2",
        videoCodec: "none",
      });
      expect(logger.info).toHaveBeenCalledWith("Bilibili extraction timing", expect.objectContaining({
        cacheHit: false,
        ytdlpMs: expect.any(Number),
        parseMs: expect.any(Number),
        totalMs: expect.any(Number),
        formatId: "30280",
        protocol: "https",
        audioCodec: "mp4a.40.2",
        videoCodec: "none",
      }));
    });

    test("logs cache-hit extraction timing", async () => {
      mockExtractionProcess("Cached Bilibili");

      await extractor.extractAudio(url);
      logger.info.mockClear();
      spawn.mockClear();

      await extractor.extractAudio(url);

      expect(spawn).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith("Bilibili extraction timing", expect.objectContaining({
        cacheHit: true,
        totalMs: expect.any(Number),
        formatId: "30280",
        protocol: "https",
      }));
    });
  });
});
