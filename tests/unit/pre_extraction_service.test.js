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
});
