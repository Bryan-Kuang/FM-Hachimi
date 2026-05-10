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
const YouTubeExtractor = require("../../src/youtube/extractor");

function youtubeJson(id, title = "YouTube Audio") {
  return JSON.stringify({
    id,
    title,
    duration: 120,
    webpage_url: `https://www.youtube.com/watch?v=${id}`,
    requested_downloads: [{ url: `https://youtube.cdn/${id}.m4a` }],
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
      .toBe("bestaudio[acodec!=none]/best[height<=360][acodec!=none]/worst[acodec!=none]/best");
  });
});
