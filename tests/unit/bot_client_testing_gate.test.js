let mockHandlers;

jest.mock("discord.js", () => {
  class Collection extends Map {}

  return {
    Client: jest.fn().mockImplementation(() => ({
      on: jest.fn((event, handler) => {
        mockHandlers[event] = handler;
      }),
      once: jest.fn(),
      login: jest.fn().mockResolvedValue("logged in"),
      destroy: jest.fn(),
      user: {
        id: "bot-id",
        username: "Bot",
        setActivity: jest.fn(),
      },
      guilds: { cache: { size: 0 } },
      users: { cache: { size: 0 } },
      channels: { cache: new Map() },
    })),
    GatewayIntentBits: {
      Guilds: 1,
      GuildVoiceStates: 256,
      GuildMessages: 512,
      MessageContent: 32768,
    },
    ActivityType: { Custom: 4 },
    MessageFlags: { Ephemeral: 64 },
    Collection,
    AuditLogEvent: { MemberDisconnect: 27 },
  };
});

jest.mock("../../src/bot/events/interactionCreate", () =>
  jest.fn(() => ({ execute: jest.fn().mockResolvedValue({}) }))
);

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/config/config", () => ({
  test: { guildId: "1376318047794761838" },
  gateway: { stuckTimeoutMs: 120000, checkIntervalMs: 15000, logIntervalMs: 15000 },
}));

const BotClient = require("../../src/bot/client");

function makeBotWithCommand(command) {
  mockHandlers = {};
  const bot = new BotClient({ getPlayer: jest.fn() });
  bot.setupEventHandlers();
  bot.client.commands.set(command.data.name, command);
  return { bot, interactionHandler: mockHandlers.interactionCreate };
}

function makeCommand({ name = "experiment", stage = "stable" } = {}) {
  return {
    stage,
    featureName: "Experimental command",
    data: { name },
    execute: jest.fn().mockResolvedValue({}),
    cooldown: 0,
  };
}

function makeSlashInteraction({ guildId = "guild-1", commandName = "experiment" } = {}) {
  return {
    commandName,
    isButton: jest.fn().mockReturnValue(false),
    isStringSelectMenu: jest.fn().mockReturnValue(false),
    isChatInputCommand: jest.fn().mockReturnValue(true),
    guildId,
    guild: guildId ? { id: guildId, name: "Guild" } : null,
    user: { id: "user-1", username: "Tester" },
    reply: jest.fn().mockResolvedValue({}),
    followUp: jest.fn().mockResolvedValue({}),
    replied: false,
    deferred: false,
  };
}

describe("BotClient testing command gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("executes testing commands inside the test guild", async () => {
    const command = makeCommand({ stage: "testing" });
    const { interactionHandler } = makeBotWithCommand(command);
    const interaction = makeSlashInteraction({ guildId: "1376318047794761838" });

    await interactionHandler(interaction);

    expect(command.execute).toHaveBeenCalledWith(interaction);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test("blocks testing commands outside the test guild before command execution", async () => {
    const command = makeCommand({ stage: "testing" });
    const { bot, interactionHandler } = makeBotWithCommand(command);
    const interaction = makeSlashInteraction({ guildId: "not-test" });

    await interactionHandler(interaction);

    expect(command.execute).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("Experimental command"),
      flags: 64,
    });
    expect(bot.client.cooldowns.has("experiment")).toBe(false);
  });

  test("stable commands still execute outside the test guild", async () => {
    const command = makeCommand({ stage: "stable" });
    const { interactionHandler } = makeBotWithCommand(command);
    const interaction = makeSlashInteraction({ guildId: "not-test" });

    await interactionHandler(interaction);

    expect(command.execute).toHaveBeenCalledWith(interaction);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
