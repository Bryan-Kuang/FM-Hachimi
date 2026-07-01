/**
 * PO-token provider wiring: when YTDLP_POT_PROVIDER_URL is set, every
 * yt-dlp invocation must carry the bgutil-http extractor arg so stream
 * URLs come back PO-token'd (YouTube enforces GVS PO tokens per client;
 * the 2026-07-01 tv-client 403 wave is the canary).
 */

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

function youtubeJson(id) {
  return JSON.stringify({
    id,
    title: "t",
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

function freshExtractor() {
  let YouTubeExtractor;
  jest.isolateModules(() => {
    YouTubeExtractor = require("../../src/youtube/extractor");
  });
  return new YouTubeExtractor();
}

describe("PO-token provider extractor args", () => {
  const prevEnv = process.env.YTDLP_POT_PROVIDER_URL;

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.YTDLP_POT_PROVIDER_URL;
    else process.env.YTDLP_POT_PROVIDER_URL = prevEnv;
    jest.clearAllMocks();
  });

  test("passes bgutil base_url extractor-arg when YTDLP_POT_PROVIDER_URL is set", async () => {
    process.env.YTDLP_POT_PROVIDER_URL = "http://pot-provider:4416";
    const extractor = freshExtractor();
    spawn.mockImplementation(() => createMockProcess({
      stdout: youtubeJson("dQw4w9WgXcQ"),
      exitCode: 0,
    }));

    await extractor.extractAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    // A fresh extractor module first spawns a one-time `yt-dlp --version`
    // probe — pick the actual extraction invocation (carries the video URL).
    const call = spawn.mock.calls.find(c => c[1].some(a => String(a).includes("dQw4w9WgXcQ")));
    expect(call).toBeDefined();
    const args = call[1];
    const idx = args.indexOf("--extractor-args");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("youtubepot-bgutilhttp:base_url=http://pot-provider:4416");
  });

  test("omits the arg when YTDLP_POT_PROVIDER_URL is unset", async () => {
    delete process.env.YTDLP_POT_PROVIDER_URL;
    const extractor = freshExtractor();
    spawn.mockImplementation(() => createMockProcess({
      stdout: youtubeJson("dQw4w9WgXcQ"),
      exitCode: 0,
    }));

    await extractor.extractAudio("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    const call = spawn.mock.calls.find(c => c[1].some(a => String(a).includes("dQw4w9WgXcQ")));
    expect(call).toBeDefined();
    expect(call[1].join(" ")).not.toContain("youtubepot-bgutilhttp");
  });
});
