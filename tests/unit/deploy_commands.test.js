jest.mock('../../src/services/logger_service', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

function makeCommand(name, description) {
  return {
    data: {
      name,
      toJSON: () => ({ name, description }),
    },
  };
}

function loadDeployCommands() {
  jest.resetModules();

  // scripts/deploy-commands.js registers ts-node so a plain `node` invocation can
  // require the TypeScript sources. Under jest that is redundant — ts-jest already
  // transforms .ts — so registering stands up a second TypeScript compiler inside
  // the worker on every resetModules(). Neutralise it: five real registrations per
  // run is the largest allocation source in the suite.
  jest.doMock("ts-node", () => ({ register: jest.fn() }));

  const stableCommand = makeCommand("play", "Play music");

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
  }));

  jest.doMock("../../src/bot/commands", () => ({
    createCommands: jest.fn(() => [stableCommand]),
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

  test("default deploy targets global commands", () => {
    const { createDeploymentPlan } = loadDeployCommands();

    const plan = createDeploymentPlan({});

    expect(plan.scope).toBe("global");
    expect(plan.guildId).toBeNull();
    expect(plan.commandData.map((command) => command.name)).toEqual(["play"]);
  });

  test("clear mode clears the configured guild and deploys nothing", () => {
    const { createDeploymentPlan } = loadDeployCommands();

    const plan = createDeploymentPlan({ CLEAR_GUILD_COMMANDS: "true" });

    expect(plan.scope).toBe("guild_clear");
    expect(plan.guildId).toBe("legacy-guild");
    expect(plan.clear).toBe(true);
    expect(plan.commandData).toEqual([]);
  });

  test("explicit cleanup can target a former test guild without testing configuration", () => {
    const { createDeploymentPlan } = loadDeployCommands();
    const plan = createDeploymentPlan({ CLEAR_GUILD_COMMANDS: 'true', GUILD_ID: 'former-test-guild' });
    expect(plan).toMatchObject({ scope: 'guild_clear', guildId: 'former-test-guild', commandData: [] });
  });

  test.each([
    [false, 'global:client-id', [{ name: 'play', description: 'Play music' }]],
    [true, 'guild:client-id:former-test-guild', []],
  ])('sends the correct REST payload (guild cleanup: %s)', async (clear, route, body) => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, CLEAR_GUILD_COMMANDS: clear ? 'true' : '', GUILD_ID: 'former-test-guild' };
    const exit = jest.spyOn(process, 'exit').mockImplementation(code => { throw new Error(`Unexpected exit ${code}`); });
    try {
      const { deployCommands } = loadDeployCommands();
      const { REST } = require('discord.js');
      await deployCommands();
      const rest = REST.mock.results[0].value;
      expect(rest.put).toHaveBeenCalledTimes(1);
      expect(rest.put).toHaveBeenCalledWith(route, { body });
    } finally {
      exit.mockRestore();
      process.env = originalEnv;
    }
  });
});
