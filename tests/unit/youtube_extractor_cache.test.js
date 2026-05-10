const { createMockProcess } = require("../utils/mock_spawn");

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
const YouTubeExtractor = require("../../src/youtube/extractor");

function youtubeJson(id, title = "YouTube Audio") {
  return JSON.stringify({
    id,
    title,
    duration: 120,
    webpage_url: `https://www.youtube.com/watch?v=${id}`,
    requested_downloads: [{
      url: `https://youtube.cdn/${id}.m4a`,
      format_id: "140",
      protocol: "https",
      acodec: "mp4a.40.2",
      vcodec: "none",
    }],
  });
}

describe("YouTubeExtractor extraction cache behavior", () => {
  let extractor;

  beforeEach(() => {
    jest.clearAllMocks();
    extractor = new YouTubeExtractor();
    extractor._ytdlpChecked = true;
    extractor._waitForRateLimit = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    extractor.destroy();
  });

  test("duplicate in-flight extractions share one yt-dlp process and one rate-limit wait", async () => {
    spawn.mockImplementation(() => createMockProcess({
      stdout: youtubeJson("dQw4w9WgXcQ", "Shared YouTube"),
      exitCode: 0,
    }));

    const [first, second] = await Promise.all([
      extractor.extractAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      extractor.extractAudio("https://youtu.be/dQw4w9WgXcQ"),
    ]);

    expect(first.title).toBe("Shared YouTube");
    expect(second.title).toBe("Shared YouTube");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(extractor._waitForRateLimit).toHaveBeenCalledTimes(1);
  });

  test("separate uncached YouTube URLs still pass through the rate limiter", async () => {
    spawn
      .mockImplementationOnce(() => createMockProcess({
        stdout: youtubeJson("dQw4w9WgXcQ", "First YouTube"),
        exitCode: 0,
      }))
      .mockImplementationOnce(() => createMockProcess({
        stdout: youtubeJson("abcdefghijk", "Second YouTube"),
        exitCode: 0,
      }));

    await extractor.extractAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await extractor.extractAudio("https://www.youtube.com/watch?v=abcdefghijk");

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(extractor._waitForRateLimit).toHaveBeenCalledTimes(2);
  });

  test("uses audio-first low-bandwidth fallback format for extraction", async () => {
    spawn.mockImplementation(() => createMockProcess({
      stdout: youtubeJson("dQw4w9WgXcQ", "Format YouTube"),
      exitCode: 0,
    }));

    await extractor.extractAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    const args = spawn.mock.calls[0][1];
    expect(args[args.indexOf("--format") + 1])
      .toBe("bestaudio[vcodec=none][protocol^=http][acodec!=none]/bestaudio[vcodec=none][acodec!=none]/best[height<=360][protocol^=http][acodec!=none]/best[height<=360][protocol=m3u8_native][acodec!=none]/best[height<=360][acodec!=none]/worst[acodec!=none]");
  });

  test("preserves selected format metadata and logs uncached extraction timing", async () => {
    extractor._waitForRateLimit = jest.fn().mockResolvedValue(250);
    spawn.mockImplementation(() => createMockProcess({
      stdout: youtubeJson("dQw4w9WgXcQ", "Timed YouTube"),
      exitCode: 0,
    }));

    const result = await extractor.extractAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(result).toMatchObject({
      formatId: "140",
      protocol: "https",
      audioCodec: "mp4a.40.2",
      videoCodec: "none",
    });
    expect(logger.info).toHaveBeenCalledWith("YouTube extraction timing", expect.objectContaining({
      cacheHit: false,
      rateLimitWaitMs: 250,
      ytdlpMs: expect.any(Number),
      parseMs: expect.any(Number),
      totalMs: expect.any(Number),
      formatId: "140",
      protocol: "https",
      audioCodec: "mp4a.40.2",
      videoCodec: "none",
    }));
  });

  test("logs cache-hit extraction timing without spawning yt-dlp again", async () => {
    spawn.mockImplementation(() => createMockProcess({
      stdout: youtubeJson("dQw4w9WgXcQ", "Cached YouTube"),
      exitCode: 0,
    }));

    await extractor.extractAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    logger.info.mockClear();
    spawn.mockClear();

    await extractor.extractAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(spawn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("YouTube extraction timing", expect.objectContaining({
      cacheHit: true,
      totalMs: expect.any(Number),
      formatId: "140",
      protocol: "https",
    }));
  });
});
