jest.mock("axios");
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const axios = require("axios");
const logger = require("../../src/services/logger_service");
const config = require("../../src/config/config");
const { probeStreamUrl, probeOrWarn } = require("../../src/playback/stream_probe");

const HEADERS = { referer: "https://www.youtube.com/", userAgent: "UA/1.0" };

/** axios responses are streams here; the probe must close them, not read them. */
function mockStatus(status) {
  const destroy = jest.fn();
  axios.get.mockResolvedValue({ status, data: { destroy } });
  return destroy;
}

describe("stream probe", () => {
  let probeEnabled;

  beforeEach(() => {
    jest.clearAllMocks();
    probeEnabled = config.playback.streamProbeEnabled;
    config.playback.streamProbeEnabled = true;
  });

  afterEach(() => {
    config.playback.streamProbeEnabled = probeEnabled;
  });

  test("206 answer to the byte-range request counts as playable", async () => {
    mockStatus(206);
    const result = await probeStreamUrl("https://cdn.example/audio.m4s", HEADERS);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(206);
  });

  test("403 is reported unplayable — the failure this whole module exists for", async () => {
    mockStatus(403);
    const result = await probeStreamUrl("https://rr3.googlevideo.com/videoplayback", HEADERS);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.reason).toBe("HTTP 403");
  });

  test("transport failure is a result, not a throw", async () => {
    axios.get.mockRejectedValue(new Error("ETIMEDOUT"));
    const result = await probeStreamUrl("https://cdn.example/audio.m4s", HEADERS);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ETIMEDOUT");
  });

  test("asks for a single byte and forwards the extractor's stream headers", async () => {
    mockStatus(206);
    await probeStreamUrl("https://cdn.example/audio.m4s", HEADERS);
    expect(axios.get).toHaveBeenCalledWith(
      "https://cdn.example/audio.m4s",
      expect.objectContaining({
        headers: {
          Range: "bytes=0-0",
          Referer: "https://www.youtube.com/",
          "User-Agent": "UA/1.0",
        },
      }),
    );
  });

  test("releases the response stream instead of downloading it", async () => {
    const destroy = mockStatus(200);
    await probeStreamUrl("https://cdn.example/audio.m4s", HEADERS);
    expect(destroy).toHaveBeenCalled();
  });

  test("local media-cache paths pass without a request — no server to ask", async () => {
    const result = await probeStreamUrl("/app/cache/bilibili/BV1xx.m4s", HEADERS);
    expect(result.ok).toBe(true);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("disabling the probe short-circuits to ok", async () => {
    config.playback.streamProbeEnabled = false;
    const result = await probeStreamUrl("https://cdn.example/audio.m4s", HEADERS);
    expect(result.ok).toBe(true);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("probeOrWarn logs a warning with the platform and status on failure", async () => {
    mockStatus(403);
    const ok = await probeOrWarn("https://rr3.googlevideo.com/videoplayback", HEADERS, {
      platform: "youtube",
      sourceUrl: "https://www.youtube.com/watch?v=abc",
    });
    expect(ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "Stream URL probe failed; extracted URL is not playable",
      expect.objectContaining({ platform: "youtube", status: 403 }),
    );
  });

  test("probeOrWarn stays quiet on success", async () => {
    mockStatus(206);
    const ok = await probeOrWarn("https://cdn.example/audio.m4s", HEADERS, { platform: "bilibili" });
    expect(ok).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
