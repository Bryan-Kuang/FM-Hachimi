jest.mock("discord.js", () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => {
    const builder = {};
    builder.setName = jest.fn().mockReturnThis();
    builder.setDescription = jest.fn().mockReturnThis();
    return builder;
  }),
  MessageFlags: { Ephemeral: 64 },
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const createSimpleCommand = require("../../src/bot/commands/simple_command");
const logger = require("../../src/services/logger_service");

describe("simple command factory envelope", () => {
  let interaction;
  let service;

  const makeCommand = (overrides = {}) =>
    createSimpleCommand({
      name: "pause",
      description: "desc",
      cooldown: 2,
      label: "Pause",
      action: (svc, guildId) => svc.pause(guildId),
      successMsg: "ok!",
      failMsg: "nope",
      ...overrides,
    })(service);

  beforeEach(() => {
    jest.clearAllMocks();
    service = {
      pause: jest.fn().mockReturnValue(true),
      setUIContext: jest.fn(),
    };
    interaction = {
      user: { username: "TestUser" },
      member: { voice: { channel: { id: "vc-1" } } },
      guild: { id: "guild-1", name: "Test Guild" },
      channelId: "channel-1",
      replied: false,
      deferred: false,
      reply: jest.fn().mockImplementation(() => {
        interaction.replied = true;
        return Promise.resolve();
      }),
      editReply: jest.fn().mockResolvedValue(undefined),
    };
  });

  test("requires a voice channel before doing anything", async () => {
    interaction.member.voice.channel = null;

    await makeCommand().execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Voice channel required" })
    );
    expect(service.pause).not.toHaveBeenCalled();
  });

  test("guard message short-circuits before the action runs", async () => {
    const command = makeCommand({ guard: () => "blocked!" });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "blocked!" })
    );
    expect(service.pause).not.toHaveBeenCalled();
  });

  test("action failure after reply edits with the default '<label> failed'", async () => {
    service.pause.mockImplementation(() => {
      throw new Error("boom");
    });

    await makeCommand().execute(interaction);

    expect(logger.error).toHaveBeenCalledWith(
      "Pause command failed",
      expect.objectContaining({ error: "boom" })
    );
    expect(interaction.editReply).toHaveBeenCalledWith({ content: "Pause failed" });
  });

  test("errorMsg overrides the default error reply", async () => {
    service.pause.mockImplementation(() => {
      throw new Error("boom");
    });

    await makeCommand({ errorMsg: "Previous failed" }).execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({ content: "Previous failed" });
  });

  test("failure before any reply falls back to an ephemeral reply", async () => {
    interaction.reply
      .mockImplementationOnce(() => Promise.reject(new Error("network")))
      .mockImplementationOnce(() => Promise.resolve());

    await makeCommand().execute(interaction);

    expect(interaction.reply).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "Pause failed", flags: 64 })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
