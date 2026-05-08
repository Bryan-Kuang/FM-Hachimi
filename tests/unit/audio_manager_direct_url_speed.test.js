jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const AudioManager = require("../../src/session/audio_manager");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeInteraction() {
  return {
    guild: { id: "guild-1", name: "Guild" },
    member: {
      voice: {
        channel: {
          id: "voice-1",
          guild: { id: "guild-1" },
        },
      },
    },
    user: { id: "user-1", username: "User" },
  };
}

function makePlayer(overrides = {}) {
  const player = {
    voiceConnection: null,
    isPlaying: false,
    isPaused: false,
    currentTrack: null,
    currentIndex: -1,
    queue: { length: 0, items: [] },
    joinVoiceChannel: jest.fn().mockResolvedValue(true),
    leaveVoiceChannel: jest.fn(),
    addToQueue: jest.fn(function addToQueue(videoData, requestedBy) {
      const track = { title: videoData.title, requestedBy };
      player.queue.items.push(track);
      player.queue.length = player.queue.items.length;
      return track;
    }),
    playCurrentTrack: jest.fn().mockResolvedValue(true),
    playNext: jest.fn().mockResolvedValue(true),
    getState: jest.fn().mockReturnValue({ state: "ok" }),
    ...overrides,
  };
  return player;
}

function makeManager(player, extractor) {
  const manager = new AudioManager({ get: jest.fn(() => ({ player: null })) }, extractor);
  manager.getPlayer = jest.fn().mockReturnValue(player);
  return manager;
}

describe("AudioManager direct URL speed path", () => {
  test("starts Bilibili extraction and voice join concurrently", async () => {
    const extraction = deferred();
    const join = deferred();
    const extractor = {
      extractAudio: jest.fn().mockReturnValue(extraction.promise),
    };
    const player = makePlayer({
      joinVoiceChannel: jest.fn().mockReturnValue(join.promise),
    });
    const manager = makeManager(player, extractor);

    const resultPromise = manager.playBilibiliVideo(
      makeInteraction(),
      "https://www.bilibili.com/video/BV1xx411c7BF",
    );

    await Promise.resolve();

    expect(extractor.extractAudio).toHaveBeenCalled();
    expect(player.joinVoiceChannel).toHaveBeenCalled();

    extraction.resolve({ title: "Fast Track", audioUrl: "https://cdn/audio.m4a", duration: 10 });
    join.resolve(true);

    await expect(resultPromise).resolves.toMatchObject({ success: true });
  });

  test("leaves voice when early join succeeds but extraction fails from idle", async () => {
    const extraction = deferred();
    const join = deferred();
    const extractor = {
      extractAudio: jest.fn().mockReturnValue(extraction.promise),
    };
    const player = makePlayer({
      joinVoiceChannel: jest.fn().mockReturnValue(join.promise),
    });
    const manager = makeManager(player, extractor);

    const resultPromise = manager.playBilibiliVideo(
      makeInteraction(),
      "https://www.bilibili.com/video/BV1xx411c7BF",
    );

    await Promise.resolve();
    join.resolve(true);
    extraction.reject(new Error("extract failed"));

    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("extract failed"),
    });
    expect(player.leaveVoiceChannel).toHaveBeenCalledTimes(1);
  });

  test("does not disconnect existing active playback when extraction fails", async () => {
    const extractor = {
      extractAudio: jest.fn().mockRejectedValue(new Error("extract failed")),
    };
    const player = makePlayer({
      isPlaying: true,
      voiceConnection: { joinConfig: { channelId: "voice-1" } },
    });
    const manager = makeManager(player, extractor);

    const result = await manager.playBilibiliVideo(
      makeInteraction(),
      "https://www.bilibili.com/video/BV1xx411c7BF",
    );

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("extract failed"),
    });
    expect(player.leaveVoiceChannel).not.toHaveBeenCalled();
  });
});
