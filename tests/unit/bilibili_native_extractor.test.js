jest.mock("child_process", () => ({
  spawn: jest.fn(),
}));

jest.mock("axios", () => ({
  get: jest.fn(),
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { createMockProcess } = require("../utils/mock_spawn");
const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const { spawn } = require("child_process");
const logger = require("../../src/services/logger_service");
const BilibiliExtractor = require("../../src/bilibili/extractor");
const NativeBilibiliExtractor = require("../../src/bilibili/native_extractor");

const VIDEO_URL = "https://www.bilibili.com/video/BV1xx411c7BF";

function mockNativeResponses({ audio = undefined, navCode = 0, navMessage = undefined, duration = 123, pages = undefined } = {}) {
  axios.get.mockImplementation((url) => {
    if (url.includes("/x/web-interface/view")) {
      return Promise.resolve({
        data: {
          code: 0,
          data: {
            bvid: "BV1xx411c7BF",
            aid: 170001,
            cid: 990001,
            title: "Native Bilibili Track",
            desc: "native metadata",
            duration,
            ...(pages ? { pages } : {}),
            owner: { name: "Native Uploader" },
            pubdate: 1760000000,
            stat: { view: 1234, like: 56 },
            pic: "https://i0.hdslb.com/thumb.jpg",
          },
        },
      });
    }

    if (url.includes("/x/web-interface/nav")) {
      return Promise.resolve({
        data: {
          code: navCode,
          message: navMessage,
          data: {
            wbi_img: {
              img_url: "https://i0.hdslb.com/bfs/wbi/nativeimg.png",
              sub_url: "https://i0.hdslb.com/bfs/wbi/nativesub.png",
            },
          },
        },
      });
    }

    if (url.includes("/x/player/wbi/playurl")) {
      return Promise.resolve({
        data: {
          code: 0,
          data: {
            dash: {
              audio: audio ?? [
                {
                  id: 30216,
                  baseUrl: "https://upos.example.com/audio-low.m4a",
                  bandwidth: 64000,
                  codecs: "mp4a.40.2",
                },
                {
                  id: 30280,
                  baseUrl: "https://upos.example.com/audio-high.m4a",
                  bandwidth: 128000,
                  codecs: "mp4a.40.2",
                },
              ],
            },
          },
        },
      });
    }

    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

function mockYtDlpFallback() {
  const json = JSON.stringify({
    id: "BV1xx411c7BF",
    title: "Fallback Track",
    duration: 120,
    webpage_url: VIDEO_URL,
    requested_downloads: [{
      url: "https://fallback.example.com/audio.m4a",
      format_id: "30280",
      protocol: "https",
      acodec: "mp4a.40.2",
      vcodec: "none",
    }],
  });
  spawn.mockImplementation(() => createMockProcess({ stdout: json, exitCode: 0 }));
}

describe("Bilibili native extractor", () => {
  let extractor;

  beforeEach(() => {
    jest.clearAllMocks();
    extractor = new BilibiliExtractor();
  });

  afterEach(() => {
    extractor.destroy();
  });

  test("extracts metadata and direct audio with native Bilibili APIs without spawning yt-dlp", async () => {
    mockNativeResponses();

    const result = await extractor.extractAudio(VIDEO_URL);

    expect(result).toMatchObject({
      title: "Native Bilibili Track",
      duration: 123,
      uploader: "Native Uploader",
      audioUrl: "https://upos.example.com/audio-high.m4a",
      platform: "bilibili",
      extractionMethod: "native",
      formatId: "30280",
      protocol: "https",
      audioCodec: "mp4a.40.2",
      videoCodec: "none",
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/x/web-interface/view"),
      expect.objectContaining({ params: expect.objectContaining({ bvid: "BV1xx411c7BF" }) }),
    );
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/x/player/wbi/playurl"),
      expect.objectContaining({ params: expect.objectContaining({ cid: 990001 }) }),
    );
  });

  test("uses the played part's duration for multi-part (分P) videos, not the total", async () => {
    mockNativeResponses({
      duration: 1272, // total of all 分P parts
      pages: [
        { cid: 990001, duration: 149, part: "We Are Charlie Kirk" }, // default cid (played)
        { cid: 990002, duration: 225, part: "Full Song" },
      ],
    });

    const result = await extractor.extractAudio(VIDEO_URL);

    expect(result.duration).toBe(149); // the played part, not 1272
  });

  test("falls back to yt-dlp and emits fallback stage when native extraction finds no audio", async () => {
    mockNativeResponses({ audio: [] });
    mockYtDlpFallback();
    extractor._ytdlpChecked = true;
    const stages = [];

    const result = await extractor.extractAudio(VIDEO_URL, 0, 2, {
      onStage: (stage, details) => stages.push({ stage, details }),
    });

    expect(result).toMatchObject({
      title: "Fallback Track",
      audioUrl: "https://fallback.example.com/audio.m4a",
      extractionMethod: "ytdlp_fallback",
    });
    expect(stages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "fallback_to_ytdlp",
        details: expect.objectContaining({ reason: expect.stringMatching(/audio/i) }),
      }),
    ]));
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test("logs extraction timing without logging the signed media URL", async () => {
    mockNativeResponses();

    await extractor.extractAudio(VIDEO_URL);

    expect(logger.info).toHaveBeenCalledWith(
      "Bilibili extraction timing",
      expect.objectContaining({
        method: "native",
        cacheHit: false,
        metadataApiMs: expect.any(Number),
        playurlApiMs: expect.any(Number),
        totalMs: expect.any(Number),
      }),
    );
    const serializedLogs = JSON.stringify(logger.info.mock.calls);
    expect(serializedLogs).not.toContain("https://upos.example.com/audio-high.m4a");
  });

  test("uses WBI keys from unauthenticated nav responses when keys are present", async () => {
    mockNativeResponses({
      navCode: -101,
      navMessage: "账号未登录",
    });
    const nativeExtractor = new NativeBilibiliExtractor({
      userAgent: "Test UA",
      cookiesFile: null,
    });

    const result = await nativeExtractor.extract(VIDEO_URL);

    expect(result).toMatchObject({
      metadata: expect.objectContaining({
        title: "Native Bilibili Track",
      }),
      audioUrl: "https://upos.example.com/audio-high.m4a",
      selectedFormat: expect.objectContaining({
        formatId: "30280",
        protocol: "https",
        audioCodec: "mp4a.40.2",
      }),
    });
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/x/player/wbi/playurl"),
      expect.objectContaining({
        params: expect.objectContaining({
          w_rid: expect.any(String),
          wts: expect.any(Number),
        }),
      }),
    );
  });

  test("passes configured cookies to native Bilibili API requests without logging cookie values", async () => {
    const cookiesFile = path.join(os.tmpdir(), `bili-native-cookies-${Date.now()}.txt`);
    fs.writeFileSync(
      cookiesFile,
      ".bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tsecret-session\n",
      "utf8",
    );
    mockNativeResponses();

    try {
      const nativeExtractor = new NativeBilibiliExtractor({
        userAgent: "Test UA",
        cookiesFile,
      });

      await nativeExtractor.extract(VIDEO_URL);

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/x/web-interface/view"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie: expect.stringContaining("SESSDATA=secret-session"),
          }),
        }),
      );
      expect(JSON.stringify(logger.info.mock.calls)).not.toContain("secret-session");
    } finally {
      fs.unlinkSync(cookiesFile);
    }
  });
});
