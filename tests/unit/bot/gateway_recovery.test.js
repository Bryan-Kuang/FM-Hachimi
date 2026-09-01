// Regression cover for the 2026-09-01 gateway zombie: a shard that keeps
// failing its handshake must (a) stop reporting the bot as ready and (b) end
// with a process restart instead of retrying forever in silence.

let mockHandlers;
let mockOnceHandlers;

jest.mock("discord.js", () => {
  class Collection extends Map {}

  return {
    Client: jest.fn().mockImplementation(() => ({
      on: jest.fn((event, handler) => {
        mockHandlers[event] = handler;
      }),
      once: jest.fn((event, handler) => {
        mockOnceHandlers[event] = handler;
      }),
      login: jest.fn().mockResolvedValue("logged in"),
      destroy: jest.fn(),
      user: {
        id: "bot-id",
        username: "Bot",
        setActivity: jest.fn(),
      },
      guilds: { cache: { size: 3 } },
      users: { cache: { size: 6 } },
      channels: { cache: new Map() },
    })),
    GatewayIntentBits: { Guilds: 1, GuildVoiceStates: 256, GuildMessages: 512, MessageContent: 32768 },
    ActivityType: { Custom: 4 },
    MessageFlags: { Ephemeral: 64 },
    Collection,
    AuditLogEvent: { MemberDisconnect: 27 },
  };
});

jest.mock("../../../src/bot/events/interactionCreate", () =>
  jest.fn(() => ({ execute: jest.fn().mockResolvedValue({}) }))
);

jest.mock("../../../src/services/logger_service", () => ({
  info:  jest.fn(),
  error: jest.fn(),
  warn:  jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../../src/config/config", () => ({
  test: { guildId: "1376318047794761838" },
  gateway: { stuckTimeoutMs: 120000, checkIntervalMs: 15000, logIntervalMs: 15000 },
}));

const BotClient = require("../../../src/bot/client");

function makeReadyBot() {
  mockHandlers = {};
  mockOnceHandlers = {};
  const bot = new BotClient({ getPlayer: jest.fn() });
  bot.setupEventHandlers();
  mockOnceHandlers.clientReady();
  return bot;
}

describe("gateway outage handling", () => {
  let exitSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    exitSpy.mockRestore();
  });

  test("a healthy bot reports ready with a connected gateway", () => {
    const bot = makeReadyBot();

    const stats = bot.getStats();
    expect(stats.ready).toBe(true);
    expect(stats.gateway).toEqual({ connected: true, outageMs: 0 });
  });

  test("shard errors flip readiness to false", () => {
    const bot = makeReadyBot();

    mockHandlers.shardError(new Error("Unexpected server response: 503"), 0);

    const stats = bot.getStats();
    expect(stats.ready).toBe(false);
    expect(stats.gateway.connected).toBe(false);
  });

  test("a shard that resumes restores readiness", () => {
    const bot = makeReadyBot();

    mockHandlers.shardError(new Error("Unexpected server response: 503"), 0);
    mockHandlers.shardResume(0);

    expect(bot.getStats().ready).toBe(true);
  });

  test("a shard disconnect counts as an outage", () => {
    const bot = makeReadyBot();

    mockHandlers.shardDisconnect({ code: 1006 }, 0);

    expect(bot.getStats().ready).toBe(false);
  });

  test("does not restart while the outage is short", () => {
    const bot = makeReadyBot();
    bot.startGatewayWatchdog();

    mockHandlers.shardError(new Error("503"), 0);
    jest.advanceTimersByTime(60000);

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("restarts the process once the outage outlives the timeout", () => {
    const bot = makeReadyBot();
    bot.startGatewayWatchdog();

    mockHandlers.shardError(new Error("Unexpected server response: 503"), 0);
    // discord.js keeps hammering every 500ms and getting nowhere.
    for (let elapsed = 0; elapsed < 150000; elapsed += 500) {
      jest.advanceTimersByTime(500);
      mockHandlers.shardError(new Error("Unexpected server response: 503"), 0);
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("a recovery inside the window prevents the restart", () => {
    const bot = makeReadyBot();
    bot.startGatewayWatchdog();

    mockHandlers.shardError(new Error("503"), 0);
    jest.advanceTimersByTime(90000);
    mockHandlers.shardReady(0);
    jest.advanceTimersByTime(90000);

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("throttles the failure log instead of one line per retry", () => {
    const logger = require("../../../src/services/logger_service");
    const bot = makeReadyBot();
    bot.startGatewayWatchdog();

    for (let i = 0; i < 100; i++) {
      mockHandlers.shardError(new Error("503"), 0);
      jest.advanceTimersByTime(500);
    }

    expect(logger.warn.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
