const { createMockProcess } = require("../utils/mock_spawn");
const { EventEmitter } = require("events");

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

function resolveWithin(promise, timeoutMs = 25) {
  return Promise.race([
    promise.then(() => "done"),
    new Promise(resolve => setTimeout(() => resolve("timeout"), timeoutMs)),
  ]);
}

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

function createDeferredProcess({ stdout = "", stderr = "", exitCode = 0 } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: jest.fn(), destroyed: false };
  proc.killed = false;
  proc.kill = jest.fn(() => { proc.killed = true; });
  const close = () => {
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
    proc.emit("close", exitCode);
  };
  return { proc, close };
}

describe("YouTubeExtractor extraction cache behavior", () => {
  let extractor;

  beforeEach(() => {
    jest.clearAllMocks();
    extractor = new YouTubeExtractor();
    extractor._ytdlpChecked = true;
  });

  afterEach(() => {
    extractor.destroy();
  });

  test("duplicate in-flight extractions share one yt-dlp process", async () => {
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
  });

  test("separate uncached YouTube URLs spawn independent yt-dlp processes without limiter state", async () => {
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
    expect(extractor).not.toHaveProperty("_waitForRateLimit");
    expect(extractor).not.toHaveProperty("_lastExtractionTime");
  });

  test("same-URL foreground extraction joins an in-flight background extraction", async () => {
    const deferredProcess = createDeferredProcess({
      stdout: youtubeJson("dQw4w9WgXcQ", "Prewarmed YouTube"),
      exitCode: 0,
    });
    spawn.mockReturnValue(deferredProcess.proc);

    const background = extractor.extractAudio(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      { priority: "background", source: "search_command" },
    );
    await Promise.resolve();
    const foreground = extractor.extractAudio(
      "https://youtu.be/dQw4w9WgXcQ",
      { priority: "foreground", source: "playback" },
    );

    deferredProcess.close();
    const [first, second] = await Promise.all([background, foreground]);

    expect(first.title).toBe("Prewarmed YouTube");
    expect(second.title).toBe("Prewarmed YouTube");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("YouTube extraction timing", expect.objectContaining({
      joinedInFlight: true,
      source: "playback",
    }));
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
    expect(args[args.indexOf("--js-runtimes") + 1]).toBe("node");
  });

  test("bot-detection errors refresh cookies once and retry extraction", async () => {
    const refreshService = {
      refreshNow: jest.fn().mockResolvedValue({ success: true, refreshed: true }),
    };
    extractor.setCookieRefreshService(refreshService);

    spawn
      .mockImplementationOnce(() => createMockProcess({
        stderr: "Sign in to confirm you're not a bot",
        exitCode: 1,
      }))
      .mockImplementationOnce(() => createMockProcess({
        stdout: youtubeJson("dQw4w9WgXcQ", "Retried YouTube"),
        exitCode: 0,
      }));

    const result = await extractor.extractAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(result.title).toBe("Retried YouTube");
    expect(refreshService.refreshNow).toHaveBeenCalledTimes(1);
    expect(refreshService.refreshNow).toHaveBeenCalledWith(expect.objectContaining({
      reason: "youtube_auth_failure",
      source: "playback",
    }));
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test("failed automatic refresh reports the attempted refresh without looping", async () => {
    const refreshService = {
      refreshNow: jest.fn().mockResolvedValue({ success: false, refreshed: false, error: "session dead" }),
    };
    extractor.setCookieRefreshService(refreshService);

    spawn.mockImplementation(() => createMockProcess({
      stderr: "Sign in to confirm you're not a bot",
      exitCode: 1,
    }));

    await expect(
      extractor.extractAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).rejects.toThrow("automatic cookie refresh failed");
    expect(refreshService.refreshNow).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test("video unavailable errors do not trigger cookie refresh", async () => {
    const refreshService = {
      refreshNow: jest.fn(),
    };
    extractor.setCookieRefreshService(refreshService);

    spawn.mockImplementation(() => createMockProcess({
      stderr: "Video unavailable",
      exitCode: 1,
    }));

    await expect(
      extractor.extractAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).rejects.toThrow("Video is unavailable or private");
    expect(refreshService.refreshNow).not.toHaveBeenCalled();
  });

  test("stream URL refresh uses automatic cookie refresh once on bot-detection", async () => {
    const refreshService = {
      refreshNow: jest.fn().mockResolvedValue({ success: true, refreshed: true }),
    };
    extractor.setCookieRefreshService(refreshService);

    spawn
      .mockImplementationOnce(() => createMockProcess({
        stderr: "Sign in to confirm you're not a bot",
        exitCode: 1,
      }))
      .mockImplementationOnce(() => createMockProcess({
        stdout: "https://youtube.cdn/fresh.m4a\n",
        exitCode: 0,
      }));

    const url = await extractor.getAudioStreamUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(url).toBe("https://youtube.cdn/fresh.m4a");
    expect(refreshService.refreshNow).toHaveBeenCalledTimes(1);
    expect(refreshService.refreshNow).toHaveBeenCalledWith(expect.objectContaining({
      reason: "youtube_auth_failure",
      source: "stream_refresh",
    }));
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test("YouTube search retries once after automatic cookie refresh", async () => {
    const refreshService = {
      refreshNow: jest.fn().mockResolvedValue({ success: true, refreshed: true }),
    };
    extractor.setCookieRefreshService(refreshService);

    spawn
      .mockImplementationOnce(() => createMockProcess({
        stderr: "Sign in to confirm you're not a bot",
        exitCode: 1,
      }))
      .mockImplementationOnce(() => createMockProcess({
        stdout: JSON.stringify({
          id: "dQw4w9WgXcQ",
          title: "Search Retried",
          webpage_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }),
        exitCode: 0,
      }));

    const response = await extractor.searchVideos("hachimi", 1);

    expect(response.success).toBe(true);
    expect(response.results[0].title).toBe("Search Retried");
    expect(refreshService.refreshNow).toHaveBeenCalledTimes(1);
    expect(refreshService.refreshNow).toHaveBeenCalledWith(expect.objectContaining({
      reason: "youtube_auth_failure",
      source: "search",
    }));
  });

  test("preserves selected format metadata and logs uncached extraction timing", async () => {
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
      ytdlpMs: expect.any(Number),
      parseMs: expect.any(Number),
      totalMs: expect.any(Number),
      formatId: "140",
      protocol: "https",
      audioCodec: "mp4a.40.2",
      videoCodec: "none",
    }));
    const timingCall = logger.info.mock.calls.find(([message]) => message === "YouTube extraction timing");
    expect(timingCall[1]).not.toHaveProperty("rateLimitWaitMs");
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
