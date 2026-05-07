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

jest.mock("../../src/ui/embeds", () => ({
  createDualSearchEmbed: jest.fn().mockReturnValue({ title: "Search Results" }),
}));

jest.mock("../../src/ui/buttons", () => ({
  createDualSearchMenu: jest.fn().mockReturnValue({ type: "menu" }),
}));

const bilibiliApi = require("../../src/bilibili/api");
const EmbedBuilders = require("../../src/ui/embeds");
const ButtonBuilders = require("../../src/ui/buttons");
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

  test("requests and displays five results from each platform", async () => {
    const biliResults = Array.from({ length: 20 }, (_, index) => ({
      title: `Bili ${index}`,
      bvid: `BV${index}`,
      author: "Bili Uploader",
      duration: 60 + index,
    }));
    const ytResults = Array.from({ length: 8 }, (_, index) => ({
      title: `YouTube ${index}`,
      id: `ytid00000${index}`,
      uploader: "YouTube Uploader",
      duration: 120 + index,
    }));

    bilibiliApi.searchVideos.mockResolvedValue(biliResults);
    const ytExtractor = {
      searchVideos: jest.fn().mockResolvedValue({ success: true, results: ytResults }),
    };
    const playbackService = {
      getYouTubeExtractor: jest.fn().mockReturnValue(ytExtractor),
    };
    const command = createPlayCommand(playbackService, {});

    await command.execute(makeInteraction());

    expect(bilibiliApi.searchVideos).toHaveBeenCalledWith("hachimi", 1, 5);
    expect(ytExtractor.searchVideos).toHaveBeenCalledWith("hachimi", 5);
    expect(EmbedBuilders.createDualSearchEmbed).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: "Bili 0" })]),
      expect.arrayContaining([expect.objectContaining({ title: "YouTube 0" })]),
      "hachimi",
    );
    const [biliDisplayed, ytDisplayed] = EmbedBuilders.createDualSearchEmbed.mock.calls[0];
    expect(biliDisplayed).toHaveLength(5);
    expect(ytDisplayed).toHaveLength(5);
    expect(ButtonBuilders.createDualSearchMenu.mock.calls[0][0]).toHaveLength(5);
    expect(ButtonBuilders.createDualSearchMenu.mock.calls[0][1]).toHaveLength(5);
  });

  test("promotes exact title matches within the returned five results", async () => {
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
    };
    const command = createPlayCommand(playbackService, {});

    await command.execute(makeInteraction("哈基米无止境电台"));

    const [biliDisplayed, ytDisplayed] = EmbedBuilders.createDualSearchEmbed.mock.calls[0];
    expect(biliDisplayed[0]).toEqual(expect.objectContaining({ bvid: "BV1JuhNz6Eg6" }));
    expect(ytDisplayed[0]).toEqual(expect.objectContaining({ id: "ytidtarget1" }));
    expect(biliDisplayed).toHaveLength(5);
    expect(ytDisplayed).toHaveLength(5);
    expect(biliDisplayed.map(result => result.title)).toContain("完全无关 0");
    expect(ytDisplayed.map(result => result.title)).toContain("Unrelated 0");
  });
});
