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
jest.mock("../../src/control/player_control");
jest.mock("../../src/ui/interface_updater");
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock AudioManager and Player
const mockPlayer = {
  isPlaying: false,
  isPaused: false,
  queue: [],
  voiceConnection: null,
  stop: jest.fn().mockResolvedValue(true),
  getState: jest.fn(),
  getCurrentTime: jest.fn().mockReturnValue(0),
};

const mockAudioManager = {
  getPlayer: jest.fn().mockReturnValue(mockPlayer),
  getQueue: jest.fn(),
  getExtractor: jest.fn(),
};

jest.mock("../../src/audio/manager", () => mockAudioManager);

const SceneFactory = require("../utils/scene_factory");

const PlayerControl = require("../../src/control/player_control");
const InterfaceUpdater = require("../../src/ui/interface_updater");
const logger = require("../../src/services/logger_service");
const snapshotMinimal = (embed) => ({
  title: embed?.data?.title,
  description: embed?.data?.description,
});

describe("Bot Commands Coverage", () => {
  let interaction;

  beforeEach(() => {
    jest.clearAllMocks();
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
    const stopCommand = require("../../src/bot/commands/stop");

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
        expected: { playerCalled: true, replyContains: "⏹️ Stopped" },
      },
      {
        description: "仅连接不播放",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "connected" },
        expected: { playerCalled: true, replyContains: "⏹️ Stopped" },
      },
      {
        description: "未连接且不播放",
        scene: { userVc: "vc-1", botVc: null, playerState: "idle" },
        expected: { playerCalled: false, replyContains: "Nothing to stop" },
      },
      {
        description: "停止失败",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "playing" },
        setup: () => { PlayerControl.stop.mockResolvedValue(false); },
        expected: { playerCalled: true, replyContains: "Stop failed" },
      },
    ];

    test.each(testCases)("%s", async ({ scene, setup, expected }) => {
      PlayerControl.stop.mockResolvedValue(true);
      const { interaction } = SceneFactory.createScene(scene);
      if (setup) setup();
      await stopCommand.execute(interaction);

      if (scene.userVc) {
        expect(InterfaceUpdater.setPlaybackContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      } else {
        expect(InterfaceUpdater.setPlaybackContext).not.toHaveBeenCalled();
      }

      if (expected.playerCalled) {
        expect(PlayerControl.stop).toHaveBeenCalledWith("guild-1");
      } else {
        expect(PlayerControl.stop).not.toHaveBeenCalled();
      }

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(expected.replyContains),
        })
      );
    });
  });

  describe("Pause Command", () => {
    const pauseCommand = require("../../src/bot/commands/pause");

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
          PlayerControl.pause.mockReturnValue(false);
        },
        expected: { editReplyContains: "暂停失败", contextCalled: true },
      },
      {
        description: "正常暂停",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          PlayerControl.pause.mockReturnValue(true);
        },
        expected: { editReplyContains: "⏸️ 已暂停", contextCalled: true },
      },
    ];

    test.each(cases)("%s", async ({ scene, setup, expected }) => {
      const { interaction } = SceneFactory.createScene(scene);
      setup();

      await pauseCommand.execute(interaction);

      if (expected.contextCalled) {
        expect(InterfaceUpdater.setPlaybackContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      } else {
        expect(InterfaceUpdater.setPlaybackContext).not.toHaveBeenCalled();
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
    const resumeCommand = require("../../src/bot/commands/resume");

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
          PlayerControl.resume.mockReturnValue(false);
        },
        expected: { editReplyContains: "恢复失败", contextCalled: true },
      },
      {
        description: "正常恢复",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          PlayerControl.resume.mockReturnValue(true);
        },
        expected: { editReplyContains: "▶️ 已恢复", contextCalled: true },
      },
    ];

    test.each(cases)("%s", async ({ scene, setup, expected }) => {
      const { interaction } = SceneFactory.createScene(scene);
      setup();

      await resumeCommand.execute(interaction);

      if (expected.contextCalled) {
        expect(InterfaceUpdater.setPlaybackContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      } else {
        expect(InterfaceUpdater.setPlaybackContext).not.toHaveBeenCalled();
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
    const skipCommand = require("../../src/bot/commands/skip");

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
          PlayerControl.next.mockResolvedValue(false);
        },
        expected: { editReplyContains: "没有下一首", contextCalled: true },
      },
      {
        description: "正常跳过",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          PlayerControl.next.mockResolvedValue(true);
        },
        expected: { editReplyContains: "⏭️ 已跳过", contextCalled: true },
      },
    ];

    test.each(cases)("%s", async ({ scene, setup, expected }) => {
      const { interaction } = SceneFactory.createScene(scene);
      setup();

      await skipCommand.execute(interaction);

      if (expected.contextCalled) {
        expect(InterfaceUpdater.setPlaybackContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      } else {
        expect(InterfaceUpdater.setPlaybackContext).not.toHaveBeenCalled();
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
    const prevCommand = require("../../src/bot/commands/prev");

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
          PlayerControl.prev.mockResolvedValue(false);
        },
        expected: { editReplyContains: "没有上一首", contextCalled: true },
      },
      {
        description: "正常上一首",
        scene: { userVc: "vc-1", botVc: "vc-1", playerState: "idle" },
        setup: () => {
          PlayerControl.prev.mockResolvedValue(true);
        },
        expected: { editReplyContains: "⏮️ 已返回上一首", contextCalled: true },
      },
    ];

    test.each(cases)("%s", async ({ scene, setup, expected }) => {
      const { interaction } = SceneFactory.createScene(scene);
      setup();

      await prevCommand.execute(interaction);

      if (expected.contextCalled) {
        expect(InterfaceUpdater.setPlaybackContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      } else {
        expect(InterfaceUpdater.setPlaybackContext).not.toHaveBeenCalled();
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
    const queueCommand = require("../../src/bot/commands/queue");

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
      mockAudioManager.getQueue.mockReturnValue(queueResult);

      await queueCommand.execute(interaction);

      expect(mockAudioManager.getQueue).toHaveBeenCalledWith("guild-1");
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
    const nowPlayingCommand = require("../../src/bot/commands/nowplaying");

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
        expectErrorTitle: "❌ Nothing Playing",
      },
    ];

    test.each(cases)("%s", async ({ scene, state, expectErrorTitle }) => {
      const { interaction, player } = SceneFactory.createScene(scene);
      player.getState.mockReturnValue(state);
      player.getCurrentTime.mockReturnValue(30);

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
    const helpCommand = require("../../src/bot/commands/help");

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
        "🎵 Bilibili音乐机器人 - 命令帮助"
      );
    });
  });

  describe("Play Command", () => {
    const playCommand = require("../../src/bot/commands/play");
    jest.mock("../../src/utils/validator", () => ({
      isValidBilibiliUrl: jest.fn(),
    }));
    jest.mock("../../src/playlist/playlist_manager", () => ({
      add: jest.fn(),
    }));
    const UrlValidator = require("../../src/utils/validator");
    const PlaylistManager = require("../../src/playlist/playlist_manager");

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
        description: "关键词搜索无结果",
        scene: {
          userVc: "vc-1",
          botVc: null,
          playerState: "idle",
          options: { query: "nonexistent" },
        },
        setup: () => {
          UrlValidator.isValidBilibiliUrl.mockReturnValue(false);
          const bilibiliApi = require("../../src/utils/bilibiliApi");
          bilibiliApi.searchVideos = jest.fn().mockResolvedValue([]);
        },
        expected: { editReplyContains: "未找到", deferCalled: true },
      },
      {
        description: "加入语音失败",
        scene: {
          userVc: "vc-1",
          botVc: null,
          playerState: "idle",
          options: { query: "https://bili/1" },
        },
        setup: ({ player }) => {
          UrlValidator.isValidBilibiliUrl.mockReturnValue(true);
          player.joinVoiceChannel.mockResolvedValue(false);
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
          PlaylistManager.add.mockResolvedValue(null);
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
          PlaylistManager.add.mockResolvedValue({ title: "Track" });
          PlayerControl.play.mockResolvedValue(true);
        },
        expected: {
          editReplyContains: "🎵 已添加",
          deferCalled: true,
          playCalled: true,
        },
      },
    ];

    test.each(cases)("%s", async ({ scene, setup, expected }) => {
      const { interaction, player } = SceneFactory.createScene(scene);
      interaction.deferReply = jest.fn().mockResolvedValue();
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
      if (expected.playCalled) {
        expect(PlayerControl.play).toHaveBeenCalledWith("guild-1");
        expect(InterfaceUpdater.setPlaybackContext).toHaveBeenCalledWith(
          "guild-1",
          "channel-1"
        );
      }
    });
  });

  describe("Search Command", () => {
    const searchCommand = require("../../src/bot/commands/search");

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
        expectTitle: "❌ No Results Found",
      },
    ];

    test.each(cases)("%s", async ({ scene, extractor, expectTitle }) => {
      const { interaction } = SceneFactory.createScene(scene);
      interaction.deferReply = jest.fn().mockResolvedValue();
      mockAudioManager.getExtractor.mockReturnValue(extractor);

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
