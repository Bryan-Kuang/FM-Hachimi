jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const PreExtractionService = require("../../src/playback/pre_extraction_service");

function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

describe("PreExtractionService", () => {
  test("queues unique Bilibili URLs up to the configured card-set limit", async () => {
    const extractor = {
      extractAudio: jest.fn().mockResolvedValue({ title: "prewarmed" }),
    };
    const service = new PreExtractionService({
      bilibiliExtractor: extractor,
      enabled: true,
      concurrency: 2,
      maxPerCardSet: 3,
    });

    const summary = service.prewarmBilibiliUrls([
      "https://www.bilibili.com/video/BV1one",
      "https://www.bilibili.com/video/BV1one",
      "https://www.bilibili.com/video/BV2two",
      "https://www.bilibili.com/video/BV3three",
      "https://www.bilibili.com/video/BV4four",
    ], { source: "play_search", guildId: "guild-1", keyword: "hachimi" });

    expect(summary).toMatchObject({ queued: 3, skipped: 2 });
    await flushPromises();
    await flushPromises();

    expect(extractor.extractAudio).toHaveBeenCalledTimes(3);
    expect(extractor.extractAudio.mock.calls.map(call => call[0])).toEqual([
      "https://www.bilibili.com/video/BV1one",
      "https://www.bilibili.com/video/BV2two",
      "https://www.bilibili.com/video/BV3three",
    ]);
  });

  test("does not prewarm YouTube or invalid URLs", async () => {
    const extractor = {
      extractAudio: jest.fn().mockResolvedValue({}),
    };
    const service = new PreExtractionService({
      bilibiliExtractor: extractor,
      enabled: true,
      concurrency: 1,
      maxPerCardSet: 5,
    });

    const summary = service.prewarmBilibiliUrls([
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "not a url",
      "https://www.bilibili.com/video/BV1valid",
    ], { source: "search_command" });

    expect(summary).toMatchObject({ queued: 1, skipped: 2 });
    await flushPromises();

    expect(extractor.extractAudio).toHaveBeenCalledTimes(1);
    expect(extractor.extractAudio).toHaveBeenCalledWith("https://www.bilibili.com/video/BV1valid");
  });

  test("logs and swallows background extraction failures", async () => {
    const extractor = {
      extractAudio: jest.fn().mockRejectedValue(new Error("network down")),
    };
    const service = new PreExtractionService({
      bilibiliExtractor: extractor,
      enabled: true,
      concurrency: 1,
      maxPerCardSet: 5,
    });

    expect(() => service.prewarmBilibiliUrls([
      "https://www.bilibili.com/video/BV1fail",
    ], { source: "daily_recommendation", guildId: "guild-1" })).not.toThrow();

    await flushPromises();
    await flushPromises();

    expect(extractor.extractAudio).toHaveBeenCalledTimes(1);
  });

  test("prewarms top three YouTube URLs in any guild", async () => {
    const youtubeExtractor = {
      extractAudio: jest.fn().mockResolvedValue({ title: "prewarmed youtube" }),
    };
    const service = new PreExtractionService({
      bilibiliExtractor: { extractAudio: jest.fn() },
      youtubeExtractor,
      enabled: true,
      youtubeEnabled: true,
      youtubeConcurrency: 1,
      youtubeMaxPerCardSet: 3,
    });

    // A non-test guild: pre-extraction is no longer gated to the test guild.
    const summary = service.prewarmYouTubeUrls([
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/abcdefghijk",
      "https://www.youtube.com/shorts/ABCDEFGHIJK",
      "https://www.youtube.com/watch?v=LMNOPQRSTUV",
      "not a url",
    ], { source: "play_search", guildId: "guild-1", keyword: "hachimi" });

    expect(summary).toMatchObject({ queued: 3, skipped: 2 });
    await flushPromises();
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(youtubeExtractor.extractAudio).toHaveBeenCalledTimes(3);
    expect(youtubeExtractor.extractAudio).toHaveBeenNthCalledWith(
      1,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      expect.objectContaining({ priority: "background", source: "play_search" }),
    );
    expect(youtubeExtractor.extractAudio).toHaveBeenNthCalledWith(
      2,
      "https://www.youtube.com/watch?v=abcdefghijk",
      expect.objectContaining({ priority: "background", source: "play_search" }),
    );
    expect(youtubeExtractor.extractAudio).toHaveBeenNthCalledWith(
      3,
      "https://www.youtube.com/watch?v=ABCDEFGHIJK",
      expect.objectContaining({ priority: "background", source: "play_search" }),
    );
  });

  test("does not prewarm YouTube URLs when youtubeEnabled is false", async () => {
    const youtubeExtractor = {
      extractAudio: jest.fn().mockResolvedValue({}),
    };
    const service = new PreExtractionService({
      bilibiliExtractor: { extractAudio: jest.fn() },
      youtubeExtractor,
      enabled: true,
      youtubeEnabled: false,
      youtubeConcurrency: 1,
      youtubeMaxPerCardSet: 3,
    });

    const summary = service.prewarmYouTubeUrls([
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/abcdefghijk",
    ], { source: "search_command", guildId: "guild-1", keyword: "hachimi" });

    expect(summary).toMatchObject({ queued: 0, skipped: 2 });
    await flushPromises();

    expect(youtubeExtractor.extractAudio).not.toHaveBeenCalled();
  });

  test("platform lanes are independent — no cross-platform dedupe or interference", async () => {
    const bilibiliExtractor = {
      extractAudio: jest.fn().mockResolvedValue({}),
    };
    const youtubeExtractor = {
      extractAudio: jest.fn().mockResolvedValue({}),
    };
    const service = new PreExtractionService({
      bilibiliExtractor,
      youtubeExtractor,
      enabled: true,
      concurrency: 1,
      maxPerCardSet: 3,
      youtubeEnabled: true,
      youtubeConcurrency: 1,
      youtubeMaxPerCardSet: 3,
    });

    const biliSummary = service.prewarmBilibiliUrls(
      ["https://www.bilibili.com/video/BV1one"],
      { source: "play_search", guildId: "guild-1" },
    );
    const ytSummary = service.prewarmYouTubeUrls(
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
      { source: "play_search", guildId: "guild-1" },
    );

    expect(biliSummary).toMatchObject({ queued: 1, skipped: 0 });
    expect(ytSummary).toMatchObject({ queued: 1, skipped: 0 });
    await flushPromises();
    await flushPromises();

    expect(bilibiliExtractor.extractAudio).toHaveBeenCalledTimes(1);
    expect(bilibiliExtractor.extractAudio).toHaveBeenCalledWith("https://www.bilibili.com/video/BV1one");
    expect(youtubeExtractor.extractAudio).toHaveBeenCalledTimes(1);
    expect(youtubeExtractor.extractAudio).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      expect.objectContaining({ priority: "background", source: "play_search" }),
    );
  });
});
