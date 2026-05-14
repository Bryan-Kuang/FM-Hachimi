function loadTestingAccess(mockConfig = { test: {} }) {
  jest.resetModules();
  jest.doMock("discord.js", () => ({
    MessageFlags: { Ephemeral: 64 },
  }));
  jest.doMock("../../src/config/config", () => mockConfig);
  return require("../../src/bot/testing_access");
}

function makeInteraction({ guildId = "guild-1", replied = false, deferred = false } = {}) {
  return {
    guildId,
    guild: guildId ? { id: guildId } : null,
    replied,
    deferred,
    reply: jest.fn().mockResolvedValue({}),
    followUp: jest.fn().mockResolvedValue({}),
  };
}

describe("testing access gate", () => {
  afterEach(() => {
    jest.dontMock("discord.js");
    jest.dontMock("../../src/config/config");
  });

  test("allows the default testing server and blocks other guilds", () => {
    const access = loadTestingAccess();

    expect(access.TEST_GUILD_ID).toBe("1376318047794761838");
    expect(access.isTestGuild("1376318047794761838")).toBe(true);
    expect(access.isTestGuild("1203812841128329246")).toBe(false);
    expect(access.isTestGuild(null)).toBe(false);
  });

  test("uses TEST_GUILD_ID override from config", () => {
    const access = loadTestingAccess({ test: { guildId: "override-guild" } });

    expect(access.TEST_GUILD_ID).toBe("override-guild");
    expect(access.isTestGuild("override-guild")).toBe(true);
    expect(access.isTestGuild("1376318047794761838")).toBe(false);
  });

  test("detects testing commands and testing custom IDs", () => {
    const access = loadTestingAccess();

    expect(access.isTestingCommand({ stage: "testing" })).toBe(true);
    expect(access.isTestingCommand({ stage: "stable" })).toBe(false);
    expect(access.isTestingCommand({})).toBe(false);
    expect(access.isTestingCustomId("testing:queue:v2")).toBe(true);
    expect(access.isTestingCustomId("daily_play_BV1abc")).toBe(false);
  });

  test("denies with an ephemeral reply before an interaction is acknowledged", async () => {
    const access = loadTestingAccess();
    const interaction = makeInteraction({ guildId: "not-test" });

    const allowed = await access.assertTestingGuild(interaction, "Experimental queue");

    expect(allowed).toBe(false);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("Experimental queue"),
      flags: 64,
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test("denies DM interactions because they have no guild", async () => {
    const access = loadTestingAccess();
    const interaction = makeInteraction({ guildId: null });

    const allowed = await access.assertTestingGuild(interaction, "Experimental queue");

    expect(allowed).toBe(false);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("Experimental queue"),
      flags: 64,
    });
  });

  test("denies with an ephemeral follow-up after an interaction is acknowledged", async () => {
    const access = loadTestingAccess();
    const interaction = makeInteraction({ guildId: "not-test", deferred: true });

    await access.denyTestingFeature(interaction, "Experimental queue");

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: expect.stringContaining("Experimental queue"),
      flags: 64,
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test("assertTestingGuild allows the test guild without replying", async () => {
    const access = loadTestingAccess();
    const interaction = makeInteraction({ guildId: "1376318047794761838" });

    const allowed = await access.assertTestingGuild(interaction, "Experimental queue");

    expect(allowed).toBe(true);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});
