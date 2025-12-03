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

const PlayerControl = require("../../src/control/player_control");
const InterfaceUpdater = require("../../src/ui/interface_updater");
const logger = require("../../src/services/logger_service");

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

    test("should stop playback when connected", async () => {
      mockPlayer.voiceConnection = { destroy: jest.fn() };
      mockPlayer.isPlaying = true;
      PlayerControl.stop.mockResolvedValue(true);

      await stopCommand.execute(interaction);

      expect(InterfaceUpdater.setPlaybackContext).toHaveBeenCalledWith(
        "guild-1",
        "channel-1"
      );
      expect(PlayerControl.stop).toHaveBeenCalledWith("guild-1");
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "⏹️ Stopped" })
      );
    });

    test("should stop playback when just connected but not playing", async () => {
      mockPlayer.voiceConnection = { destroy: jest.fn() };
      mockPlayer.isPlaying = false;
      mockPlayer.isPaused = false;
      mockPlayer.queue = [];
      PlayerControl.stop.mockResolvedValue(true);

      await stopCommand.execute(interaction);

      expect(PlayerControl.stop).toHaveBeenCalledWith("guild-1");
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "⏹️ Stopped" })
      );
    });

    test("should return nothing to stop if not connected and not playing", async () => {
      mockPlayer.voiceConnection = null;
      mockPlayer.isPlaying = false;
      mockPlayer.isPaused = false;
      mockPlayer.queue = [];

      await stopCommand.execute(interaction);

      expect(PlayerControl.stop).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Nothing to stop" })
      );
    });
  });

  describe("Pause Command", () => {
    const pauseCommand = require("../../src/bot/commands/pause");

    test("should pause playback", async () => {
      PlayerControl.pause.mockReturnValue(true);

      await pauseCommand.execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "执行中..." })
      );
      expect(InterfaceUpdater.setPlaybackContext).toHaveBeenCalledWith(
        "guild-1",
        "channel-1"
      );
      expect(PlayerControl.pause).toHaveBeenCalledWith("guild-1");
      expect(interaction.editReply).toHaveBeenCalledWith("⏸️ 已暂停");
    });
  });

  describe("Resume Command", () => {
    const resumeCommand = require("../../src/bot/commands/resume");

    test("should resume playback", async () => {
      PlayerControl.resume.mockReturnValue(true);

      await resumeCommand.execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "执行中..." })
      );
      expect(InterfaceUpdater.setPlaybackContext).toHaveBeenCalledWith(
        "guild-1",
        "channel-1"
      );
      expect(PlayerControl.resume).toHaveBeenCalledWith("guild-1");
      expect(interaction.editReply).toHaveBeenCalledWith("▶️ 已恢复");
    });
  });

  describe("Skip Command", () => {
    const skipCommand = require("../../src/bot/commands/skip");

    test("should skip track", async () => {
      PlayerControl.next.mockResolvedValue(true);

      await skipCommand.execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "执行中..." })
      );
      expect(InterfaceUpdater.setPlaybackContext).toHaveBeenCalledWith(
        "guild-1",
        "channel-1"
      );
      expect(PlayerControl.next).toHaveBeenCalledWith("guild-1");
      expect(interaction.editReply).toHaveBeenCalledWith("⏭️ 已跳过");
    });
  });

  describe("Prev Command", () => {
    const prevCommand = require("../../src/bot/commands/prev");

    test("should go to previous track", async () => {
      PlayerControl.prev.mockResolvedValue(true);

      await prevCommand.execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "执行中..." })
      );
      expect(InterfaceUpdater.setPlaybackContext).toHaveBeenCalledWith(
        "guild-1",
        "channel-1"
      );
      expect(PlayerControl.prev).toHaveBeenCalledWith("guild-1");
      expect(interaction.editReply).toHaveBeenCalledWith("⏮️ 已返回上一首");
    });
  });

  describe("Queue Command", () => {
    const queueCommand = require("../../src/bot/commands/queue");

    test("should display queue", async () => {
      mockAudioManager.getQueue.mockReturnValue({
        queue: [],
        currentTrack: null,
        state: { queueLength: 0, currentIndex: 0 },
      });

      await queueCommand.execute(interaction);

      expect(mockAudioManager.getQueue).toHaveBeenCalledWith("guild-1");
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });
  });

  describe("NowPlaying Command", () => {
    const nowPlayingCommand = require("../../src/bot/commands/nowplaying");

    test("should display now playing info", async () => {
      mockPlayer.getState.mockReturnValue({
        isPlaying: true,
        currentTrack: { title: "Test Track", user: "User" },
        currentIndex: 0,
        queueLength: 1,
        loopMode: "none",
        hasPrevious: false,
        hasNext: false,
      });
      mockPlayer.getCurrentTime.mockReturnValue(30);

      await nowPlayingCommand.execute(interaction);

      expect(mockPlayer.getState).toHaveBeenCalled();
      expect(mockPlayer.getCurrentTime).toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    test("should show error if nothing playing", async () => {
      mockPlayer.getState.mockReturnValue({
        isPlaying: false,
        isPaused: false,
        currentTrack: null,
      });

      await nowPlayingCommand.execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({ title: "❌ Nothing Playing" }),
            }),
          ]),
          ephemeral: true,
        })
      );
    });
  });

  describe("Help Command", () => {
    const helpCommand = require("../../src/bot/commands/help");

    test("should display help info", async () => {
      await helpCommand.execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: "🎵 Bilibili音乐机器人 - 命令帮助",
              }),
            }),
          ]),
          ephemeral: true,
        })
      );
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

    beforeEach(() => {
      interaction.options = {
        getString: jest.fn().mockReturnValue("keyword"),
        getInteger: jest.fn().mockReturnValue(5),
      };
      interaction.deferReply = jest.fn().mockResolvedValue();
    });

    test("should search videos", async () => {
      const mockExtractor = {
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
      };
      mockAudioManager.getExtractor.mockReturnValue(mockExtractor);

      await searchCommand.execute(interaction);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(mockExtractor.searchVideos).toHaveBeenCalledWith("keyword", 5);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
        })
      );
    });

    test("should handle no results", async () => {
      const mockExtractor = {
        searchVideos: jest.fn().mockResolvedValue({
          success: true,
          results: [],
        }),
      };
      mockAudioManager.getExtractor.mockReturnValue(mockExtractor);

      await searchCommand.execute(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({ title: "❌ No Results Found" }),
            }),
          ]),
        })
      );
    });
  });
});
