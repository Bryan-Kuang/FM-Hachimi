const { SlashCommandBuilder } = require("discord.js");

// Mock discord.js
jest.mock("discord.js", () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => {
    const builder = {};
    const optionBuilder = {
      setName: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setRequired: jest.fn().mockReturnThis(),
      setMinValue: jest.fn().mockReturnThis(),
      setMaxValue: jest.fn().mockReturnThis(),
      addChoices: jest.fn().mockReturnThis(),
      addStringOption: jest.fn().mockReturnThis(),
      addIntegerOption: jest.fn().mockReturnThis(),
    };

    builder.setName = jest.fn().mockReturnThis();
    builder.setDescription = jest.fn().mockReturnThis();
    builder.addStringOption = jest.fn().mockImplementation((cb) => {
      if (cb) cb(optionBuilder);
      return builder;
    });
    builder.addIntegerOption = jest.fn().mockImplementation((cb) => {
      if (cb) cb(optionBuilder);
      return builder;
    });
    return builder;
  }),
  EmbedBuilder: jest.fn().mockImplementation(() => {
    const builder = {};
    builder.data = {};
    builder.setTitle = jest.fn().mockImplementation((t) => {
      builder.data.title = t;
      return builder;
    });
    builder.setDescription = jest.fn().mockImplementation((d) => {
      builder.data.description = d;
      return builder;
    });
    builder.setColor = jest.fn().mockReturnThis();
    builder.addFields = jest.fn().mockReturnThis();
    builder.setThumbnail = jest.fn().mockReturnThis();
    builder.setFooter = jest.fn().mockReturnThis();
    builder.setTimestamp = jest.fn().mockReturnThis();
    builder.setURL = jest.fn().mockReturnThis();
    builder.setAuthor = jest.fn().mockReturnThis();
    return builder;
  }),
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
  })),
  ButtonBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
    setDisabled: jest.fn().mockReturnThis(),
    setEmoji: jest.fn().mockReturnThis(),
  })),
  ButtonStyle: {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5,
  },
  MessageFlags: {
    Ephemeral: 64,
  },
}));

// Mock dependencies
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/bilibili/api", () => ({
  searchVideos: jest.fn().mockResolvedValue([]),
}));

// Mock player used by SceneFactory
const mockPlayer = {
  isPlaying: false,
  isPaused: false,
  queue: [],
  voiceConnection: null,
  stop: jest.fn().mockResolvedValue(true),
  getState: jest.fn(),
  getCurrentTime: jest.fn().mockReturnValue(0),
  joinVoiceChannel: jest.fn().mockResolvedValue(true),
};

// Create mock playbackService
const mockPlaybackService = {
  stop: jest.fn().mockResolvedValue(true),
  pause: jest.fn().mockReturnValue(true),
  resume: jest.fn().mockReturnValue(true),
  skip: jest.fn().mockResolvedValue(true),
  previous: jest.fn().mockResolvedValue(true),
  play: jest.fn().mockResolvedValue(true),
  setUIContext: jest.fn(),
  clearUIContext: jest.fn(),
  hasUIContext: jest.fn(),
  getUIContext: jest.fn(),
  getPlayer: jest.fn().mockReturnValue(mockPlayer),
  getExtractor: jest.fn(),
  getYouTubeExtractor: jest.fn().mockReturnValue(null),
  playBilibiliVideo: jest.fn().mockResolvedValue({ success: true, track: { title: "Track" } }),
  notifyState: jest.fn(),
};

const mockQueueService = {
  addTrack: jest.fn().mockResolvedValue({ title: 'Track' }),
  getQueue: jest.fn(),
};

const SceneFactory = require("../utils/scene_factory");

const logger = require("../../src/services/logger_service");
const bilibiliApi = require("../../src/bilibili/api");
const snapshotMinimal = (embed) => ({
  title: embed?.data?.title,
  description: embed?.data?.description,
});

describe("Bot Commands Coverage", () => {
  let interaction;

  beforeEach(() => {
    jest.clearAllMocks();
    bilibiliApi.searchVideos.mockResolvedValue([]);
    // Reset mockPlayer state
    mockPlayer.isPlaying = false;
    mockPlayer.isPaused = false;
    mockPlayer.queue = [];
    mockPlayer.voiceConnection = null;
    mockPlaybackService.getPlayer.mockReturnValue(mockPlayer);
    mockPlaybackService.playBilibiliVideo.mockResolvedValue({ success: true, track: { title: "Track" } });
    interaction = {
      user: { username: "TestUser" },
      member: { voice: { channel: { id: "vc-1" } } },
      guild: { id: "guild-1", name: "Test Guild" },
      channelId: "channel-1",
      reply: jest.fn(),
      editReply: jest.fn(),
      deferReply: jest.fn(),
      followUp: jest.fn(),
    };
  });

  describe("Stop Command", () => {
    const stopCommand = require("../../src/bot/commands/stop")(mockPlaybackService);

    const testCases = [
      {
        description: "用户不在语音频道",
        scene: { userVc: null, botVc: "vc-1", playerState: "playing" },
        expected: {
          playerCalled: false,
          replyContains: "Voice channel required",
        },
      },
      {
        description: "正常停止",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "playing" },
        expected: { playerCalled: true, replyContains: "[■] Stopped" },
      },
      {
        description: "仅连接不播放",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "connected" },
        expected: { playerCalled: true, replyContains: "[■] Stopped" },
      },
      {
        description: "未连接且不播放",
        scene: { userVc: "vc-1", botVc: null, playerState: "idle" },
        expected: { playerCalled: false, replyContains: "Nothing to stop" },
      },
      {
        description: "停止失败",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "playing" },
        setup: () => { mockPlaybackService.stop.mockResolvedValue(false); },
        expected: { playerCalled: true, replyContains: "Stop failed" },
      },
    ];

    test.each(testCases)("%s", async ({ scene, setup, expected }) => {
      mockPlaybackService.stop.mockResolvedValue(true);
      const { interaction, player } = SceneFactory.createScene(scene);
      // Wire the mockPlaybackService.getPlayer to return the scene player
      mockPlaybackService.getPlayer.mockReturnValue(player);
      if (setup) setup();
      await stopCommand.execute(interaction);

      if (scene.userVc) {
        expect(mockPlaybackService.setUIContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      } else {
        expect(mockPlaybackService.setUIContext).not.toHaveBeenCalled();
      }

      if (expected.playerCalled) {
        expect(mockPlaybackService.stop).toHaveBeenCalledWith("guild-1");
      } else {
        expect(mockPlaybackService.stop).not.toHaveBeenCalled();
      }

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(expected.replyContains),
        })
      );
    });
  });

  describe("Pause Command", () => {
    const pauseCommand = require("../../src/bot/commands/pause")(mockPlaybackService);

    const cases = [
      {
        description: "用户不在语音频道",
        scene: { userVc: null, botVc: "vc-1", playerState: "idle" },
        setup: () => {},
        expected: {
          replyContains: "Voice channel required",
          contextCalled: false,
        },
      },
      {
        description: "暂停失败",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          mockPlaybackService.pause.mockReturnValue(false);
        },
        expected: { editReplyContains: "暂停失败", contextCalled: true },
      },
      {
        description: "正常暂停",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          mockPlaybackService.pause.mockReturnValue(true);
        },
        expected: { editReplyContains: "[||] 已暂停", contextCalled: true },
      },
    ];

    test.each(cases)("%s", async ({ scene, setup, expected }) => {
      const { interaction } = SceneFactory.createScene(scene);
      setup();

      await pauseCommand.execute(interaction);

      if (expected.contextCalled) {
        expect(mockPlaybackService.setUIContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      } else {
        expect(mockPlaybackService.setUIContext).not.toHaveBeenCalled();
      }
      if (expected.replyContains) {
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining(expected.replyContains),
          })
        );
      }
      if (expected.editReplyContains) {
        expect(interaction.editReply).toHaveBeenCalledWith(
          expected.editReplyContains
        );
      }
    });
  });

  describe("Resume Command", () => {
    const resumeCommand = require("../../src/bot/commands/resume")(mockPlaybackService);

    const cases = [
      {
        description: "用户不在语音频道",
        scene: { userVc: null, botVc: "vc-1", playerState: "idle" },
        setup: () => {},
        expected: {
          replyContains: "Voice channel required",
          contextCalled: false,
        },
      },
      {
        description: "恢复失败",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          mockPlaybackService.resume.mockReturnValue(false);
        },
        expected: { editReplyContains: "恢复失败", contextCalled: true },
      },
      {
        description: "正常恢复",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          mockPlaybackService.resume.mockReturnValue(true);
        },
        expected: { editReplyContains: "> 已恢复", contextCalled: true },
      },
    ];

    test.each(cases)("%s", async ({ scene, setup, expected }) => {
      const { interaction } = SceneFactory.createScene(scene);
      setup();

      await resumeCommand.execute(interaction);

      if (expected.contextCalled) {
        expect(mockPlaybackService.setUIContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      } else {
        expect(mockPlaybackService.setUIContext).not.toHaveBeenCalled();
      }
      if (expected.replyContains) {
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining(expected.replyContains),
          })
        );
      }
      if (expected.editReplyContains) {
        expect(interaction.editReply).toHaveBeenCalledWith(
          expected.editReplyContains
        );
      }
    });
  });

  describe("Skip Command", () => {
    const skipCommand = require("../../src/bot/commands/skip")(mockPlaybackService);

    const cases = [
      {
        description: "用户不在语音频道",
        scene: { userVc: null, botVc: "vc-1", playerState: "idle" },
        setup: () => {},
        expected: {
          replyContains: "Voice channel required",
          contextCalled: false,
        },
      },
      {
        description: "没有下一首",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          mockPlaybackService.skip.mockResolvedValue(false);
        },
        expected: { editReplyContains: "没有下一首", contextCalled: true },
      },
      {
        description: "正常跳过",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          mockPlaybackService.skip.mockResolvedValue(true);
        },
        expected: { editReplyContains: ">> 已跳过", contextCalled: true },
      },
    ];

    test.each(cases)("%s", async ({ scene, setup, expected }) => {
      const { interaction } = SceneFactory.createScene(scene);
      setup();

      await skipCommand.execute(interaction);

      if (expected.contextCalled) {
        expect(mockPlaybackService.setUIContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      } else {
        expect(mockPlaybackService.setUIContext).not.toHaveBeenCalled();
      }
      if (expected.replyContains) {
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining(expected.replyContains),
          })
        );
      }
      if (expected.editReplyContains) {
        expect(interaction.editReply).toHaveBeenCalledWith(
          expected.editReplyContains
        );
      }
    });
  });

  describe("Prev Command", () => {
    const prevCommand = require("../../src/bot/commands/prev")(mockPlaybackService);

    const cases = [
      {
        description: "用户不在语音频道",
        scene: { userVc: null, botVc: "vc-1", playerState: "idle" },
        setup: () => {},
        expected: {
          replyContains: "Voice channel required",
          contextCalled: false,
        },
      },
      {
        description: "没有上一首",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          mockPlaybackService.previous.mockResolvedValue(false);
        },
        expected: { editReplyContains: "没有上一首", contextCalled: true },
      },
      {
        description: "正常上一首",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          mockPlaybackService.previous.mockResolvedValue(true);
        },
        expected: { editReplyContains: "|< 已返回上一首", contextCalled: true },
      },
    ];

    test.each(cases)("%s", async ({ scene, setup, expected }) => {
      const { interaction } = SceneFactory.createScene(scene);
      setup();

      await prevCommand.execute(interaction);

      if (expected.contextCalled) {
        expect(mockPlaybackService.setUIContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      } else {
        expect(mockPlaybackService.setUIContext).not.toHaveBeenCalled();
      }
      if (expected.replyContains) {
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining(expected.replyContains),
          })
        );
      }
      if (expected.editReplyContains) {
        expect(interaction.editReply).toHaveBeenCalledWith(
          expected.editReplyContains
        );
      }
    });
  });

  describe("Queue Command", () => {
    const queueCommand = require("../../src/bot/commands/queue")(mockPlaybackService, mockQueueService);

    const cases = [
      {
        description: "空队列",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        queueResult: {
          queue: [],
          currentTrack: null,
          state: { queueLength: 0, currentIndex: 0 },
        },
      },
      {
        description: "非空队列",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        queueResult: {
          queue: [
            { title: "A", uploader: "U1" },
            { title: "B", uploader: "U2" },
          ],
          currentTrack: { title: "A" },
          state: { queueLength: 2, currentIndex: 0 },
        },
      },
    ];

    test.each(cases)("%s", async ({ scene, queueResult }) => {
      const { interaction } = SceneFactory.createScene(scene);
      mockQueueService.getQueue.mockReturnValue(queueResult);

      await queueCommand.execute(interaction);

      expect(mockQueueService.getQueue).toHaveBeenCalledWith("guild-1");
      const arg = interaction.reply.mock.calls[0][0];
      expect(arg).toEqual(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
      expect(snapshotMinimal(arg.embeds[0])).toMatchSnapshot();
    });
  });

  describe("NowPlaying Command", () => {
    const nowPlayingCommand = require("../../src/bot/commands/nowplaying")(mockPlaybackService);

    const cases = [
      {
        description: "正在播放",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "playing" },
        state: {
          isPlaying: true,
          currentTrack: { title: "Test Track", user: "User", duration: 60 },
          currentIndex: 0,
          queueLength: 1,
          loopMode: "none",
          hasPrevious: false,
          hasNext: false,
        },
        expectErrorTitle: null,
      },
      {
        description: "未播放",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        state: {
          isPlaying: false,
          isPaused: false,
          currentTrack: null,
        },
        expectErrorTitle: "[✗] Nothing Playing",
      },
    ];

    test.each(cases)("%s", async ({ scene, state, expectErrorTitle }) => {
      const { interaction, player } = SceneFactory.createScene(scene);
      player.getState.mockReturnValue(state);
      player.getCurrentTime.mockReturnValue(30);
      mockPlaybackService.getPlayer.mockReturnValue(player);

      await nowPlayingCommand.execute(interaction);

      const arg = interaction.reply.mock.calls[0][0];
      if (expectErrorTitle) {
        expect(arg).toEqual(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({ title: expectErrorTitle }),
              }),
            ]),
            flags: 64,
          })
        );
      } else {
        expect(arg).toEqual(
          expect.objectContaining({
            embeds: expect.any(Array),
            components: expect.any(Array),
          })
        );
        expect(snapshotMinimal(arg.embeds[0])).toMatchSnapshot();
      }
    });
  });

  describe("Help Command", () => {
    const helpCommand = require("../../src/bot/commands/help")(mockPlaybackService);

    test("should display help info", async () => {
      const { interaction } = SceneFactory.createScene({
        userVc: "vc-1",
        botVc: "vc-1",
        playerState: "idle",
      });
      await helpCommand.execute(interaction);

      const arg = interaction.reply.mock.calls[0][0];
      expect(arg.flags).toBe(64);
      expect(arg.embeds).toBeDefined();
      expect(snapshotMinimal(arg.embeds[0])).toMatchSnapshot();
      expect(snapshotMinimal(arg.embeds[0]).title).toBe(
        "Bilibili Music Bot - Commands"
      );
    });
  });

  describe("Play Command", () => {
    jest.mock("../../src/bilibili/validator", () => ({
      isValidBilibiliUrl: jest.fn(),
      normalizeUrl: jest.fn((url) => url),
    }));
    jest.mock("../../src/youtube/validator", () => ({
      isValidYouTubeUrl: jest.fn().mockReturnValue(false),
      normalizeUrl: jest.fn((url) => url),
    }));
    const playCommand = require("../../src/bot/commands/play")(mockPlaybackService, mockQueueService);
    const UrlValidator = require("../../src/bilibili/validator");

    const cases = [
      {
        description: "用户不在语音频道",
        scene: {
          userVc: null,
          botVc: "vc-1",
          playerState: "idle",
          options: { query: "https://bili/1" },
        },
        setup: () => {
          UrlValidator.isValidBilibiliUrl.mockReturnValue(true);
        },
        expected: {
          replyContains: "Voice channel required",
          deferCalled: false,
        },
      },
      {
        description: "Bot在其它频道",
        scene: {
          userVc: "vc-1",
          botVc: "vc-2",
          playerState: "idle",
          options: { query: "https://bili/1" },
        },
        setup: () => {
          UrlValidator.isValidBilibiliUrl.mockReturnValue(true);
        },
        expected: {
          replyContains: "Bot is already playing",
          deferCalled: false,
        },
      },
      {
        description: "keyword search no results",
        scene: {
          userVc: "vc-1",
          botVc: null,
          playerState: "idle",
          options: { query: "nonexistent" },
        },
        setup: () => {
          UrlValidator.isValidBilibiliUrl.mockReturnValue(false);
          // Mock both extractors to return empty results
          mockPlaybackService.getExtractor.mockReturnValue({
            searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }),
          });
          mockPlaybackService.getYouTubeExtractor.mockReturnValue({
            searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }),
          });
        },
        expected: { editReplyContains: "No results found", deferCalled: true },
      },
      {
        description: "加入语音失败",
        scene: {
          userVc: "vc-1",
          botVc: null,
          playerState: "idle",
          options: { query: "https://bili/1" },
        },
        setup: () => {
          UrlValidator.isValidBilibiliUrl.mockReturnValue(true);
          mockPlaybackService.playBilibiliVideo.mockResolvedValue({
            success: false,
            error: "Failed to join voice",
          });
        },
        expected: {
          editReplyContains: "Failed to join voice",
          deferCalled: true,
        },
      },
      {
        description: "添加队列失败",
        scene: {
          userVc: "vc-1",
          botVc: null,
          playerState: "idle",
          options: { query: "https://bili/1" },
        },
        setup: () => {
          UrlValidator.isValidBilibiliUrl.mockReturnValue(true);
          mockPlaybackService.playBilibiliVideo.mockResolvedValue({
            success: false,
            error: "Add failed",
          });
        },
        expected: { editReplyContains: "Add failed", deferCalled: true },
      },
      {
        description: "正常播放",
        scene: {
          userVc: "vc-1",
          botVc: null,
          playerState: "idle",
          options: { query: "https://bili/1" },
        },
        setup: () => {
          UrlValidator.isValidBilibiliUrl.mockReturnValue(true);
          mockPlaybackService.playBilibiliVideo.mockResolvedValue({
            success: true,
            track: { title: "Track" },
          });
        },
        expected: {
          editReplyContains: ">> 已添加",
          deferCalled: true,
          playBilibiliCalled: true,
        },
      },
    ];

    test.each(cases)("%s", async ({ scene, setup, expected }) => {
      const { interaction, player } = SceneFactory.createScene(scene);
      interaction.deferReply = jest.fn().mockResolvedValue();
      mockPlaybackService.getPlayer.mockReturnValue(player);
      setup({ player });

      await playCommand.execute(interaction);

      if (expected.replyContains) {
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining(expected.replyContains),
          })
        );
      }
      if (expected.editReplyContains) {
        expect(interaction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining(expected.editReplyContains),
          })
        );
      }
      if (expected.deferCalled) {
        expect(interaction.deferReply).toHaveBeenCalled();
      } else {
        expect(interaction.deferReply).not.toHaveBeenCalled();
      }
      if (expected.playBilibiliCalled) {
        expect(mockPlaybackService.playBilibiliVideo).toHaveBeenCalledWith(
          interaction,
          "https://bili/1",
          expect.objectContaining({ onStage: expect.any(Function) }),
        );
        expect(mockPlaybackService.setUIContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      }
    });
  });

  describe("Search Command", () => {
    const searchCommand = require("../../src/bot/commands/search")(mockPlaybackService);

    beforeAll(() => {
      jest.useFakeTimers();
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    const cases = [
      {
        description: "搜索成功返回结果",
        scene: {
          userVc: "vc-1",
          botVc: "vc-1",
          playerState: "idle",
          options: { keyword: "keyword", results: 5 },
        },
        extractor: {
          searchVideos: jest.fn().mockResolvedValue({
            success: true,
            results: [
              {
                title: "Test Video",
                url: "http://test.com",
                duration: "1:00",
                author: "Test Author",
              },
            ],
          }),
        },
        expectTitle: null,
      },
      {
        description: "搜索无结果",
        scene: {
          userVc: "vc-1",
          botVc: "vc-1",
          playerState: "idle",
          options: { keyword: "keyword", results: 5 },
        },
        extractor: {
          searchVideos: jest
            .fn()
            .mockResolvedValue({ success: true, results: [] }),
        },
        expectTitle: "[✗] No Results Found",
      },
    ];

    test.each(cases)("%s", async ({ scene, extractor, expectTitle }) => {
      const { interaction } = SceneFactory.createScene(scene);
      interaction.deferReply = jest.fn().mockResolvedValue();
      mockPlaybackService.getExtractor.mockReturnValue(extractor);

      await searchCommand.execute(interaction);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(extractor.searchVideos).toHaveBeenCalledWith(
        scene.options.keyword,
        scene.options.results
      );

      if (expectTitle) {
        expect(interaction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({ title: expectTitle }),
              }),
            ]),
          })
        );
      } else {
        expect(interaction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({ embeds: expect.any(Array) })
        );
      }
    });
  });
});
