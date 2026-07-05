/**
 * Daily recommendation "立刻聆听" button while radio mode is active:
 * the video is interjected into the radio rotation (radio.playNow) instead
 * of the normal queue, which the rotation would discard on the next advance.
 */

jest.mock("discord.js", () => ({
  MessageFlags: { Ephemeral: 64 },
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
  })),
  StringSelectMenuBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setPlaceholder: jest.fn().mockReturnThis(),
    addOptions: jest.fn().mockReturnThis(),
  })),
}));

jest.mock("../../src/services/logger_service", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../src/ui/embeds", () => ({
  createErrorEmbed: jest.fn((title, description) => ({ title, description })),
  createSuccessEmbed: jest.fn((title, description) => ({ title, description })),
  createQueueEmbed: jest.fn((queue) => ({ title: "Queue", queue })),
}));

jest.mock("../../src/ui/buttons", () => ({
  createQueueControls: jest.fn().mockReturnValue([]),
  createQueueRemoveMenu: jest.fn().mockReturnValue({}),
}));

jest.mock("../../src/utils/lock", () => ({
  shouldDebounce: jest.fn().mockReturnValue(false),
  acquire: jest.fn().mockReturnValue(true),
  release: jest.fn(),
}));

jest.mock("../../src/playback/stage_feedback", () => ({
  createInteractionStageReporter: jest.fn(() => {
    const reporter = jest.fn();
    reporter.finish = jest.fn().mockResolvedValue(undefined);
    return reporter;
  }),
  emitPlaybackStage: jest.fn(),
}));

const createButtonHandler = require("../../src/bot/events/handlers/button_handler");

function makeInteraction(customId = "daily_play_BVdaily1", voiceChannelId = "voice-1") {
  return {
    customId,
    user: { id: "user-1", username: "TestUser" },
    guild: { id: "guild-1", name: "Test Guild" },
    channelId: "channel-1",
    member: { voice: { channel: { id: voiceChannelId } } },
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: true,
  };
}

function makeWorld({ radioEnabled = true, botChannelId = "voice-1" } = {}) {
  const radio = {
    isEnabled: jest.fn().mockReturnValue(radioEnabled),
    isOnBreak: jest.fn().mockReturnValue(false),
    playNow: jest.fn().mockResolvedValue({ success: true }),
  };
  const player = {
    radioMode: radioEnabled,
    isPlaying: true,
    isPaused: false,
    voiceConnection: botChannelId ? { joinConfig: { channelId: botChannelId } } : null,
  };
  const playerService = {
    getPlayer: jest.fn().mockReturnValue(player),
    getRadioService: jest.fn().mockReturnValue(radio),
    setUIContext: jest.fn(),
    playBilibiliVideo: jest.fn().mockResolvedValue({ success: true }),
    notifyState: jest.fn(),
    handleButtonInteraction: jest.fn().mockResolvedValue({ success: true }),
  };
  return { radio, player, playerService, handler: createButtonHandler(playerService) };
}

describe("daily play button during radio mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("routes the video through radio.playNow instead of the normal queue", async () => {
    const w = makeWorld();
    const interaction = makeInteraction();

    await w.handler(interaction);

    expect(w.radio.playNow).toHaveBeenCalledWith(
      "guild-1",
      "https://www.bilibili.com/video/BVdaily1",
      "<@user-1>",
    );
    expect(w.playerService.playBilibiliVideo).not.toHaveBeenCalled();
    expect(w.playerService.setUIContext).toHaveBeenCalledWith("guild-1", "channel-1");
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: expect.stringMatching(/插播.*回到电台/),
    });
  });

  test("uses the normal queue path when radio mode is off", async () => {
    const w = makeWorld({ radioEnabled: false });
    const interaction = makeInteraction();

    await w.handler(interaction);

    expect(w.radio.playNow).not.toHaveBeenCalled();
    expect(w.playerService.playBilibiliVideo).toHaveBeenCalledWith(
      interaction,
      "https://www.bilibili.com/video/BVdaily1",
      expect.any(Object),
    );
  });

  test("rejects the request when the user is in a different voice channel than the radio", async () => {
    const w = makeWorld({ botChannelId: "voice-other" });
    const interaction = makeInteraction();

    await w.handler(interaction);

    expect(w.radio.playNow).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringMatching(/电台所在的语音频道/),
    });
  });

  test("surfaces a playNow failure to the user", async () => {
    const w = makeWorld();
    w.radio.playNow.mockResolvedValue({ success: false, error: "解析失败" });
    const interaction = makeInteraction();

    await w.handler(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: expect.stringContaining("解析失败"),
    });
  });
});
