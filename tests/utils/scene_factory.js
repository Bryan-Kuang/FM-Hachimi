const PlayerControl = require("../../src/control/player_control");
const AudioManager = require("../../src/audio/manager");

class InteractionBuilder {
  constructor() {
    this._guildId = "guild-1";
    this._channelId = "channel-1";
    this._memberVoiceChannelId = null;
    this._botVoiceChannelId = null;
    this._options = {};
  }
  inGuild(id) {
    this._guildId = id;
    return this;
  }
  inChannel(id) {
    this._channelId = id;
    return this;
  }
  withMember({ voice }) {
    this._memberVoiceChannelId = voice?.channelId ?? null;
    return this;
  }
  withBot({ voice }) {
    this._botVoiceChannelId = voice?.channelId ?? null;
    return this;
  }
  withOptions(options) {
    this._options = options || {};
    return this;
  }
  build() {
    const interaction = {
      user: { username: "TestUser" },
      member: {
        voice: {
          channel: this._memberVoiceChannelId
            ? { id: this._memberVoiceChannelId }
            : null,
        },
      },
      guild: {
        id: this._guildId,
        name: "Test Guild",
        members: {
          me: {
            voice: {
              channel: this._botVoiceChannelId
                ? { id: this._botVoiceChannelId }
                : null,
            },
          },
        },
      },
      channelId: this._channelId,
      reply: jest.fn(),
      editReply: jest.fn(),
      deferReply: jest.fn(),
      followUp: jest.fn(),
      options: {
        getString: jest.fn().mockImplementation((k) => this._options[k]),
        getInteger: jest.fn().mockImplementation((k) => this._options[k]),
      },
    };
    return interaction;
  }
}

const createMockAudioPlayer = (state) => {
  const player = {
    isPlaying: false,
    isPaused: false,
    queue: [],
    voiceConnection: null,
    stop: jest.fn().mockResolvedValue(true),
    getState: jest.fn(),
    getCurrentTime: jest.fn().mockReturnValue(0),
    joinVoiceChannel: jest.fn().mockResolvedValue(true),
  };
  if (state === "playing") player.isPlaying = true;
  if (state === "paused") player.isPaused = true;
  if (state === "connected") player.voiceConnection = {};
  return player;
};

const createScene = ({ userVc, botVc, playerState, options }) => {
  const interaction = new InteractionBuilder()
    .inGuild("guild-1")
    .inChannel("channel-1")
    .withMember({ voice: { channelId: userVc } })
    .withBot({ voice: { channelId: botVc } })
    .withOptions(options || {})
    .build();

  const player = createMockAudioPlayer(playerState);
  AudioManager.getPlayer = jest.fn().mockReturnValue(player);

  return { interaction, playerControl: PlayerControl, player };
};

class MockEventEmitter {
  constructor() {
    this.listeners = new Map();
  }
  on(event, handler) {
    const arr = this.listeners.get(event) || [];
    arr.push(handler);
    this.listeners.set(event, arr);
  }
  emit(event, data) {
    (this.listeners.get(event) || []).forEach((h) => h(data));
  }
}

const validateStateTransition = (from, to) => {
  const valid = {
    idle: ["playing"],
    playing: ["paused", "stopped", "idle"],
    paused: ["playing", "stopped", "idle"],
  };
  return valid[from]?.includes(to) ?? false;
};

const advanceTime = (ms) => {
  if (jest && typeof jest.advanceTimersByTime === "function") {
    jest.advanceTimersByTime(ms);
  }
};

module.exports = {
  InteractionBuilder,
  createMockAudioPlayer,
  createScene,
  MockEventEmitter,
  validateStateTransition,
  advanceTime,
};
