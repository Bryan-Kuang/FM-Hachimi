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
          addChoices: jest.fn().mockReturnThis(),
        });
        return builder;
      }),
      addIntegerOption: jest.fn().mockImplementation((cb) => {
        cb({
          setName: jest.fn().mockReturnThis(),
          setDescription: jest.fn().mockReturnThis(),
          setMinValue: jest.fn().mockReturnThis(),
          setMaxValue: jest.fn().mockReturnThis(),
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

jest.mock("../../src/ui/embeds", () => ({
  createSearchResultsEmbed: jest.fn().mockReturnValue({ title: "Search Results" }),
  createErrorEmbed: jest.fn().mockReturnValue({ title: "Error" }),
}));

jest.mock("../../src/ui/buttons", () => ({
  createSearchResultsMenu: jest.fn().mockReturnValue({ type: "menu" }),
}));

const EmbedBuilders = require("../../src/ui/embeds");
const ButtonBuilders = require("../../src/ui/buttons");
const createSearchCommand = require("../../src/bot/commands/search");

function makeInteraction(platform = "bilibili") {
  return {
    options: {
      getString: jest.fn((name, required) => {
        if (name === "keyword") return "哈基米无止境电台";
        if (name === "platform") return platform;
        return required ? "哈基米无止境电台" : null;
      }),
      getInteger: jest.fn((name) => (name === "results" ? 5 : null)),
    },
    user: { username: "Tester" },
    guild: { name: "Guild" },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: true,
  };
}

describe("/search result relevance ranking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("Bilibili search promotes exact title matches within the requested results", async () => {
    const extractor = {
      searchVideos: jest.fn().mockResolvedValue({
        success: true,
        results: [
          ...Array.from({ length: 4 }, (_, index) => ({
            title: `完全无关 ${index}`,
            id: `off-${index}`,
            url: `https://www.bilibili.com/video/BVoff${index}`,
            duration: 60,
          })),
          {
            title: "【哈基米】无止境电台",
            id: "BV1JuhNz6Eg6",
            url: "https://www.bilibili.com/video/BV1JuhNz6Eg6",
            duration: 185,
          },
        ],
      }),
    };
    const playbackService = {
      getExtractor: jest.fn().mockReturnValue(extractor),
      prewarmBilibiliUrls: jest.fn(),
    };
    const command = createSearchCommand(playbackService);

    await command.execute(makeInteraction("bilibili"));

    expect(extractor.searchVideos).toHaveBeenCalledWith("哈基米无止境电台", 5);
    const [displayedResults] = EmbedBuilders.createSearchResultsEmbed.mock.calls[0];
    expect(displayedResults[0]).toEqual(expect.objectContaining({ id: "BV1JuhNz6Eg6" }));
    expect(displayedResults).toHaveLength(5);
    expect(displayedResults.map(result => result.title)).toContain("完全无关 0");
    expect(ButtonBuilders.createSearchResultsMenu.mock.calls[0][0][0]).toEqual(
      expect.objectContaining({ id: "BV1JuhNz6Eg6" }),
    );
    expect(playbackService.prewarmBilibiliUrls).toHaveBeenCalledWith(
      expect.arrayContaining(["https://www.bilibili.com/video/BV1JuhNz6Eg6"]),
      expect.objectContaining({
        source: "search_command",
        keyword: "哈基米无止境电台",
      }),
    );
  });

  test("YouTube search promotes exact title matches within the requested results", async () => {
    const ytExtractor = {
      searchVideos: jest.fn().mockResolvedValue({
        success: true,
        results: [
          ...Array.from({ length: 4 }, (_, index) => ({
            title: `Unrelated ${index}`,
            id: `ytid00000${index}`,
            duration: 60,
          })),
          {
            title: "哈基米无止境电台",
            id: "ytidtarget1",
            duration: 185,
          },
        ],
      }),
    };
    const playbackService = {
      getYouTubeExtractor: jest.fn().mockReturnValue(ytExtractor),
      prewarmBilibiliUrls: jest.fn(),
    };
    const command = createSearchCommand(playbackService);

    await command.execute(makeInteraction("youtube"));

    expect(ytExtractor.searchVideos).toHaveBeenCalledWith("哈基米无止境电台", 5);
    const [displayedResults] = EmbedBuilders.createSearchResultsEmbed.mock.calls[0];
    expect(displayedResults[0]).toEqual(expect.objectContaining({ id: "ytidtarget1" }));
    expect(displayedResults).toHaveLength(5);
    expect(displayedResults.map(result => result.title)).toContain("Unrelated 0");
    expect(ButtonBuilders.createSearchResultsMenu.mock.calls[0][0][0]).toEqual(
      expect.objectContaining({ id: "ytidtarget1" }),
    );
    expect(playbackService.prewarmBilibiliUrls).not.toHaveBeenCalled();
  });
});
