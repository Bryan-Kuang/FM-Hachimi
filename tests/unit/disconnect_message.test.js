/**
 * Unit tests for disconnect message functionality
 * Tests the humorous message sent when bot is manually disconnected
 */

const BotClient = require('../../src/bot/client');

// Mock discord.js
jest.mock('discord.js', () => {
  const mockCollection = class MockCollection extends Map {
    find(fn) {
      for (const [key, value] of this.entries()) {
        if (fn(value, key, this)) return value;
      }
      return undefined;
    }

    filter(fn) {
      const result = new MockCollection();
      for (const [key, value] of this.entries()) {
        if (fn(value, key, this)) {
          result.set(key, value);
        }
      }
      return result;
    }
  };

  return {
    Client: jest.fn().mockImplementation(() => ({
      user: { id: 'bot-123', username: 'TestBot' },
      login: jest.fn().mockResolvedValue('token'),
      on: jest.fn(),
      once: jest.fn(),
      commands: new mockCollection(),
      cooldowns: new mockCollection(),
      channels: {
        cache: new mockCollection(),
        fetch: jest.fn(),
      },
    })),
    GatewayIntentBits: {
      Guilds: 1,
      GuildVoiceStates: 2,
      GuildMessages: 4,
      MessageContent: 8,
    },
    Collection: mockCollection,
    ActivityType: { Playing: 0 },
    MessageFlags: { Ephemeral: 64 },
    AuditLogEvent: {
      MemberDisconnect: 27,
    },
  };
});

// Mock logger
jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock config
jest.mock('../../src/config/config', () => ({
  discord: { token: 'test-token' },
  audio: {},
}));

// Mock other dependencies
jest.mock('../../src/control/player_control');
jest.mock('../../src/playlist/playlist_manager');
jest.mock('../../src/ui/interface_updater');
jest.mock('../../src/utils/debug', () => ({
  trace: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../../src/services/logger_service');
const InterfaceUpdater = require('../../src/ui/interface_updater');

describe('Disconnect Message Feature', () => {
  let botClient;
  let mockGuild;
  let mockChannel;
  let mockAuditLogs;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup InterfaceUpdater mock
    InterfaceUpdater.contexts = new Map();

    // Create mock channel
    mockChannel = {
      send: jest.fn().mockResolvedValue({ id: 'msg-123' }),
    };

    // Get MockCollection from discord.js mock
    const { Collection } = require('discord.js');

    // Create mock audit logs with MockCollection
    mockAuditLogs = {
      entries: new Collection(),
    };

    // Create mock guild
    mockGuild = {
      id: 'guild-123',
      name: 'Test Guild',
      members: {
        me: {
          displayName: '哈基米',
        },
      },
      fetchAuditLogs: jest.fn().mockResolvedValue(mockAuditLogs),
    };

    // Create bot client
    botClient = new BotClient();
    botClient.client = {
      user: { id: 'bot-123', username: 'TestBot' },
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel),
      },
    };
  });

  describe('sendDisconnectMessage', () => {
    test('should send message with culprit and current track', async () => {
      // Setup: text channel context exists
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      // Setup: audit log shows who disconnected
      mockAuditLogs.entries.set('log-1', {
        target: { id: 'bot-123' },
        executor: { displayName: '小明', username: 'xiaoming' },
        createdTimestamp: Date.now() - 1000, // 1 second ago
      });

      // Setup: current track
      const currentTrack = {
        title: '蓝莲花',
        url: 'https://bilibili.com/video/BV123',
      };

      await botClient.sendDisconnectMessage(mockGuild, currentTrack);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('饿啊～')
      );
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('哈基米')
      );
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('小明')
      );
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('蓝莲花')
      );
    });

    test('should send message without track when idle', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      mockAuditLogs.entries.set('log-1', {
        target: { id: 'bot-123' },
        executor: { displayName: '小红', username: 'xiaohong' },
        createdTimestamp: Date.now() - 2000,
      });

      await botClient.sendDisconnectMessage(mockGuild, null);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('饿啊～')
      );
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('小红')
      );
      // Should not contain "遗言"
      const sentMessage = mockChannel.send.mock.calls[0][0];
      expect(sentMessage).not.toContain('遗言');
    });

    test('should show "未知凶手" when no audit log access', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      // Simulate permission error
      mockGuild.fetchAuditLogs.mockRejectedValue(
        new Error('Missing Permissions')
      );

      await botClient.sendDisconnectMessage(mockGuild, null);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('未知凶手')
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Failed to fetch audit logs for disconnect',
        expect.any(Object)
      );
    });

    test('should show "未知凶手" when audit log has no matching entry', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      // Audit log exists but for different bot
      mockAuditLogs.entries.set('log-1', {
        target: { id: 'other-bot-999' },
        executor: { displayName: '小李', username: 'xiaoli' },
        createdTimestamp: Date.now() - 1000,
      });

      await botClient.sendDisconnectMessage(mockGuild, null);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('未知凶手')
      );
    });

    test('should show "未知凶手" when disconnect log is too old', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      // Disconnect log is 10 seconds old (threshold is 5 seconds)
      mockAuditLogs.entries.set('log-1', {
        target: { id: 'bot-123' },
        executor: { displayName: '小张', username: 'xiaozhang' },
        createdTimestamp: Date.now() - 10000,
      });

      await botClient.sendDisconnectMessage(mockGuild, null);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('未知凶手')
      );
    });

    test('should pick most recent disconnect from multiple entries', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      // Add multiple disconnect entries
      mockAuditLogs.entries.set('log-1', {
        target: { id: 'bot-123' },
        executor: { displayName: '小王', username: 'xiaowang' },
        createdTimestamp: Date.now() - 4000, // 4 seconds ago
      });

      mockAuditLogs.entries.set('log-2', {
        target: { id: 'bot-123' },
        executor: { displayName: '小赵', username: 'xiaozhao' },
        createdTimestamp: Date.now() - 2000, // 2 seconds ago (most recent)
      });

      mockAuditLogs.entries.set('log-3', {
        target: { id: 'bot-123' },
        executor: { displayName: '小孙', username: 'xiaosun' },
        createdTimestamp: Date.now() - 6000, // 6 seconds ago (too old)
      });

      await botClient.sendDisconnectMessage(mockGuild, null);

      // Should pick the most recent one within 5 second window
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('小赵')
      );
    });

    test('should not send message when no text channel context', async () => {
      // No context set
      await botClient.sendDisconnectMessage(mockGuild, null);

      expect(mockChannel.send).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'No text channel context for disconnect message'
      );
    });

    test('should not send message when channel fetch fails', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-999',
      });

      botClient.client.channels.fetch.mockRejectedValue(
        new Error('Unknown Channel')
      );

      await botClient.sendDisconnectMessage(mockGuild, null);

      expect(mockChannel.send).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'Failed to fetch text channel for disconnect message'
      );
    });

    test('should handle channel send failure gracefully', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      mockChannel.send.mockRejectedValue(new Error('Missing Permissions'));

      await botClient.sendDisconnectMessage(mockGuild, null);

      expect(logger.error).toHaveBeenCalledWith(
        'Error sending disconnect message',
        expect.objectContaining({
          error: 'Missing Permissions',
        })
      );
    });

    test('should use fallback username when displayName is missing', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      mockAuditLogs.entries.set('log-1', {
        target: { id: 'bot-123' },
        executor: { username: 'noDisplayName' }, // No displayName
        createdTimestamp: Date.now() - 1000,
      });

      await botClient.sendDisconnectMessage(mockGuild, null);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('noDisplayName')
      );
    });

    test('should use bot username when guild displayName is missing', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      // No displayName for bot in guild
      mockGuild.members.me.displayName = null;

      await botClient.sendDisconnectMessage(mockGuild, null);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('TestBot')
      );
    });

    test('should handle track with special characters in title', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      const currentTrack = {
        title: '【哈基米】完整版 - "测试"歌曲 & 特殊字符',
      };

      await botClient.sendDisconnectMessage(mockGuild, currentTrack);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('【哈基米】完整版 - "测试"歌曲 & 特殊字符')
      );
    });

    test('should log success when message is sent', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      mockAuditLogs.entries.set('log-1', {
        target: { id: 'bot-123' },
        executor: { displayName: '测试者', username: 'tester' },
        createdTimestamp: Date.now() - 500,
      });

      const currentTrack = { title: '测试歌曲' };

      await botClient.sendDisconnectMessage(mockGuild, currentTrack);

      expect(logger.info).toHaveBeenCalledWith(
        'Sent disconnect message',
        expect.objectContaining({
          guild: 'Test Guild',
          culprit: '测试者',
          hadTrack: true,
        })
      );
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty audit log entries', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      const { Collection } = require('discord.js');
      mockAuditLogs.entries = new Collection(); // Empty

      await botClient.sendDisconnectMessage(mockGuild, null);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('未知凶手')
      );
    });

    test('should handle track with missing title', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      const currentTrack = { url: 'https://bilibili.com' }; // No title

      await botClient.sendDisconnectMessage(mockGuild, currentTrack);

      // Should send message but without "遗言" since title is falsy
      const sentMessage = mockChannel.send.mock.calls[0][0];
      expect(sentMessage).not.toContain('遗言');
    });

    test('should handle concurrent disconnect messages', async () => {
      InterfaceUpdater.contexts.set('guild-123', {
        channelId: 'channel-456',
      });

      // Trigger multiple disconnect messages simultaneously
      const promises = [
        botClient.sendDisconnectMessage(mockGuild, null),
        botClient.sendDisconnectMessage(mockGuild, null),
        botClient.sendDisconnectMessage(mockGuild, null),
      ];

      await Promise.all(promises);

      // Should send 3 messages (might be a bit spammy but safe)
      expect(mockChannel.send).toHaveBeenCalledTimes(3);
    });
  });
});
