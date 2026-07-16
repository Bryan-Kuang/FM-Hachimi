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

// Spotify search is only exercised when config.spotify.enabled — most tests
// below run with it disabled (the default test env has no client id/secret),
// so this mock only matters for the dedicated "Spotify enabled" tests.
const mockSearchTracks = jest.fn().mockResolvedValue([]);
jest.mock("../../src/spotify/client", () => jest.fn().mockImplementation(() => ({
  searchTracks: mockSearchTracks,
})));

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

describe("/play tri-platform keyword search limits", () => {
  let originalSpotifyEnabled;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchTracks.mockResolvedValue([]);
    originalSpotifyEnabled = config.spotify.enabled;
    config.spotify.enabled = false;
  });

  afterEach(() => {
    config.spotify.enabled = originalSpotifyEnabled;
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
    expect(mockSearchTracks).not.toHaveBeenCalled();

    const [biliDisplayed] = SearchResultsView.createSessionEntries.mock.calls[0];
    const [ytDisplayed] = SearchResultsView.createSessionEntries.mock.calls[1];
    const [spotifyDisplayed, spotifyPlatformArg] = SearchResultsView.createSessionEntries.mock.calls[2];
    expect(biliDisplayed[0]).toEqual(expect.objectContaining({ title: "Bili 0" }));
    expect(ytDisplayed[0]).toEqual(expect.objectContaining({ title: "YouTube 0" }));
    expect(biliDisplayed).toHaveLength(Math.min(20, config.search.limitPerPlatform));
    expect(ytDisplayed).toHaveLength(8);
    // Spotify is disabled, so its arm always contributes an empty list.
    expect(spotifyPlatformArg).toBe("spotify");
    expect(spotifyDisplayed).toHaveLength(0);

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

  test("Spotify disabled: search copy omits Spotify and no Spotify entries are created", async () => {
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

    expect(mockSearchTracks).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Bilibili & YouTube") }),
    );
    expect(interaction.editReply).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Spotify") }),
    );
  });

  test("Spotify enabled: searches all three platforms and mentions Spotify in the searching copy", async () => {
    config.spotify.enabled = true;
    const spotifyResults = [
      { id: "spot1", title: "Spot Track", artists: ["Spot Artist"], durationSec: 200 },
    ];
    mockSearchTracks.mockResolvedValue(spotifyResults);

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

    expect(mockSearchTracks).toHaveBeenCalledWith("hachimi", config.search.limitPerPlatform);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Spotify") }),
    );

    const [spotifyDisplayed, spotifyPlatformArg] = SearchResultsView.createSessionEntries.mock.calls[2];
    expect(spotifyPlatformArg).toBe("spotify");
    expect(spotifyDisplayed).toEqual(spotifyResults);
  });

  test("Spotify search failure falls back to Bilibili + YouTube results (Promise.allSettled)", async () => {
    config.spotify.enabled = true;
    mockSearchTracks.mockRejectedValue(new Error("spotify down"));

    bilibiliApi.searchVideos.mockResolvedValue([
      { title: "Bili only", bvid: "BVonly", author: "Uploader", duration: 60 },
    ]);
    const ytExtractor = { searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }) };
    const playbackService = {
      getYouTubeExtractor: jest.fn().mockReturnValue(ytExtractor),
      prewarmBilibiliUrls: jest.fn(),
      prewarmYouTubeUrls: jest.fn(),
    };
    const command = createPlayCommand(playbackService, {});
    const interaction = makeInteraction();

    await command.execute(interaction);

    const [biliDisplayed] = SearchResultsView.createSessionEntries.mock.calls[0];
    const [spotifyDisplayed] = SearchResultsView.createSessionEntries.mock.calls[2];
    expect(biliDisplayed).toHaveLength(1);
    expect(spotifyDisplayed).toHaveLength(0);
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
