/**
 * daily_play_<bvid> 按钮路由单元测试
 * 覆盖 interactionCreate.js 中 daily_play_ 前缀按钮的处理路径。
 */

// ─── mocks ───────────────────────────────────────────────────────────────────

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
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/ui/embeds", () => ({
  createErrorEmbed: jest.fn().mockReturnValue({ title: "Error" }),
  createSuccessEmbed: jest.fn().mockReturnValue({ title: "Success" }),
  createQueueEmbed: jest.fn().mockReturnValue({ title: "Queue" }),
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

const createInteractionHandler = require("../../src/bot/events/interactionCreate");

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Minimal mock playbackService (only daily_play_ path is exercised). */
function makePlayback(overrides = {}) {
  return {
    playBilibiliVideo: jest.fn().mockResolvedValue({ success: true }),
    handleButtonInteraction: jest.fn().mockResolvedValue({ success: true }),
    getPlayer: jest.fn().mockReturnValue({ isPlaying: false, isPaused: false }),
    setUIContext: jest.fn(),
    notifyState: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    skip: jest.fn().mockResolvedValue({}),
    previous: jest.fn().mockResolvedValue({}),
    stop: jest.fn().mockResolvedValue({}),
    getExtractor: jest.fn().mockReturnValue(null),
    ...overrides,
  };
}

/** Minimal mock interaction for a daily_play_ button press. */
function makeDailyPlayInteraction({ bvid = "BV1abc", inVoice = true } = {}) {
  return {
    customId: `daily_play_${bvid}`,
    isButton: jest.fn().mockReturnValue(true),
    isStringSelectMenu: jest.fn().mockReturnValue(false),
    user: { username: "testuser" },
    guild: { id: "guild1", name: "TestGuild" },
    channelId: "ch1",
    member: {
      voice: { channel: inVoice ? { id: "vc1" } : null },
    },
    deferReply: jest.fn().mockResolvedValue({}),
    editReply: jest.fn().mockResolvedValue({}),
    followUp: jest.fn().mockResolvedValue({}),
    replied: false,
    deferred: true,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("daily_play_ button handler", () => {
  let playback;
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    playback = makePlayback();
    handler = createInteractionHandler(playback, {});
  });

  test("defers with ephemeral flag (not a control button)", async () => {
    const interaction = makeDailyPlayInteraction({ bvid: "BV1abc", inVoice: true });
    await handler.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
  });

  test("editReplies with voice-channel error when user is not in voice", async () => {
    const interaction = makeDailyPlayInteraction({ bvid: "BV1abc", inVoice: false });
    await handler.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/语音频道/) })
    );
    expect(playback.playBilibiliVideo).not.toHaveBeenCalled();
  });

  test("editReplies with invalid-ID error when bvid is missing", async () => {
    // customId = "daily_play_" → bvid slice = ""
    const interaction = {
      ...makeDailyPlayInteraction({ bvid: "BV1abc", inVoice: true }),
      customId: "daily_play_",
    };
    await handler.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/无效的视频 ID/) })
    );
    expect(playback.playBilibiliVideo).not.toHaveBeenCalled();
  });

  test("calls setUIContext before playBilibiliVideo so Now Playing embed has a channel", async () => {
    const interaction = makeDailyPlayInteraction({ bvid: "BV1abc", inVoice: true });
    await handler.execute(interaction);

    expect(playback.setUIContext).toHaveBeenCalledWith("guild1", "ch1");
    // setUIContext must be called before playBilibiliVideo
    const setOrder = playback.setUIContext.mock.invocationCallOrder[0];
    const playOrder = playback.playBilibiliVideo.mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(playOrder);
  });

  test("calls playBilibiliVideo with a correctly formed bilibili URL", async () => {
    const interaction = makeDailyPlayInteraction({ bvid: "BV1abc", inVoice: true });
    await handler.execute(interaction);

    expect(playback.playBilibiliVideo).toHaveBeenCalledWith(
      interaction,
      "https://www.bilibili.com/video/BV1abc",
      expect.objectContaining({ onStage: expect.any(Function) }),
    );
  });

  test("calls notifyState after successful playback to trigger Now Playing UI", async () => {
    const interaction = makeDailyPlayInteraction({ bvid: "BV1abc", inVoice: true });
    playback.playBilibiliVideo.mockResolvedValue({ success: true });

    await handler.execute(interaction);

    expect(playback.notifyState).toHaveBeenCalledWith("guild1");
  });

  test("does NOT call notifyState when playback fails", async () => {
    const interaction = makeDailyPlayInteraction({ bvid: "BV1abc", inVoice: true });
    playback.playBilibiliVideo.mockResolvedValue({ success: false, error: "Network error" });

    await handler.execute(interaction);

    expect(playback.notifyState).not.toHaveBeenCalled();
  });

  test("editReplies with success message when playback succeeds", async () => {
    const interaction = makeDailyPlayInteraction({ bvid: "BV1abc", inVoice: true });
    playback.playBilibiliVideo.mockResolvedValue({ success: true });

    await handler.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/已加入队列/) })
    );
  });

  test("editReplies with error message when playback returns failure", async () => {
    const interaction = makeDailyPlayInteraction({ bvid: "BV1abc", inVoice: true });
    playback.playBilibiliVideo.mockResolvedValue({
      success: false,
      error: "Network error",
    });

    await handler.execute(interaction);

    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.content).toMatch(/无法播放视频/);
    expect(reply.content).toContain("Network error");
  });

  test("editReplies with fallback error when result is null", async () => {
    const interaction = makeDailyPlayInteraction({ bvid: "BV1abc", inVoice: true });
    playback.playBilibiliVideo.mockResolvedValue(null);

    await handler.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/无法播放视频/) })
    );
  });

  test("bvid is correctly extracted from longer BVID strings", async () => {
    const interaction = makeDailyPlayInteraction({
      bvid: "BV1tt4y1C7Lm",
      inVoice: true,
    });
    await handler.execute(interaction);

    expect(playback.playBilibiliVideo).toHaveBeenCalledWith(
      interaction,
      "https://www.bilibili.com/video/BV1tt4y1C7Lm",
      expect.objectContaining({ onStage: expect.any(Function) }),
    );
  });
});
