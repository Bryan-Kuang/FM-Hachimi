/**
 * Jest test setup and global mocks
 */

// Mock Discord.js for testing
jest.mock("discord.js", () => ({
  Client: jest.fn().mockImplementation(() => ({
    login: jest.fn().mockResolvedValue("logged in"),
    on: jest.fn(),
    user: { id: "test-bot-id", username: "TestBot" },
    guilds: new Map(),
    channels: new Map(),
    users: new Map(),
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildVoiceStates: 256,
    GuildMessages: 512,
    MessageContent: 32768,
  },
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setThumbnail: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({
      title: "Test Title",
      description: "Test Description",
      fields: [],
      color: 0x00ae86,
    }),
  })),
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({
      components: [],
    }),
  })),
  ButtonBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
    setDisabled: jest.fn().mockReturnThis(),
  })),
  ButtonStyle: {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5,
  },
  ApplicationCommandOptionType: {
    String: 3,
    Integer: 4,
    Boolean: 5,
    User: 6,
    Channel: 7,
    Role: 8,
  },
}));

// Mock @discordjs/voice for testing
jest.mock("@discordjs/voice", () => ({
  createAudioPlayer: jest.fn().mockReturnValue({
    play: jest.fn(),
    pause: jest.fn(),
    stop: jest.fn(),
    on: jest.fn(),
    state: { status: "idle" },
  }),
  createAudioResource: jest.fn().mockReturnValue({
    metadata: {},
    playStream: {},
  }),
  joinVoiceChannel: jest.fn().mockReturnValue({
    subscribe: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn(),
  }),
  AudioPlayerStatus: {
    Idle: "idle",
    Buffering: "buffering",
    Playing: "playing",
    Paused: "paused",
  },
  VoiceConnectionStatus: {
    Ready: "ready",
    Connecting: "connecting",
    Disconnected: "disconnected",
  },
}));

// Mock yt-dlp-wrap for testing
jest.mock("yt-dlp-wrap", () => {
  return jest.fn().mockImplementation(() => ({
    execPromise: jest.fn().mockResolvedValue({
      stdout: JSON.stringify({
        title: "Test Video",
        duration: 300,
        thumbnail: "https://example.com/thumb.jpg",
        url: "https://example.com/audio.m4a",
      }),
      stderr: "",
    }),
    getVideoInfo: jest.fn().mockResolvedValue({
      title: "Test Video",
      duration: 300,
      thumbnail: "https://example.com/thumb.jpg",
    }),
  }));
}, { virtual: true });

// Mock axios for HTTP requests
jest.mock("axios", () => ({
  get: jest.fn().mockResolvedValue({
    data: {},
    status: 200,
    statusText: "OK",
  }),
  post: jest.fn().mockResolvedValue({
    data: {},
    status: 200,
    statusText: "OK",
  }),
}));

// Mock winston logger
jest.mock("winston", () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    add: jest.fn(),
    log: jest.fn(),
  }),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
    colorize: jest.fn(),
    simple: jest.fn(),
    printf: jest.fn((fn) => fn({ timestamp: 'x', level: 'info', message: 'm', context: {} })),
  },
  transports: {
    File: jest.fn(),
    Console: jest.fn(),
  },
}));

// Global test utilities
global.mockDiscordClient = {
  user: { id: "test-bot-id", username: "TestBot" },
  guilds: new Map(),
  channels: new Map(),
  users: new Map(),
};

global.mockAudioStream = {
  pipe: jest.fn(),
  on: jest.fn(),
  destroy: jest.fn(),
};

global.mockVideoData = {
  title: "Test Bilibili Video",
  duration: 300,
  thumbnail: "https://example.com/thumbnail.jpg",
  url: "https://www.bilibili.com/video/BV1234567890",
};

// Mock environment variables for testing
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DISCORD_TOKEN = "test-token";
process.env.CLIENT_ID = "test-client-id";
process.env.GUILD_ID = "test-guild-id";

// Suppress console output during tests unless explicitly needed
const originalConsole = { ...console };
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Restore console for specific tests if needed
global.restoreConsole = () => {
  global.console = originalConsole;
};

// Add custom jest matchers if needed
expect.extend({
  toBeValidBilibiliUrl(received) {
    const patterns = [
      /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/,
      /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/av(\d+)/,
      /(?:https?:\/\/)?b23\.tv\/([a-zA-Z0-9]+)/,
      /(?:https?:\/\/)?m\.bilibili\.com\/video\/(BV[a-zA-Z0-9]+|av\d+)/,
    ];

    const isValid = patterns.some((pattern) => pattern.test(received));

    return {
      message: () =>
        `expected ${received} ${
          isValid ? "not " : ""
        }to be a valid Bilibili URL`,
      pass: isValid,
    };
  },
});
