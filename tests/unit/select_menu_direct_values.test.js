jest.mock("discord.js", () => ({
  MessageFlags: { Ephemeral: 64 },
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/ui/embeds", () => ({
  createErrorEmbed: jest.fn((title, description) => ({ title, description })),
  createSuccessEmbed: jest.fn((title, description) => ({ title, description })),
  createQueueEmbed: jest.fn(),
}));

jest.mock("../../src/ui/buttons", () => ({
  createQueueControls: jest.fn().mockReturnValue([]),
}));

jest.mock("../../src/utils/lock", () => ({
  shouldDebounce: jest.fn().mockReturnValue(false),
  acquire: jest.fn().mockReturnValue(true),
  release: jest.fn(),
}));

jest.mock("../../src/bilibili/api", () => ({
  searchVideos: jest.fn(),
}));

const createSelectMenuHandler = require("../../src/bot/events/handlers/select_menu_handler");
const bilibiliApi = require("../../src/bilibili/api");
const logger = require("../../src/services/logger_service");

function makeInteraction({ customId, value }) {
  return {
    customId,
    values: [value],
    user: { id: "user-1", username: "TestUser" },
    guild: { id: "guild-1", name: "Test Guild" },
    channelId: "channel-1",
    member: { voice: { channel: { id: "voice-1" } } },
    message: { embeds: [{ description: "search results" }], edit: jest.fn() },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  };
}

function makePlayerService() {
  const player = {
    isPlaying: false,
    isPaused: false,
    joinVoiceChannel: jest.fn().mockResolvedValue(true),
  };
  const ytExtractor = {
    searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }),
    extractAudio: jest.fn().mockResolvedValue({ title: "Extracted YouTube", audioUrl: "audio", duration: 10 }),
  };
  const extractor = {
    searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }),
  };

  return {
    playBilibiliVideo: jest.fn().mockResolvedValue({
      success: true,
      track: { title: "Played Bilibili" },
    }),
    getYouTubeExtractor: jest.fn().mockReturnValue(ytExtractor),
    getExtractor: jest.fn().mockReturnValue(extractor),
    getPlayer: jest.fn().mockReturnValue(player),
    addTrack: jest.fn().mockResolvedValue({ title: "Queued YouTube" }),
    setUIContext: jest.fn(),
    play: jest.fn().mockResolvedValue(true),
    notifyState: jest.fn(),
    _player: player,
    _ytExtractor: ytExtractor,
    _extractor: extractor,
  };
}

describe("select menu direct video values", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("/play Bilibili direct value plays without repeating keyword search", async () => {
    const playerService = makePlayerService();
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "play_search_hachimi", value: "bili:BV1abc" });

    await handler(interaction);

    expect(playerService.playBilibiliVideo).toHaveBeenCalledWith(
      interaction,
      "https://www.bilibili.com/video/BV1abc",
    );
    expect(bilibiliApi.searchVideos).not.toHaveBeenCalled();
    expect(playerService.getExtractor).not.toHaveBeenCalled();
    expect(playerService._extractor.searchVideos).not.toHaveBeenCalled();
  });

  test("/play Bilibili direct value sets UI context before playback and notifies state", async () => {
    const playerService = makePlayerService();
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "play_search_hachimi", value: "bili:BV1abc" });

    await handler(interaction);

    expect(playerService.setUIContext).toHaveBeenCalledWith("guild-1", "channel-1");
    const setOrder = playerService.setUIContext.mock.invocationCallOrder[0];
    const playOrder = playerService.playBilibiliVideo.mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(playOrder);
    expect(playerService.notifyState).toHaveBeenCalledWith("guild-1");
  });

  test("/play Bilibili direct value does not notify state when playback fails", async () => {
    const playerService = makePlayerService();
    playerService.playBilibiliVideo.mockResolvedValue({ success: false, error: "Network error" });
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "play_search_hachimi", value: "bili:BV1abc" });

    await handler(interaction);

    expect(playerService.setUIContext).toHaveBeenCalledWith("guild-1", "channel-1");
    expect(playerService.notifyState).not.toHaveBeenCalled();
  });

  test("/play YouTube direct value extracts audio without repeating keyword search", async () => {
    const playerService = makePlayerService();
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "play_search_hachimi", value: "yt:dQw4w9WgXcQ" });

    await handler(interaction);

    expect(playerService._ytExtractor.extractAudio).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(playerService._ytExtractor.searchVideos).not.toHaveBeenCalled();
    expect(playerService.addTrack).toHaveBeenCalled();
  });

  test("/play YouTube direct value does not log queue success when extraction fails", async () => {
    const playerService = makePlayerService();
    playerService._ytExtractor.extractAudio.mockRejectedValue(new Error("extract failed"));
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "play_search_hachimi", value: "yt:dQw4w9WgXcQ" });

    await handler(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({ title: "Failed to Add Video" })],
    });
    expect(logger.info).not.toHaveBeenCalledWith(
      "Video added to queue from direct play search",
      expect.any(Object),
    );
  });

  test("/search YouTube direct value defers failure replies ephemerally", async () => {
    const playerService = makePlayerService();
    playerService._ytExtractor.extractAudio.mockRejectedValue(new Error("extract failed"));
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "search_select_hachimi", value: "yt:abcdefghijk" });

    await handler(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({ title: "Failed to Add Video" })],
    });
  });

  test("/search Bilibili direct value plays without repeating keyword search", async () => {
    const playerService = makePlayerService();
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "search_select_hachimi", value: "bili:av12345" });

    await handler(interaction);

    expect(playerService.playBilibiliVideo).toHaveBeenCalledWith(
      interaction,
      "https://www.bilibili.com/video/av12345",
    );
    expect(playerService._extractor.searchVideos).not.toHaveBeenCalled();
  });

  test("/search YouTube direct value extracts audio without repeating keyword search", async () => {
    const playerService = makePlayerService();
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "search_select_hachimi", value: "yt:abcdefghijk" });

    await handler(interaction);

    expect(playerService._ytExtractor.extractAudio).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
    expect(playerService._ytExtractor.searchVideos).not.toHaveBeenCalled();
  });

  test("legacy /play Bilibili index value still falls back to a search", async () => {
    bilibiliApi.searchVideos.mockResolvedValue([
      { title: "Legacy Bili", bvid: "BVlegacy", url: "https://www.bilibili.com/video/BVlegacy" },
    ]);
    const playerService = makePlayerService();
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "play_search_hachimi", value: "bili_0" });

    await handler(interaction);

    expect(bilibiliApi.searchVideos).toHaveBeenCalledWith("hachimi", 1, 10);
    expect(playerService.playBilibiliVideo).toHaveBeenCalledWith(
      interaction,
      "https://www.bilibili.com/video/BVlegacy",
    );
  });

  test("legacy /play YouTube index value still falls back to a search", async () => {
    const playerService = makePlayerService();
    playerService._ytExtractor.searchVideos.mockResolvedValue({
      success: true,
      results: [{ title: "Legacy YouTube", id: "dQw4w9WgXcQ" }],
    });
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "play_search_hachimi", value: "yt_0" });

    await handler(interaction);

    expect(playerService._ytExtractor.searchVideos).toHaveBeenCalledWith("hachimi", 10);
    expect(playerService._ytExtractor.extractAudio).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  test("legacy /search index value still falls back to a Bilibili search", async () => {
    const playerService = makePlayerService();
    playerService._extractor.searchVideos.mockResolvedValue({
      success: true,
      results: [{ title: "Legacy Search", id: "12345" }],
    });
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeInteraction({ customId: "search_select_hachimi", value: "search_result_0" });

    await handler(interaction);

    expect(playerService._extractor.searchVideos).toHaveBeenCalledWith("hachimi", 25);
    expect(playerService.playBilibiliVideo).toHaveBeenCalledWith(
      interaction,
      "https://www.bilibili.com/video/av12345",
    );
  });
});
