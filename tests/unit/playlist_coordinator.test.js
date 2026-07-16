/**
 * playlist_coordinator (Task 2.7) — bulk-enqueue playlist playback:
 * buildPendingTrackData shape, radio refusal, voice-join failure, idle vs.
 * active start behavior, progress cadence, tolerating null addTrack results.
 */

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { buildPendingTrackData, playPlaylist } = require("../../src/playback/playlist_coordinator");

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("buildPendingTrackData", () => {
  test("youtube item: exact pending-track shape with streamHeaders", () => {
    const item = {
      url: "https://www.youtube.com/watch?v=abc",
      title: "Song A",
      durationSec: 200,
      platform: "youtube",
      author: "Uploader A",
      thumbnail: "thumb-a",
    };

    const data = buildPendingTrackData(item);

    expect(data).toEqual({
      title: "Song A",
      audioUrl: "",
      duration: 200,
      platform: "youtube",
      normalizedUrl: "https://www.youtube.com/watch?v=abc",
      originalUrl: "https://www.youtube.com/watch?v=abc",
      url: "https://www.youtube.com/watch?v=abc",
      extractedAt: new Date(0).toISOString(),
      streamHeaders: { referer: "https://www.youtube.com/", userAgent: CHROME_UA },
      thumbnail: "thumb-a",
      author: "Uploader A",
    });
    expect(data.bvid).toBeUndefined();
  });

  test("bilibili item: no streamHeaders (default bilibili referer applies downstream)", () => {
    const item = {
      url: "https://www.bilibili.com/video/BV1abc",
      title: "Video A",
      durationSec: 100,
      platform: "bilibili",
    };

    const data = buildPendingTrackData(item);

    expect(data.streamHeaders).toBeUndefined();
    expect(data.platform).toBe("bilibili");
  });

  test("ytsearch1: pseudo-URL is kept out of the url field but present in normalizedUrl/originalUrl", () => {
    const item = {
      url: "ytsearch1:Artist Name Track Title",
      title: "Track Title",
      durationSec: 180,
      platform: "youtube",
    };

    const data = buildPendingTrackData(item);

    expect(data.url).toBeUndefined();
    expect(data.normalizedUrl).toBe("ytsearch1:Artist Name Track Title");
    expect(data.originalUrl).toBe("ytsearch1:Artist Name Track Title");
  });

  test("extractedAt is pinned to the Unix epoch (always-expired pending marker)", () => {
    const data = buildPendingTrackData({
      url: "https://www.bilibili.com/video/BV1", title: "T", durationSec: 0, platform: "bilibili",
    });
    expect(data.extractedAt).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("playPlaylist", () => {
  function makePlaylist(overrides = {}) {
    return {
      kind: "youtube-playlist",
      title: "My Playlist",
      items: [
        { url: "https://www.youtube.com/watch?v=1", title: "T1", durationSec: 100, platform: "youtube" },
        { url: "https://www.youtube.com/watch?v=2", title: "T2", durationSec: 100, platform: "youtube" },
      ],
      totalCount: 2,
      truncated: false,
      ...overrides,
    };
  }

  function makeInteraction(voiceChannel = { id: "vc-1" }) {
    return {
      guild: { id: "guild-1" },
      channelId: "channel-1",
      user: { id: "user-1" },
      member: { voice: { channel: voiceChannel } },
    };
  }

  function makePlayer(overrides = {}) {
    return {
      isPlaying: false,
      isPaused: false,
      voiceConnection: null,
      queue: { items: [] },
      joinVoiceChannel: jest.fn().mockResolvedValue(true),
      ...overrides,
    };
  }

  function makePlayerService({ player, radioEnabled = false, addTrackImpl } = {}) {
    const resolvedPlayer = player || makePlayer();
    return {
      setUIContext: jest.fn(),
      notifyState: jest.fn(),
      getRadioService: jest.fn().mockReturnValue({ isEnabled: jest.fn().mockReturnValue(radioEnabled) }),
      getPlayer: jest.fn().mockReturnValue(resolvedPlayer),
      addTrack: addTrackImpl || jest.fn().mockResolvedValue({ title: "queued" }),
      playTrackAt: jest.fn().mockResolvedValue(true),
      _player: resolvedPlayer,
    };
  }

  test("refuses when radio is active — addTrack never called", async () => {
    const playerService = makePlayerService({ radioEnabled: true });

    const result = await playPlaylist({
      interaction: makeInteraction(),
      playerService,
      playlist: makePlaylist(),
    });

    expect(result).toEqual(expect.objectContaining({ success: false, error: "RADIO_ACTIVE" }));
    expect(playerService.addTrack).not.toHaveBeenCalled();
  });

  test("returns an error when the user is not in a voice channel", async () => {
    const playerService = makePlayerService();

    const result = await playPlaylist({
      interaction: makeInteraction(null),
      playerService,
      playlist: makePlaylist(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Voice channel required");
    expect(playerService.addTrack).not.toHaveBeenCalled();
  });

  test("returns an error for an empty playlist", async () => {
    const playerService = makePlayerService();

    const result = await playPlaylist({
      interaction: makeInteraction(),
      playerService,
      playlist: makePlaylist({ items: [] }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("歌单为空或全部曲目不可用");
  });

  test("joins voice when not already connected to the target channel; failure surfaces as an error", async () => {
    const player = makePlayer({ joinVoiceChannel: jest.fn().mockResolvedValue(false) });
    const playerService = makePlayerService({ player });

    const result = await playPlaylist({
      interaction: makeInteraction(),
      playerService,
      playlist: makePlaylist(),
    });

    expect(player.joinVoiceChannel).toHaveBeenCalledWith({ id: "vc-1" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to join voice channel");
  });

  test("does not rejoin when already connected to the requested channel", async () => {
    const player = makePlayer({ voiceConnection: { joinConfig: { channelId: "vc-1" } } });
    const playerService = makePlayerService({ player });

    await playPlaylist({ interaction: makeInteraction(), playerService, playlist: makePlaylist() });

    expect(player.joinVoiceChannel).not.toHaveBeenCalled();
  });

  test("idle start: uses playTrackAt(startIndex) with the pre-existing queue length", async () => {
    const player = makePlayer({ queue: { items: [{ existing: true }] } }); // startIndex should be 1
    const playerService = makePlayerService({ player });

    const result = await playPlaylist({
      interaction: makeInteraction(),
      playerService,
      playlist: makePlaylist(),
    });

    expect(playerService.playTrackAt).toHaveBeenCalledWith("guild-1", 1);
    expect(playerService.notifyState).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, queued: 2, title: "My Playlist", truncated: false, totalCount: 2 });
  });

  test("active player: calls notifyState instead of playTrackAt", async () => {
    const player = makePlayer({ isPlaying: true });
    const playerService = makePlayerService({ player });

    await playPlaylist({ interaction: makeInteraction(), playerService, playlist: makePlaylist() });

    expect(playerService.playTrackAt).not.toHaveBeenCalled();
    expect(playerService.notifyState).toHaveBeenCalledWith("guild-1");
  });

  test("progress cadence: reports every 10 items and always on the last item", async () => {
    const items = Array.from({ length: 23 }, (_, i) => ({
      url: `https://www.youtube.com/watch?v=${i}`, title: `T${i}`, durationSec: 1, platform: "youtube",
    }));
    const playerService = makePlayerService();
    const onProgress = jest.fn();

    await playPlaylist({
      interaction: makeInteraction(),
      playerService,
      playlist: makePlaylist({ items, totalCount: 23 }),
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith(10, 23);
    expect(onProgress).toHaveBeenCalledWith(20, 23);
    expect(onProgress).toHaveBeenCalledWith(23, 23);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  test("tolerates a null addTrack result (partial failure) and still succeeds with a lower queued count", async () => {
    const addTrack = jest.fn()
      .mockResolvedValueOnce({ title: "ok" })
      .mockResolvedValueOnce(null);
    const playerService = makePlayerService({ addTrackImpl: addTrack });

    const result = await playPlaylist({
      interaction: makeInteraction(),
      playerService,
      playlist: makePlaylist(),
    });

    expect(result).toEqual(expect.objectContaining({ success: true, queued: 1 }));
  });

  test("requestedBy defaults to the interaction user mention", async () => {
    const playerService = makePlayerService();

    await playPlaylist({ interaction: makeInteraction(), playerService, playlist: makePlaylist() });

    expect(playerService.addTrack).toHaveBeenCalledWith("guild-1", expect.any(Object), "<@user-1>");
  });
});
