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

const createButtonHandler = require("../../src/bot/events/handlers/button_handler");
const createSelectMenuHandler = require("../../src/bot/events/handlers/select_menu_handler");
const PlayerService = require("../../src/services/player_service");
const Lock = require("../../src/utils/lock");

function makeButtonInteraction(customId) {
  return {
    customId,
    user: { username: "TestUser" },
    guild: { id: "guild-1", name: "Test Guild" },
    channelId: "channel-1",
    member: { voice: { channel: { id: "voice-1" } } },
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: true,
  };
}

function makeSelectInteraction(customId, value = "queue") {
  return {
    customId,
    values: [value],
    user: { username: "TestUser" },
    guild: { id: "guild-1", name: "Test Guild" },
    channelId: "channel-1",
    member: { voice: { channel: { id: "voice-1" } } },
    message: { edit: jest.fn().mockResolvedValue(undefined) },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  };
}

function makePlayerService({ radioMode = true } = {}) {
  return {
    getPlayer: jest.fn().mockReturnValue({
      radioMode,
      isPlaying: true,
      isPaused: false,
    }),
    setUIContext: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    skip: jest.fn().mockResolvedValue(true),
    previous: jest.fn().mockResolvedValue(true),
    stop: jest.fn().mockResolvedValue(true),
    handleButtonInteraction: jest.fn().mockResolvedValue({ success: true }),
    setLoopMode: jest.fn().mockReturnValue({ success: true }),
    clearQueue: jest.fn().mockReturnValue(true),
    removeTrack: jest.fn().mockReturnValue(true),
    getQueue: jest.fn().mockReturnValue({
      queue: [],
      currentTrack: null,
      state: { queueLength: 0, currentIndex: 0 },
    }),
    notifyState: jest.fn(),
  };
}

function makeRealPlayerServiceForGuard({ radioMode = true } = {}) {
  const audioManager = {
    getPlayer: jest.fn().mockReturnValue({
      radioMode,
      isPlaying: true,
      isPaused: false,
    }),
    handleButtonInteraction: jest.fn().mockResolvedValue({ success: true }),
  };

  const service = new PlayerService({
    audioManager,
    interfaceUpdater: {},
    progressTracker: null,
    extractor: {},
  });

  return { service, audioManager };
}

describe("radio interaction guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("blocks stale pause/resume buttons while radio mode is active", async () => {
    const playerService = makePlayerService({ radioMode: true });
    const handler = createButtonHandler(playerService);
    const interaction = makeButtonInteraction("pause_resume");

    await handler(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: expect.stringMatching(/Only Stop.*radio mode/i),
      flags: 64,
    });
    expect(playerService.pause).not.toHaveBeenCalled();
    expect(playerService.resume).not.toHaveBeenCalled();
    expect(playerService.setUIContext).not.toHaveBeenCalled();
  });

  test("blocks stale loop button while radio mode is active", async () => {
    const playerService = makePlayerService({ radioMode: true });
    const handler = createButtonHandler(playerService);
    const interaction = makeButtonInteraction("loop");

    await handler(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringMatching(/Only Stop.*radio mode/i),
    });
    expect(playerService.handleButtonInteraction).not.toHaveBeenCalled();
  });

  test("allows stop while radio mode is active", async () => {
    const playerService = makePlayerService({ radioMode: true });
    const handler = createButtonHandler(playerService);
    const interaction = makeButtonInteraction("stop");

    await handler(interaction);

    expect(playerService.setUIContext).toHaveBeenCalledWith("guild-1", "channel-1");
    expect(playerService.stop).toHaveBeenCalledWith("guild-1");
  });

  test("blocks stale loop select menus while radio mode is active", async () => {
    const playerService = makePlayerService({ radioMode: true });
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeSelectInteraction("loop_select", "queue");

    await handler(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringMatching(/Only Stop.*radio mode/i),
      flags: 64,
    });
    expect(playerService.setLoopMode).not.toHaveBeenCalled();
    expect(Lock.acquire).not.toHaveBeenCalled();
  });

  test("blocks stale queue remove menus while radio mode is active", async () => {
    const playerService = makePlayerService({ radioMode: true });
    const handler = createSelectMenuHandler(playerService);
    const interaction = makeSelectInteraction("queue_remove_select", "remove_0");

    await handler(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringMatching(/Only Stop.*radio mode/i),
      flags: 64,
    });
    expect(playerService.removeTrack).not.toHaveBeenCalled();
    expect(Lock.acquire).not.toHaveBeenCalled();
  });

  test("player service refuses radio option buttons before delegating to audio manager", async () => {
    const { service, audioManager } = makeRealPlayerServiceForGuard({ radioMode: true });

    const result = await service.handleButtonInteraction({
      customId: "queue",
      guild: { id: "guild-1" },
      channelId: "channel-1",
    });

    expect(result).toEqual({
      success: false,
      error: expect.stringMatching(/Only Stop.*radio mode/i),
      suggestion: expect.any(String),
    });
    expect(audioManager.handleButtonInteraction).not.toHaveBeenCalled();
  });
});
