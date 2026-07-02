/**
 * When the bot is disconnected from voice via vanilla Discord (right-click →
 * Disconnect, kicked, channel deleted…), radio mode must be flagged off so the
 * next /radio starts fresh instead of toggling a stale "enabled" state off.
 */

let mockHandlers;

jest.mock('discord.js', () => {
  class Collection extends Map {}

  return {
    Client: jest.fn().mockImplementation(() => ({
      on: jest.fn((event, handler) => {
        mockHandlers[event] = handler;
      }),
      once: jest.fn(),
      login: jest.fn().mockResolvedValue('logged in'),
      destroy: jest.fn(),
      user: {
        id: 'bot-id',
        username: 'Bot',
        setActivity: jest.fn(),
      },
      guilds: { cache: { size: 0 } },
      users: { cache: { size: 0 } },
      channels: { cache: new Map(), fetch: jest.fn().mockResolvedValue(null) },
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

jest.mock('../../src/bot/events/interactionCreate', () =>
  jest.fn(() => ({ execute: jest.fn().mockResolvedValue({}) }))
);

jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/config/config', () => ({
  test: { guildId: 'test-guild' },
}));

jest.mock('../../src/utils/debug', () => ({
  trace: jest.fn(),
  error: jest.fn(),
}));

const BotClient = require('../../src/bot/client');

function makeBot({ player, radioService } = {}) {
  mockHandlers = {};
  const playerService = {
    getPlayer: jest.fn().mockReturnValue(player ?? null),
    getRadioService: jest.fn().mockReturnValue(radioService ?? null),
    getUIContext: jest.fn().mockReturnValue(null),
    clearUIContext: jest.fn(),
  };
  const bot = new BotClient(playerService);
  bot.setupEventHandlers();
  return { bot, playerService, voiceStateUpdate: mockHandlers.voiceStateUpdate };
}

function makeBotDisconnectStates(guildId = 'guild-1') {
  const guild = { id: guildId, name: 'Guild' };
  return {
    oldState: {
      member: { id: 'bot-id' },
      channel: { id: 'vc-1', name: 'General' },
      channelId: 'vc-1',
      guild,
    },
    newState: {
      id: 'bot-id',
      member: { id: 'bot-id' },
      channel: null,
      channelId: null,
      guild,
    },
  };
}

describe('BotClient voice disconnect radio handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('stops radio mode when the bot is disconnected from voice', async () => {
    const calls = [];
    const player = {
      currentTrack: null,
      leaveVoiceChannel: jest.fn(() => calls.push('leaveVoiceChannel')),
    };
    const radioService = {
      stop: jest.fn(() => {
        calls.push('radio.stop');
        return Promise.resolve();
      }),
    };
    const { voiceStateUpdate } = makeBot({ player, radioService });
    const { oldState, newState } = makeBotDisconnectStates();

    voiceStateUpdate(oldState, newState);

    expect(radioService.stop).toHaveBeenCalledWith('guild-1');
    expect(player.leaveVoiceChannel).toHaveBeenCalled();
    // Radio is flagged off before the player teardown so nothing can re-arm it.
    expect(calls).toEqual(['radio.stop', 'leaveVoiceChannel']);
  });

  test('survives a radio service stop failure and still tears down the player', async () => {
    const player = {
      currentTrack: null,
      leaveVoiceChannel: jest.fn(),
    };
    const radioService = {
      stop: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const { voiceStateUpdate } = makeBot({ player, radioService });
    const { oldState, newState } = makeBotDisconnectStates();

    voiceStateUpdate(oldState, newState);
    await Promise.resolve();

    expect(player.leaveVoiceChannel).toHaveBeenCalled();
  });

  test('handles a missing radio service gracefully', () => {
    const player = {
      currentTrack: null,
      leaveVoiceChannel: jest.fn(),
    };
    const { voiceStateUpdate } = makeBot({ player, radioService: null });
    const { oldState, newState } = makeBotDisconnectStates();

    expect(() => voiceStateUpdate(oldState, newState)).not.toThrow();
    expect(player.leaveVoiceChannel).toHaveBeenCalled();
  });

  test('ignores voice state updates for other users', () => {
    const player = {
      currentTrack: null,
      leaveVoiceChannel: jest.fn(),
    };
    const radioService = { stop: jest.fn() };
    const { voiceStateUpdate } = makeBot({ player, radioService });

    const guild = { id: 'guild-1', name: 'Guild' };
    voiceStateUpdate(
      { member: { id: 'someone-else' }, channel: { id: 'vc-1', name: 'General' }, channelId: 'vc-1', guild },
      { id: 'someone-else', member: { id: 'someone-else' }, channel: null, channelId: null, guild },
    );

    expect(radioService.stop).not.toHaveBeenCalled();
    expect(player.leaveVoiceChannel).not.toHaveBeenCalled();
  });
});
