/**
 * Unit tests for the /annoying command — toggle flow and the disarm gate
 * (anyone may arm the mode; only the exempt user may disarm it, otherwise
 * /annoying followed by /stop would defeat the protection).
 */

jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => {
    const builder = {};
    builder.setName = jest.fn().mockImplementation((name) => {
      builder.name = name;
      return builder;
    });
    builder.setDescription = jest.fn().mockReturnThis();
    return builder;
  }),
  MessageFlags: { Ephemeral: 64 },
}));

jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/ui/embeds', () => ({
  createErrorEmbed: jest.fn((title, description) => ({ title, description })),
  createSuccessEmbed: jest.fn((title, description) => ({ title, description })),
}));

const createAnnoyingCommand = require('../../src/bot/commands/annoying');

function makeInteraction() {
  return {
    user: { id: 'user-1', username: 'TestUser' },
    guild: { id: 'guild-1', name: 'Test Guild' },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

function makeAnnoyingService({ enabled = false, protectedFrom = false } = {}) {
  return {
    isEnabled: jest.fn().mockReturnValue(enabled),
    isProtectedFrom: jest.fn().mockReturnValue(protectedFrom),
    toggle: jest.fn().mockReturnValue(!enabled),
  };
}

describe('/annoying command', () => {
  beforeEach(() => jest.clearAllMocks());

  test('replies with an error when the service is unavailable', async () => {
    const command = createAnnoyingCommand({ getAnnoyingService: () => null });
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 }),
    );
  });

  test('anyone can arm the mode', async () => {
    const annoying = makeAnnoyingService({ enabled: false, protectedFrom: false });
    const command = createAnnoyingCommand({ getAnnoyingService: () => annoying });
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(annoying.toggle).toHaveBeenCalledWith('guild-1');
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: expect.stringContaining('开启') })],
      }),
    );
  });

  test('a protected (non-exempt) user cannot disarm the mode', async () => {
    const annoying = makeAnnoyingService({ enabled: true, protectedFrom: true });
    const command = createAnnoyingCommand({ getAnnoyingService: () => annoying });
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(annoying.toggle).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: expect.stringContaining('关不掉') })],
        flags: 64,
      }),
    );
  });

  test('the exempt user can disarm the mode', async () => {
    const annoying = makeAnnoyingService({ enabled: true, protectedFrom: false });
    const command = createAnnoyingCommand({ getAnnoyingService: () => annoying });
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(annoying.toggle).toHaveBeenCalledWith('guild-1');
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: expect.stringContaining('关闭') })],
      }),
    );
  });
});
