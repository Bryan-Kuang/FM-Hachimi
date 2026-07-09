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
  radio: {
    enabled: true,
    replenishMaxAttempts: 3,
    breakEnabled: true,
    breakIntervalMinutes: 10,
    breakVideoUrl: "https://www.bilibili.com/video/BV1a4sFzwE8E",
  },
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
    // Mirrors AudioPlayer.skip: radio advancement is delegated to the hook.
    skip: jest.fn(async (reason = "user") => {
      if (player.advanceHook) return player.advanceHook(reason);
      return false;
    }),
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

  const youtubeExtractor = {
    extractAudio: jest.fn(async (url) => extracted(`yt-${url.split("=").pop()}`)),
  };

  const playerService = {
    getPlayer: jest.fn(() => player),
    getExtractor: jest.fn(() => extractor),
    getYouTubeExtractor: jest.fn(() => youtubeExtractor),
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
  return { service, player, extractor, youtubeExtractor, playerService, bilibiliApi, voiceChannel };
}

beforeEach(() => {
  jest.clearAllMocks();
  config.radio.enabled = true;
  config.radio.replenishMaxAttempts = 3;
  config.radio.breakEnabled = true;
  config.radio.breakIntervalMinutes = 10;
  config.radio.breakVideoUrl = "https://www.bilibili.com/video/BV1a4sFzwE8E";
});

afterEach(() => {
  if (Date.now.mockRestore) Date.now.mockRestore();
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

  test("does not manually notify state after play emits the radio card update", async () => {
    const w = makeWorld();
    const result = await w.service.start("g1", w.voiceChannel, "chan-1");

    expect(result.success).toBe(true);
    expect(w.playerService.notifyState).not.toHaveBeenCalled();
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

  test("does not manually notify state after advancing because play emits the update", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await flush();
    w.playerService.notifyState.mockClear();

    await w.player.advanceHook();

    expect(w.playerService.notifyState).not.toHaveBeenCalled();
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

describe("break video", () => {
  const INTERVAL_MS = 10 * 60_000;
  const lastTrack = (w) => {
    const calls = w.playerService.addTrack.mock.calls;
    return calls[calls.length - 1][1];
  };
  // Random tracks are titled BVsong<n>; the break video resolves to BV1a4sFzwE8E.
  const isBreakTrack = (track) => track.title === "BV1a4sFzwE8E";

  async function startAt(w, nowMs, guildId = "g1") {
    jest.spyOn(Date, "now").mockReturnValue(nowMs);
    await w.service.start(guildId, w.voiceChannel, "chan-1");
    await flush(); // let the on-deck prefetch settle
  }

  test("isOnBreak is false for a guild that never started radio", () => {
    const w = makeWorld();
    expect(w.service.isOnBreak("g-none")).toBe(false);
  });

  test("plays the break video on a natural end once the interval elapses", async () => {
    const w = makeWorld();
    await startAt(w, 1000);

    Date.now.mockReturnValue(1000 + INTERVAL_MS + 1);
    w.playerService.addTrack.mockClear();
    const handled = await w.player.advanceHook("ended");

    expect(handled).toBe(true);
    expect(w.service.isOnBreak("g1")).toBe(true);
    expect(isBreakTrack(lastTrack(w))).toBe(true);
    expect(w.extractor.extractAudio).toHaveBeenCalledWith(config.radio.breakVideoUrl);
  });

  test("a user skip does not trigger the break, even when due", async () => {
    const w = makeWorld();
    await startAt(w, 1000);

    Date.now.mockReturnValue(1000 + INTERVAL_MS + 1);
    w.playerService.addTrack.mockClear();
    const handled = await w.player.advanceHook("user");

    expect(handled).toBe(true);
    expect(w.service.isOnBreak("g1")).toBe(false);
    expect(lastTrack(w).title).toMatch(/^BVsong/);
    expect(w.extractor.extractAudio).not.toHaveBeenCalledWith(config.radio.breakVideoUrl);
  });

  test("resumes random rotation and re-arms the timer after the break ends", async () => {
    const w = makeWorld();
    await startAt(w, 1000);

    // Trigger the break.
    Date.now.mockReturnValue(1000 + INTERVAL_MS + 1);
    await w.player.advanceHook("ended");
    expect(w.service.isOnBreak("g1")).toBe(true);

    // Break ends naturally -> promote the preserved on-deck random track.
    Date.now.mockReturnValue(1000 + INTERVAL_MS + 2);
    w.playerService.addTrack.mockClear();
    const handled = await w.player.advanceHook("ended");
    await flush();

    expect(handled).toBe(true);
    expect(w.service.isOnBreak("g1")).toBe(false);
    expect(lastTrack(w).title).toMatch(/^BVsong/);

    // Timer is re-armed: another immediate natural end does NOT break again.
    w.playerService.addTrack.mockClear();
    await w.player.advanceHook("ended");
    expect(w.service.isOnBreak("g1")).toBe(false);
    expect(lastTrack(w).title).toMatch(/^BVsong/);
  });

  test("falls back to a random track when the break video fails to extract", async () => {
    const w = makeWorld();
    w.extractor.extractAudio.mockImplementation(async (url) => {
      if (url === config.radio.breakVideoUrl) throw new Error("break boom");
      return extracted(url.split("/").pop());
    });
    await startAt(w, 1000);

    Date.now.mockReturnValue(1000 + INTERVAL_MS + 1);
    w.playerService.addTrack.mockClear();
    const handled = await w.player.advanceHook("ended");

    expect(handled).toBe(true);
    expect(w.service.isOnBreak("g1")).toBe(false);
    expect(lastTrack(w).title).toMatch(/^BVsong/);
  });

  test("never injects the break when breakEnabled is false", async () => {
    const w = makeWorld();
    config.radio.breakEnabled = false;
    await startAt(w, 1000);

    Date.now.mockReturnValue(1000 + INTERVAL_MS + 1);
    w.playerService.addTrack.mockClear();
    const handled = await w.player.advanceHook("ended");

    expect(handled).toBe(true);
    expect(w.service.isOnBreak("g1")).toBe(false);
    expect(lastTrack(w).title).toMatch(/^BVsong/);
    expect(w.extractor.extractAudio).not.toHaveBeenCalledWith(config.radio.breakVideoUrl);
  });

  test("fires in any guild (feature is global, not test-guild gated)", async () => {
    const w = makeWorld();
    await startAt(w, 1000, "g-public");

    Date.now.mockReturnValue(1000 + INTERVAL_MS + 1);
    w.playerService.addTrack.mockClear();
    const handled = await w.player.advanceHook("ended");

    expect(handled).toBe(true);
    expect(w.service.isOnBreak("g-public")).toBe(true);
    expect(isBreakTrack(lastTrack(w))).toBe(true);
  });
});

describe("playNow (daily recommendation interlude)", () => {
  const INTERLUDE_URL = "https://www.bilibili.com/video/BVdaily1";
  const INTERVAL_MS = 10 * 60_000;
  const lastAddCall = (w) => {
    const calls = w.playerService.addTrack.mock.calls;
    return calls[calls.length - 1];
  };

  test("plays the requested video immediately with the requester attribution", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await flush();

    w.playerService.addTrack.mockClear();
    const result = await w.service.playNow("g1", INTERLUDE_URL, "<@user-1>");

    expect(result.success).toBe(true);
    const [, track, requestedBy] = lastAddCall(w);
    expect(track.title).toBe("BVdaily1");
    expect(requestedBy).toBe("<@user-1>");
    expect(w.player.skip).toHaveBeenCalledWith("user");
    expect(w.service.isEnabled("g1")).toBe(true);
    expect(w.player.queue.items).toHaveLength(1);
  });

  test("returns to the random rotation when the interlude ends", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await flush();
    await w.service.playNow("g1", INTERLUDE_URL, "<@user-1>");
    await flush();

    w.playerService.addTrack.mockClear();
    const handled = await w.player.advanceHook("ended");

    expect(handled).toBe(true);
    const [, track, requestedBy] = lastAddCall(w);
    expect(track.title).toMatch(/^BVsong/);
    expect(requestedBy).toBe("📻 Radio");
    expect(w.service.isEnabled("g1")).toBe(true);
  });

  test("a user skip during the interlude also returns to the rotation", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await flush();
    await w.service.playNow("g1", INTERLUDE_URL, "<@user-1>");
    await flush();

    w.playerService.addTrack.mockClear();
    const handled = await w.player.advanceHook("user");

    expect(handled).toBe(true);
    expect(lastAddCall(w)[1].title).toMatch(/^BVsong/);
  });

  test("records the interlude video in guild history", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await w.service.playNow("g1", INTERLUDE_URL, "<@user-1>");

    expect(w.bilibiliApi.recordHachimiHistory).toHaveBeenCalledWith("g1", "BVdaily1");
  });

  test("extracts a YouTube interlude with the YouTube extractor and skips history", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await flush();

    w.playerService.addTrack.mockClear();
    w.bilibiliApi.recordHachimiHistory.mockClear();
    const YT_URL = "https://www.youtube.com/watch?v=abc123";
    const result = await w.service.playNow("g1", YT_URL, "<@user-1>", "youtube");

    expect(result.success).toBe(true);
    expect(w.youtubeExtractor.extractAudio).toHaveBeenCalledWith(YT_URL);
    expect(w.extractor.extractAudio).not.toHaveBeenCalledWith(YT_URL);
    // YouTube videos never join the Hachimi rotation, so they aren't recorded.
    expect(w.bilibiliApi.recordHachimiHistory).not.toHaveBeenCalled();
    expect(result.track.title).toBe("yt-abc123");
    expect(w.player.skip).toHaveBeenCalledWith("user");
  });

  test("returns the extracted track on success", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await flush();

    const result = await w.service.playNow("g1", INTERLUDE_URL, "<@user-1>");
    expect(result.track.title).toBe("BVdaily1");
  });

  test("refuses when radio is not enabled", async () => {
    const w = makeWorld();
    const result = await w.service.playNow("g1", INTERLUDE_URL, "<@user-1>");

    expect(result.success).toBe(false);
    expect(w.player.skip).not.toHaveBeenCalled();
  });

  test("refuses while the non-skippable break video is playing", async () => {
    const w = makeWorld();
    jest.spyOn(Date, "now").mockReturnValue(1000);
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await flush();

    Date.now.mockReturnValue(1000 + INTERVAL_MS + 1);
    await w.player.advanceHook("ended");
    expect(w.service.isOnBreak("g1")).toBe(true);

    const result = await w.service.playNow("g1", INTERLUDE_URL, "<@user-1>");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/休息一下/);
  });

  test("fails cleanly when extraction throws and keeps the rotation running", async () => {
    const w = makeWorld();
    await w.service.start("g1", w.voiceChannel, "chan-1");
    await flush();

    w.extractor.extractAudio.mockImplementation(async (url) => {
      if (url === INTERLUDE_URL) throw new Error("daily boom");
      return extracted(url.split("/").pop());
    });

    const result = await w.service.playNow("g1", INTERLUDE_URL, "<@user-1>");
    expect(result.success).toBe(false);
    expect(w.player.skip).not.toHaveBeenCalled();

    // Rotation is untouched: the next advance still plays a random track.
    w.playerService.addTrack.mockClear();
    const handled = await w.player.advanceHook("ended");
    expect(handled).toBe(true);
    expect(lastAddCall(w)[1].title).toMatch(/^BVsong/);
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
