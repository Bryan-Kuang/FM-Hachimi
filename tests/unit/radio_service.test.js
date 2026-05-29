/**
 * RadioService Unit Tests
 */

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/config/config", () => ({
  radio: { enabled: true, replenishMaxAttempts: 3 },
}));

const config = require("../../src/config/config");
const RadioService = require("../../src/services/radio_service");

const flush = () => new Promise((resolve) => setImmediate(resolve));

function extracted(title) {
  return { title, audioUrl: `https://cdn/${title}.m4a`, duration: 120, url: `https://www.bilibili.com/video/BV${title}` };
}

function makeWorld() {
  const player = {
    voiceConnection: null,
    advanceHook: null,
    radioMode: false,
    setLoopMode: jest.fn(),
    joinVoiceChannel: jest.fn().mockResolvedValue(true),
    queue: {
      items: [],
      reset() {
        this.items = [];
      },
    },
  };

  const extractor = {
    extractAudio: jest.fn(async (url) => extracted(url.split("/").pop())),
  };

  const playerService = {
    getPlayer: jest.fn(() => player),
    getExtractor: jest.fn(() => extractor),
    addTrack: jest.fn(async (_guildId, data) => {
      player.queue.items.push(data);
      return { title: data.title };
    }),
    play: jest.fn(async () => true),
    setUIContext: jest.fn(),
    notifyState: jest.fn(),
  };

  let seq = 0;
  const bilibiliApi = {
    searchHachimiVideos: jest.fn(async () => {
      seq += 1;
      return { results: [{ url: `https://www.bilibili.com/video/BVsong${seq}`, bvid: `BVsong${seq}` }] };
    }),
    recordHachimiHistory: jest.fn(),
  };

  const voiceChannel = { id: "voice-1" };
  const service = new RadioService(playerService, bilibiliApi);
  return { service, player, extractor, playerService, bilibiliApi, voiceChannel };
}

beforeEach(() => {
  jest.clearAllMocks();
  config.radio.enabled = true;
  config.radio.replenishMaxAttempts = 3;
});

describe("start", () => {
  test("joins voice, plays a track, and enables radio mode", async () => {
    const w = makeWorld();
    const result = await w.service.start("g1", w.voiceChannel, "chan-1");

    expect(result.success).toBe(true);
    expect(w.player.joinVoiceChannel).toHaveBeenCalledWith(w.voiceChannel);
    expect(w.playerService.play).toHaveBeenCalledWith("g1");
    expect(w.player.radioMode).toBe(true);
    expect(typeof w.player.advanceHook).toBe("function");
    expect(w.player.setLoopMode).toHaveBeenCalledWith("none");
    expect(w.service.isEnabled("g1")).toBe(true);
  });

  test("the on-deck track stays hidden from the visible queue", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await flush(); // let the background prefetch settle

    // Only the currently-playing track is visible; the buffered one is hidden.
    expect(w.player.queue.items).toHaveLength(1);
    // But a prefetch DID happen (first track + on-deck = 2 extractions).
    expect(w.extractor.extractAudio.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("records the picked video in guild history", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    expect(w.bilibiliApi.recordHachimiHistory).toHaveBeenCalledWith("g1", expect.stringMatching(/^BVsong/));
  });

  test("fails when no candidates can be extracted", async () => {
    const w = makeWorld();
    w.bilibiliApi.searchHachimiVideos.mockResolvedValue({ results: [] });
    const result = await w.service.start("g1", w.voiceChannel, "chan-1");

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(w.service.isEnabled("g1")).toBe(false);
    expect(w.playerService.play).not.toHaveBeenCalled();
  });

  test("retries other candidates when extraction throws", async () => {
    const w = makeWorld();
    w.extractor.extractAudio
      .mockRejectedValueOnce(new Error("extract boom"))
      .mockImplementation(async (url) => extracted(url.split("/").pop()));
    const result = await w.service.start("g1", w.voiceChannel, "chan-1");

    expect(result.success).toBe(true);
    expect(w.bilibiliApi.searchHachimiVideos.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("refuses to start when radio is disabled by config", async () => {
    const w = makeWorld();
    config.radio.enabled = false;
    const result = await w.service.start("g1", w.voiceChannel, "chan-1");

    expect(result.success).toBe(false);
    expect(w.player.joinVoiceChannel).not.toHaveBeenCalled();
  });
});

describe("advance hook", () => {
  test("promotes the next track and keeps the visible queue at one item", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await flush();

    w.playerService.play.mockClear();
    const handled = await w.player.advanceHook();

    expect(handled).toBe(true);
    expect(w.playerService.play).toHaveBeenCalledWith("g1");
    expect(w.player.queue.items).toHaveLength(1);
  });

  test("ends radio when the next track cannot be fetched", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await flush();

    // Exhaust the source so neither on-deck nor a fresh fetch can supply a track.
    w.bilibiliApi.searchHachimiVideos.mockResolvedValue({ results: [] });
    // Drop the buffered on-deck by advancing once to consume it, then break source.
    await w.player.advanceHook();
    await flush();
    w.bilibiliApi.searchHachimiVideos.mockResolvedValue({ results: [] });

    const handled = await w.player.advanceHook();
    expect(handled).toBe(false);
    expect(w.service.isEnabled("g1")).toBe(false);
  });

  test("does nothing when radio is not enabled for the guild", async () => {
    const w = makeWorld();
    const handled = await w.service.handleAdvance("g-unknown");
    expect(handled).toBe(false);
  });
});

describe("stop", () => {
  test("disables radio and detaches the player hook", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    expect(w.service.isEnabled("g1")).toBe(true);

    await w.service.stop("g1");

    expect(w.service.isEnabled("g1")).toBe(false);
    expect(w.player.advanceHook).toBeNull();
    expect(w.player.radioMode).toBe(false);
  });

  test("is a no-op for a guild that never started radio", async () => {
    const w = makeWorld();
    await expect(w.service.stop("g-none")).resolves.toBeUndefined();
  });
});
