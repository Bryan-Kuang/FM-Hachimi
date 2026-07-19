jest.mock("discord.js", () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => {
    const builder = {
      setName: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      addStringOption: jest.fn().mockImplementation((cb) => {
        cb({
          setName: jest.fn().mockReturnThis(),
          setDescription: jest.fn().mockReturnThis(),
          setRequired: jest.fn().mockReturnThis(),
        });
        return builder;
      }),
      addAttachmentOption: jest.fn().mockImplementation((cb) => {
        cb({
          setName: jest.fn().mockReturnThis(),
          setDescription: jest.fn().mockReturnThis(),
          setRequired: jest.fn().mockReturnThis(),
        });
        return builder;
      }),
    };
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

jest.mock("../../src/bilibili/api", () => ({
  searchVideos: jest.fn(),
}));

// The view needs the real discord.js builders, which the wholesale
// discord.js mock above does not provide.
jest.mock("../../src/ui/search_results_view", () => ({
  RESULTS_PER_PAGE: 5,
  createSessionEntries: jest.fn((results, platform, startIndex = 0) =>
    results.map((result, index) => ({
      platform,
      title: result.title,
      uploader: result.uploader || "Unknown",
      url: result.url || null,
      selectionValue: `idx_${startIndex + index}`,
    }))),
  buildSearchResultsMessage: jest.fn().mockReturnValue({ embeds: [], components: [] }),
  totalPagesFor: jest.fn().mockReturnValue(3),
}));

const bilibiliApi = require("../../src/bilibili/api");
const SearchResultsView = require("../../src/ui/search_results_view");
const config = require("../../src/config/config");
const createPlayCommand = require("../../src/bot/commands/play");

function makeInteraction(query = "hachimi") {
  return {
    options: {
      getString: jest.fn((name) => (name === "query" ? query : null)),
    },
    user: { id: "user-1", username: "Tester" },
    member: { voice: { channel: { id: "voice-1" } } },
    guild: {
      id: "guild-1",
      name: "Guild",
      members: { me: { voice: { channel: null } } },
    },
    channelId: "channel-1",
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: true,
  };
}

describe("/play dual-platform keyword search limits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("requests config.search.limitPerPlatform results from Bilibili and YouTube and prewarms only the first page", async () => {
    const biliResults = Array.from({ length: 20 }, (_, index) => ({
      title: `Bili ${index}`,
      bvid: `BV${index}`,
      author: "Bili Uploader",
      duration: 60 + index,
    }));
    const ytResults = Array.from({ length: 8 }, (_, index) => ({
      title: `YouTube ${index}`,
      id: `ytid000000${index}`,
      url: `https://www.youtube.com/watch?v=ytid000000${index}`,
      uploader: "YouTube Uploader",
      duration: 120 + index,
    }));

    bilibiliApi.searchVideos.mockResolvedValue(biliResults);
    const ytExtractor = {
      searchVideos: jest.fn().mockResolvedValue({ success: true, results: ytResults }),
    };
    const playbackService = {
      getYouTubeExtractor: jest.fn().mockReturnValue(ytExtractor),
      prewarmBilibiliUrls: jest.fn(),
      prewarmYouTubeUrls: jest.fn(),
    };
    const command = createPlayCommand(playbackService, {});

    await command.execute(makeInteraction());

    expect(bilibiliApi.searchVideos).toHaveBeenCalledWith("hachimi", 1, config.search.limitPerPlatform);
    expect(ytExtractor.searchVideos).toHaveBeenCalledWith("hachimi", config.search.limitPerPlatform);

    const [biliDisplayed] = SearchResultsView.createSessionEntries.mock.calls[0];
    const [ytDisplayed] = SearchResultsView.createSessionEntries.mock.calls[1];
    expect(biliDisplayed[0]).toEqual(expect.objectContaining({ title: "Bili 0" }));
    expect(ytDisplayed[0]).toEqual(expect.objectContaining({ title: "YouTube 0" }));
    expect(biliDisplayed).toHaveLength(Math.min(20, config.search.limitPerPlatform));
    expect(ytDisplayed).toHaveLength(8);

    expect(playbackService.prewarmBilibiliUrls).toHaveBeenCalledWith(
      expect.arrayContaining([
        "https://www.bilibili.com/video/BV0",
        "https://www.bilibili.com/video/BV1",
      ]),
      expect.objectContaining({
        source: "play_search",
        guildId: "guild-1",
        keyword: "hachimi",
      }),
    );
    expect(playbackService.prewarmBilibiliUrls.mock.calls[0][0]).toHaveLength(5);
    expect(playbackService.prewarmYouTubeUrls).toHaveBeenCalledWith(
      expect.arrayContaining([
        "https://www.youtube.com/watch?v=ytid0000000",
        "https://www.youtube.com/watch?v=ytid0000001",
      ]),
      expect.objectContaining({
        source: "play_search",
        guildId: "guild-1",
        keyword: "hachimi",
      }),
    );
    expect(playbackService.prewarmYouTubeUrls.mock.calls[0][0]).toHaveLength(5);
  });

  test("search copy mentions Bilibili & YouTube", async () => {
    bilibiliApi.searchVideos.mockResolvedValue([]);
    const ytExtractor = { searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }) };
    const playbackService = {
      getYouTubeExtractor: jest.fn().mockReturnValue(ytExtractor),
      prewarmBilibiliUrls: jest.fn(),
      prewarmYouTubeUrls: jest.fn(),
    };
    const command = createPlayCommand(playbackService, {});
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Bilibili & YouTube") }),
    );
  });

  test("Bilibili search failure falls back to YouTube-only results (Promise.allSettled)", async () => {
    bilibiliApi.searchVideos.mockRejectedValue(new Error("bili down"));

    const ytResults = [
      { title: "YT only", id: "ytidonly001", uploader: "Uploader", duration: 60 },
    ];
    const ytExtractor = { searchVideos: jest.fn().mockResolvedValue({ success: true, results: ytResults }) };
    const playbackService = {
      getYouTubeExtractor: jest.fn().mockReturnValue(ytExtractor),
      prewarmBilibiliUrls: jest.fn(),
      prewarmYouTubeUrls: jest.fn(),
    };
    const command = createPlayCommand(playbackService, {});
    const interaction = makeInteraction();

    await command.execute(interaction);

    const [biliDisplayed] = SearchResultsView.createSessionEntries.mock.calls[0];
    const [ytDisplayed] = SearchResultsView.createSessionEntries.mock.calls[1];
    expect(biliDisplayed).toHaveLength(0);
    expect(ytDisplayed).toHaveLength(1);
  });

  test("promotes exact title matches within the returned results", async () => {
    const biliResults = [
      ...Array.from({ length: 4 }, (_, index) => ({
        title: `完全无关 ${index}`,
        bvid: `BVoff${index}`,
        author: "Bili Uploader",
        duration: 60 + index,
      })),
      {
        title: "【哈基米】无止境电台",
        bvid: "BV1JuhNz6Eg6",
        author: "Bili Uploader",
        duration: 185,
      },
    ];
    const ytResults = [
      ...Array.from({ length: 4 }, (_, index) => ({
        title: `Unrelated ${index}`,
        id: `ytid00000${index}`,
        uploader: "YouTube Uploader",
        duration: 120 + index,
      })),
      {
        title: "哈基米无止境电台",
        id: "ytidtarget1",
        uploader: "YouTube Uploader",
        duration: 180,
      },
    ];

    bilibiliApi.searchVideos.mockResolvedValue(biliResults);
    const ytExtractor = {
      searchVideos: jest.fn().mockResolvedValue({ success: true, results: ytResults }),
    };
    const playbackService = {
      getYouTubeExtractor: jest.fn().mockReturnValue(ytExtractor),
      prewarmBilibiliUrls: jest.fn(),
      prewarmYouTubeUrls: jest.fn(),
    };
    const command = createPlayCommand(playbackService, {});

    await command.execute(makeInteraction("哈基米无止境电台"));

    const [biliDisplayed] = SearchResultsView.createSessionEntries.mock.calls[0];
    const [ytDisplayed] = SearchResultsView.createSessionEntries.mock.calls[1];
    expect(biliDisplayed[0]).toEqual(expect.objectContaining({ bvid: "BV1JuhNz6Eg6" }));
    expect(ytDisplayed[0]).toEqual(expect.objectContaining({ id: "ytidtarget1" }));
    expect(biliDisplayed).toHaveLength(5);
    expect(ytDisplayed).toHaveLength(5);
    expect(biliDisplayed.map(result => result.title)).toContain("完全无关 0");
    expect(ytDisplayed.map(result => result.title)).toContain("Unrelated 0");
  });

  test("normalizes bare YouTube IDs before scheduling pre-extraction", async () => {
    bilibiliApi.searchVideos.mockResolvedValue([]);
    const ytExtractor = {
      searchVideos: jest.fn().mockResolvedValue({
        success: true,
        results: [
          {
            title: "Bare ID result",
            id: "U8suvHwuSkE",
            url: "U8suvHwuSkE",
            uploader: "YouTube Uploader",
            duration: 24,
          },
        ],
      }),
    };
    const playbackService = {
      getYouTubeExtractor: jest.fn().mockReturnValue(ytExtractor),
      prewarmBilibiliUrls: jest.fn(),
      prewarmYouTubeUrls: jest.fn(),
    };
    const command = createPlayCommand(playbackService, {});

    await command.execute(makeInteraction());

    expect(playbackService.prewarmYouTubeUrls).toHaveBeenCalledWith(
      ["https://www.youtube.com/watch?v=U8suvHwuSkE"],
      expect.objectContaining({
        source: "play_search",
        guildId: "guild-1",
        keyword: "hachimi",
      }),
    );
  });
});
