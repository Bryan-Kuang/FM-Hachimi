jest.mock("discord.js", () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => {
    const builder = {
      name: "",
      setName: jest.fn().mockImplementation((name) => {
        builder.name = name;
        return builder;
      }),
      setDescription: jest.fn().mockReturnThis(),
      addStringOption: jest.fn().mockImplementation((cb) => {
        cb({
          setName: jest.fn().mockReturnThis(),
          setDescription: jest.fn().mockReturnThis(),
          setRequired: jest.fn().mockReturnThis(),
          addChoices: jest.fn().mockReturnThis(),
        });
        return builder;
      }),
      addIntegerOption: jest.fn().mockImplementation((cb) => {
        cb({
          setName: jest.fn().mockReturnThis(),
          setDescription: jest.fn().mockReturnThis(),
          setRequired: jest.fn().mockReturnThis(),
          setMinValue: jest.fn().mockReturnThis(),
          setMaxValue: jest.fn().mockReturnThis(),
          addChoices: jest.fn().mockReturnThis(),
        });
        return builder;
      }),
      addSubcommand: jest.fn().mockImplementation((cb) => {
        cb({
          setName: jest.fn().mockReturnThis(),
          setDescription: jest.fn().mockReturnThis(),
          addStringOption: jest.fn().mockReturnThis(),
          addIntegerOption: jest.fn().mockReturnThis(),
          addChannelOption: jest.fn().mockReturnThis(),
        });
        return builder;
      }),
      toJSON: jest.fn().mockImplementation(() => ({ name: builder.name })),
    };
    return builder;
  }),
  ChannelType: { GuildText: 0 },
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe("command registry", () => {
  test("creates the complete slash command list from one registry", () => {
    const registry = require("../../src/bot/commands");

    const commands = registry.createCommands(null, null);
    const names = commands.map((command) => command.data.name);

    expect(names).toEqual([
      "play",
      "pause",
      "resume",
      "skip",
      "prev",
      "stop",
      "queue",
      "nowplaying",
      "help",
      "search",
      "hachimi",
      "daily-hachimi",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  test("deploy-commands imports the shared command registry instead of duplicating command paths", () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(path.resolve(__dirname, "../../scripts/deploy-commands.js"), "utf8");

    expect(source).toContain("../src/bot/commands");
    expect(source).not.toContain("../src/bot/commands/play");
    expect(source).not.toContain("../src/bot/commands/daily_hachimi");
  });

  test("filters stable and testing command lists without changing stable names", () => {
    const registry = require("../../src/bot/commands");
    const stableCommand = {
      stage: "stable",
      data: { name: "stable", toJSON: () => ({ name: "stable", description: "Stable command" }) },
      execute: jest.fn(),
    };
    const testingCommand = {
      stage: "testing",
      featureName: "Experiment",
      data: { name: "experiment", toJSON: () => ({ name: "experiment", description: "Try experiment" }) },
      execute: jest.fn(),
    };

    expect(registry.getStableCommandsFrom([stableCommand, testingCommand]).map((command) => command.data.name))
      .toEqual(["stable"]);
    expect(registry.getTestingCommandsFrom([stableCommand, testingCommand]).map((command) => command.data.name))
      .toEqual(["experiment"]);

    const names = registry.createCommands(null, null).map((command) => command.data.name);
    expect(names).toEqual([
      "play",
      "pause",
      "resume",
      "skip",
      "prev",
      "stop",
      "queue",
      "nowplaying",
      "help",
      "search",
      "hachimi",
      "daily-hachimi",
    ]);
    expect(registry.getGlobalCommands(null, null).map((command) => command.data.name)).toEqual(names);
    expect(registry.getTestingCommands(null, null)).toEqual([]);
  });

  test("prefixes testing command descriptions and keeps them within Discord limits", () => {
    const registry = require("../../src/bot/commands");
    const testingCommand = {
      stage: "testing",
      featureName: "Long experiment",
      data: {
        name: "experiment",
        toJSON: () => ({
          name: "experiment",
          description: "x".repeat(120),
        }),
      },
      execute: jest.fn(),
    };

    const [command] = registry.getTestingCommandsFrom([testingCommand]);
    const json = command.data.toJSON();

    expect(json.name).toBe("experiment");
    expect(json.description.startsWith("[Testing] ")).toBe(true);
    expect(json.description.length).toBeLessThanOrEqual(100);
  });
});
