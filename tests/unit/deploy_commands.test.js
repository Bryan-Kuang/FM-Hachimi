function makeCommand(name, description) {
  return {
    data: {
      name,
      toJSON: () => ({ name, description }),
    },
  };
}

function loadDeployCommands({ testGuildId = "1376318047794761838" } = {}) {
  jest.resetModules();

  // scripts/deploy-commands.js registers ts-node so a plain `node` invocation can
  // require the TypeScript sources. Under jest that is redundant — ts-jest already
  // transforms .ts — so registering stands up a second TypeScript compiler inside
  // the worker on every resetModules(). Neutralise it: five real registrations per
  // run is the largest allocation source in the suite.
  jest.doMock("ts-node", () => ({ register: jest.fn() }));

  const stableCommand = makeCommand("play", "Play music");
  const testingCommand = makeCommand("experiment", "[Testing] Try experiment");

  jest.doMock("discord.js", () => ({
    REST: jest.fn().mockImplementation(() => ({
      setToken: jest.fn().mockReturnThis(),
      put: jest.fn().mockResolvedValue({}),
    })),
    Routes: {
      applicationCommands: jest.fn((clientId) => `global:${clientId}`),
      applicationGuildCommands: jest.fn((clientId, guildId) => `guild:${clientId}:${guildId}`),
    },
  }));

  jest.doMock("../../src/config/config", () => ({
    discord: {
      token: "token",
      clientId: "client-id",
      guildId: "legacy-guild",
    },
    test: {
      guildId: testGuildId,
    },
  }));

  jest.doMock("../../src/bot/commands", () => ({
    createCommands: jest.fn(() => [stableCommand, testingCommand]),
    getGlobalCommands: jest.fn(() => [stableCommand]),
    getGuildCommandsForTestServer: jest.fn(() => [testingCommand]),
  }));

  return require("../../scripts/deploy-commands");
}

describe("deploy command payload selection", () => {
  afterEach(() => {
    jest.dontMock("ts-node");
    jest.dontMock("discord.js");
    jest.dontMock("../../src/config/config");
    jest.dontMock("../../src/bot/commands");
  });

  test("default deploy targets global stable commands only", () => {
    const { createDeploymentPlan } = loadDeployCommands();

    const plan = createDeploymentPlan({});

    expect(plan.scope).toBe("global");
    expect(plan.guildId).toBeNull();
    expect(plan.commandData.map((command) => command.name)).toEqual(["play"]);
  });

  test("test deploy targets testing commands in the test guild only", () => {
    const { createDeploymentPlan } = loadDeployCommands();

    const plan = createDeploymentPlan({ DEPLOY_TEST_COMMANDS: "true" });

    expect(plan.scope).toBe("test_guild");
    expect(plan.guildId).toBe("1376318047794761838");
    expect(plan.commandData.map((command) => command.name)).toEqual(["experiment"]);
  });

  test("test deploy fails fast when TEST_GUILD_ID is not configured", () => {
    const { createDeploymentPlan } = loadDeployCommands({ testGuildId: "" });

    expect(() => createDeploymentPlan({ DEPLOY_TEST_COMMANDS: "true" })).toThrow(
      /TEST_GUILD_ID is required/
    );
  });

  test("clear mode for test deploy targets the test guild", () => {
    const { createDeploymentPlan } = loadDeployCommands();

    const plan = createDeploymentPlan({
      DEPLOY_TEST_COMMANDS: "true",
      CLEAR_GUILD_COMMANDS: "true",
    });

    expect(plan.clear).toBe(true);
    expect(plan.scope).toBe("test_guild");
    expect(plan.guildId).toBe("1376318047794761838");
    expect(plan.commandData).toEqual([]);
  });

  test("clear mode without test flag clears the configured guild and deploys nothing", () => {
    const { createDeploymentPlan } = loadDeployCommands();

    const plan = createDeploymentPlan({ CLEAR_GUILD_COMMANDS: "true" });

    expect(plan.scope).toBe("guild_clear");
    expect(plan.guildId).toBe("legacy-guild");
    expect(plan.clear).toBe(true);
    expect(plan.commandData).toEqual([]);
  });
});
