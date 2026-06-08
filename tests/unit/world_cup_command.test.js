/**
 * /worldcup command tests — permission gate, window gate, subscribe, and the
 * status health readout.
 */

jest.mock("discord.js", () => ({
  SlashCommandBuilder: function () {
    const self = {
      setName: () => self,
      setDescription: () => self,
      addSubcommand: () => self,
      toJSON: () => ({ name: "worldcup", description: "test" }),
    };
    return self;
  },
  PermissionFlagsBits: { ManageGuild: 32 },
  ChannelType: { GuildText: 0 },
  MessageFlags: { Ephemeral: 64 },
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setColor: jest.fn().mockReturnThis(),
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
  })),
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/world_cup/embeds", () => ({
  buildMatchListEmbed: jest.fn(() => ({ kind: "list" })),
  buildEventEmbed: jest.fn(),
  matchLine: jest.fn(),
}));

const createWorldCupCommand = require("../../src/bot/commands/world_cup");

function makeService(overrides = {}) {
  return {
    isActive: jest.fn().mockReturnValue(true),
    getWindow: jest.fn().mockReturnValue({ startDate: "2026-06-11", endDate: "2026-07-20", active: true }),
    getHealth: jest.fn().mockReturnValue({ healthy: true, active: true, lastOkAt: Date.now(), lastError: null, consecutiveFailures: 0 }),
    getSubscription: jest.fn().mockReturnValue(null),
    setSubscription: jest.fn(),
    removeSubscription: jest.fn(),
    getToday: jest.fn().mockResolvedValue([{ id: "m1" }]),
    getMatchesForDate: jest.fn().mockResolvedValue([{ id: "m1" }]),
    ...overrides,
  };
}

function makeInteraction(opts = {}) {
  const { sub = "today", date = null, memberHasPermission = true, channelPermitted = true } = opts;
  const mockChannel = {
    id: "ch1",
    toString: () => "<#ch1>",
    permissionsFor: jest.fn().mockReturnValue({ has: jest.fn().mockReturnValue(channelPermitted) }),
  };
  return {
    options: {
      getSubcommand: jest.fn().mockReturnValue(sub),
      getChannel: jest.fn().mockReturnValue(mockChannel),
      getString: jest.fn().mockReturnValue(date),
    },
    memberPermissions: { has: jest.fn().mockReturnValue(memberHasPermission) },
    guild: { id: "guild1", members: { me: { id: "bot" } } },
    user: { username: "tester" },
    deferReply: jest.fn().mockResolvedValue({}),
    editReply: jest.fn().mockResolvedValue({}),
    reply: jest.fn().mockResolvedValue({}),
  };
}

beforeEach(() => jest.clearAllMocks());

describe("permission gate", () => {
  test("subscribe without Manage Server is rejected before deferReply", async () => {
    const interaction = makeInteraction({ sub: "subscribe", memberHasPermission: false });
    await createWorldCupCommand(null, null, null, makeService()).execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
    expect(interaction.reply.mock.calls[0][0].content).toMatch(/Manage Server/);
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });
});

describe("window gate", () => {
  test("today replies 'not active' (with window range) when the tournament is inactive", async () => {
    const service = makeService({
      isActive: jest.fn().mockReturnValue(false),
      getWindow: jest.fn().mockReturnValue({ startDate: "2026-06-11", endDate: "2026-07-20", active: false }),
    });
    const interaction = makeInteraction({ sub: "today" });
    await createWorldCupCommand(null, null, null, service).execute(interaction);

    expect(service.getToday).not.toHaveBeenCalled();
    expect(interaction.editReply.mock.calls[0][0].content).toMatch(/isn't active/);
    expect(interaction.editReply.mock.calls[0][0].content).toMatch(/2026-06-11/);
  });

  test("today fetches and renders the match list when active", async () => {
    const service = makeService();
    const interaction = makeInteraction({ sub: "today" });
    await createWorldCupCommand(null, null, null, service).execute(interaction);

    expect(service.getToday).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: [{ kind: "list" }] }));
  });

  test("schedule rejects a malformed date", async () => {
    const service = makeService();
    const interaction = makeInteraction({ sub: "schedule", date: "06/15/2026" });
    await createWorldCupCommand(null, null, null, service).execute(interaction);

    expect(service.getMatchesForDate).not.toHaveBeenCalled();
    expect(interaction.editReply.mock.calls[0][0].content).toMatch(/YYYY-MM-DD/);
  });

  test("schedule converts YYYY-MM-DD to YYYYMMDD for the source", async () => {
    const service = makeService();
    const interaction = makeInteraction({ sub: "schedule", date: "2026-06-15" });
    await createWorldCupCommand(null, null, null, service).execute(interaction);

    expect(service.getMatchesForDate).toHaveBeenCalledWith("20260615");
  });
});

describe("subscribe / source failure", () => {
  test("subscribe persists the channel", async () => {
    const service = makeService();
    const interaction = makeInteraction({ sub: "subscribe" });
    await createWorldCupCommand(null, null, null, service).execute(interaction);

    expect(service.setSubscription).toHaveBeenCalledWith("guild1", "ch1");
  });

  test("today degrades gracefully when the source throws", async () => {
    const service = makeService({ getToday: jest.fn().mockRejectedValue(new Error("down")) });
    const interaction = makeInteraction({ sub: "today" });
    await createWorldCupCommand(null, null, null, service).execute(interaction);

    expect(interaction.editReply.mock.calls[0][0].content).toMatch(/try again/i);
  });
});

describe("status", () => {
  test("flags degraded auto-updates and points to the manual fallback", async () => {
    const service = makeService({
      getHealth: jest.fn().mockReturnValue({ healthy: false, active: true, lastOkAt: 0, lastError: "down", consecutiveFailures: 4 }),
      getSubscription: jest.fn().mockReturnValue({ channelId: "ch9" }),
    });
    const { EmbedBuilder } = require("discord.js");
    const interaction = makeInteraction({ sub: "status" });
    await createWorldCupCommand(null, null, null, service).execute(interaction);

    const embed = EmbedBuilder.mock.results[EmbedBuilder.mock.results.length - 1].value;
    const fields = embed.addFields.mock.calls.flat();
    const updater = fields.find((f) => f.name === "Live updater").value;
    expect(updater).toMatch(/degraded/i);
    expect(updater).toMatch(/worldcup today/);
  });
});
