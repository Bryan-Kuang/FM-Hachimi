/**
 * /play command — playlist ingestion wiring (Task 2.9): YouTube playlist /
 * Bilibili fav / Bilibili collection / Spotify album&playlist route to the
 * resolver + bulk-enqueue coordinator; Bilibili multipart (分P) detection on
 * plain video URLs; final reply messages incl. truncation and error mapping.
 */

jest.mock("discord.js", () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => {
    const builder = {};
    builder.setName = jest.fn().mockReturnThis();
    builder.setDescription = jest.fn().mockReturnThis();
    builder.addStringOption = jest.fn().mockImplementation((cb) => {
      if (cb) cb({ setName: jest.fn().mockReturnThis(), setDescription: jest.fn().mockReturnThis(), setRequired: jest.fn().mockReturnThis() });
      return builder;
    });
    return builder;
  }),
  MessageFlags: { Ephemeral: 64 },
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/playlists", () => ({
  resolvePlaylist: jest.fn(),
}));

jest.mock("../../src/playback/playlist_coordinator", () => ({
  playPlaylist: jest.fn(),
  buildPendingTrackData: jest.requireActual("../../src/playback/playlist_coordinator").buildPendingTrackData,
}));

jest.mock("../../src/playback/playback_coordinator", () => ({
  playUrl: jest.fn().mockResolvedValue({ success: true, track: { title: "Single Video" } }),
}));

jest.mock("../../src/bilibili/api", () => ({
  getVideoPages: jest.fn(),
}));

const { resolvePlaylist } = require("../../src/playlists");
const { playPlaylist } = require("../../src/playback/playlist_coordinator");
const PlaybackCoordinator = require("../../src/playback/playback_coordinator");
const BilibiliApi = require("../../src/bilibili/api");
const config = require("../../src/config/config");

const playCommand = require("../../src/bot/commands/play");

function buildInteraction(query) {
  const state = { deferred: false };
  const interaction = {
    options: { getString: jest.fn((name) => (name === "query" ? query : null)) },
    user: { id: "user-1", username: "TestUser" },
    member: { voice: { channel: { id: "vc-1" } } },
    guild: { id: "guild-1", members: { me: { voice: { channel: null } } } },
    channelId: "channel-1",
    reply: jest.fn().mockResolvedValue(),
    editReply: jest.fn().mockResolvedValue(),
    deferReply: jest.fn().mockImplementation(() => { state.deferred = true; return Promise.resolve(); }),
  };
  Object.defineProperty(interaction, "deferred", { get: () => state.deferred });
  Object.defineProperty(interaction, "replied", { get: () => false });
  return interaction;
}

function buildPlaybackService({ radioEnabled = false, youtubeExtractor = {} } = {}) {
  return {
    getYouTubeExtractor: jest.fn().mockReturnValue(youtubeExtractor),
    getRadioService: jest.fn().mockReturnValue({ isEnabled: jest.fn().mockReturnValue(radioEnabled) }),
    getExtractor: jest.fn(),
    getPlayer: jest.fn(),
    setUIContext: jest.fn(),
    notifyState: jest.fn(),
    addTrack: jest.fn(),
    playTrackAt: jest.fn(),
    prewarmBilibiliUrls: jest.fn(),
    prewarmYouTubeUrls: jest.fn(),
  };
}

describe("/play playlist ingestion (Task 2.9)", () => {
  let command;
  const originalMultipartTimeout = config.playlists.multipartDetectTimeoutMs;

  beforeEach(() => {
    jest.clearAllMocks();
    config.playlists.multipartDetectTimeoutMs = originalMultipartTimeout;
    command = playCommand(buildPlaybackService(), {});
  });

  test("YouTube playlist URL: resolves via resolvePlaylist and enqueues via playPlaylist", async () => {
    const playbackService = buildPlaybackService();
    command = playCommand(playbackService, {});
    resolvePlaylist.mockResolvedValue({
      kind: "youtube-playlist", title: "My Mix", items: [{}, {}], totalCount: 2, truncated: false,
    });
    playPlaylist.mockResolvedValue({ success: true, queued: 2, title: "My Mix", truncated: false, totalCount: 2 });

    const interaction = buildInteraction("https://www.youtube.com/playlist?list=PLxyz123");
    await command.execute(interaction);

    expect(resolvePlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "youtube-playlist" }),
      expect.objectContaining({ maxItems: config.playlists.maxItems }),
    );
    expect(playPlaylist).toHaveBeenCalledWith(expect.objectContaining({
      interaction, playerService: playbackService,
    }));
    expect(interaction.editReply).toHaveBeenLastCalledWith({ content: ">> 歌单「My Mix」已加入 2 首" });
  });

  test("truncated playlist result appends the truncation note", async () => {
    resolvePlaylist.mockResolvedValue({
      kind: "bilibili-fav", title: "Fav Folder", items: [{}], totalCount: 50, truncated: true,
    });
    playPlaylist.mockResolvedValue({ success: true, queued: 1, title: "Fav Folder", truncated: true, totalCount: 50 });

    const interaction = buildInteraction("https://space.bilibili.com/123/favlist?fid=456");
    await command.execute(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: `>> 歌单「Fav Folder」已加入 1 首（共 50 首，已截断至 ${config.playlists.maxItems}）`,
    });
  });

  test("RADIO_ACTIVE result from playPlaylist shows the radio-conflict message", async () => {
    resolvePlaylist.mockResolvedValue({
      kind: "bilibili-collection", title: "Collection", items: [{}], totalCount: 1, truncated: false,
    });
    playPlaylist.mockResolvedValue({ success: false, error: "RADIO_ACTIVE", queued: 0, title: "Collection", truncated: false, totalCount: 1 });

    const interaction = buildInteraction("https://space.bilibili.com/1/lists/2");
    await command.execute(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: "[!] 电台模式运行中，歌单会被电台覆盖。请先使用 /radio 关闭电台再导入歌单。",
    });
  });

  test("BILIBILI_FAV_PRIVATE thrown during resolve shows the private-folder message", async () => {
    resolvePlaylist.mockRejectedValue(new Error("BILIBILI_FAV_PRIVATE"));

    const interaction = buildInteraction("https://space.bilibili.com/123/favlist?fid=456");
    await command.execute(interaction);

    expect(playPlaylist).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith({ content: "[!] 收藏夹不是公开的或不存在" });
  });

  test("generic resolve failure shows a truncated error message", async () => {
    resolvePlaylist.mockRejectedValue(new Error("network exploded in a very very very very very very very very long way that exceeds one hundred characters for sure"));

    const interaction = buildInteraction("https://www.youtube.com/playlist?list=PLxyz123");
    await command.execute(interaction);

    const content = interaction.editReply.mock.calls.at(-1)[0].content;
    expect(content.startsWith("[!] 歌单解析失败: ")).toBe(true);
    expect(content.length).toBeLessThanOrEqual(120);
  });

  // ─── Multipart (分P) detection on bilibili-video routes ────────────────

  test("multipart detected (pages.length > 1): enqueues via playPlaylist, never calls the single-video path", async () => {
    BilibiliApi.getVideoPages.mockResolvedValue({
      title: "Multipart Video",
      pages: [{ page: 1, part: "A", durationSec: 10, cid: 1 }, { page: 2, part: "B", durationSec: 10, cid: 2 }],
    });
    playPlaylist.mockResolvedValue({ success: true, queued: 2, title: "Multipart Video", truncated: false, totalCount: 2 });

    const interaction = buildInteraction("https://www.bilibili.com/video/BV1abc4567de");
    await command.execute(interaction);

    expect(BilibiliApi.getVideoPages).toHaveBeenCalledWith("BV1abc4567de");
    expect(playPlaylist).toHaveBeenCalledWith(expect.objectContaining({
      playlist: expect.objectContaining({ kind: "bilibili-multipart" }),
    }));
    expect(PlaybackCoordinator.playUrl).not.toHaveBeenCalled();
  });

  test("single-part video (pages.length === 1) falls through to the normal single-video path", async () => {
    BilibiliApi.getVideoPages.mockResolvedValue({
      title: "Single Part Video",
      pages: [{ page: 1, part: "A", durationSec: 10, cid: 1 }],
    });

    const interaction = buildInteraction("https://www.bilibili.com/video/BV1abc4567de");
    await command.execute(interaction);

    expect(PlaybackCoordinator.playUrl).toHaveBeenCalledWith("bilibili", expect.objectContaining({
      url: expect.stringContaining("BV1abc4567de"),
    }));
    expect(playPlaylist).not.toHaveBeenCalled();
  });

  test("multipart detection timeout falls back to the normal single-video path", async () => {
    config.playlists.multipartDetectTimeoutMs = 20;
    // Never resolves — forces the withTimeout race to reject first.
    BilibiliApi.getVideoPages.mockReturnValue(new Promise(() => {}));

    const interaction = buildInteraction("https://www.bilibili.com/video/BV1abc4567de");
    await command.execute(interaction);

    expect(PlaybackCoordinator.playUrl).toHaveBeenCalledWith("bilibili", expect.objectContaining({
      url: expect.stringContaining("BV1abc4567de"),
    }));
    expect(playPlaylist).not.toHaveBeenCalled();
  }, 10000);

  test("radio-enabled: skips multipart detection entirely and goes straight to the single-video path", async () => {
    const playbackService = buildPlaybackService({ radioEnabled: true });
    command = playCommand(playbackService, {});

    const interaction = buildInteraction("https://www.bilibili.com/video/BV1abc4567de");
    await command.execute(interaction);

    expect(BilibiliApi.getVideoPages).not.toHaveBeenCalled();
    expect(PlaybackCoordinator.playUrl).toHaveBeenCalledWith("bilibili", expect.objectContaining({
      url: expect.stringContaining("BV1abc4567de"),
    }));
  });

  test("explicit ?p=N URL skips multipart detection (plays only that part)", async () => {
    const interaction = buildInteraction("https://www.bilibili.com/video/BV1abc4567de?p=2");
    await command.execute(interaction);

    expect(BilibiliApi.getVideoPages).not.toHaveBeenCalled();
    expect(PlaybackCoordinator.playUrl).toHaveBeenCalled();
  });
});
