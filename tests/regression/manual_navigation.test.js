/**
 * Regression: rapid manual navigation (skip/previous bursts).
 *
 * When users spam buttons or slash commands, multiple navigate calls race
 * against each other AND against stale Idle events from killed FFmpeg processes.
 * The queue must advance exactly by the number of intentional user actions —
 * not more (double-skip) and not less (lost skips).
 */

jest.mock("child_process", () => ({ spawn: jest.fn(), execFile: jest.fn() }));
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const AudioPlayer = require("../../src/audio/audio_player");

/** Build a mock track with the minimal shape Queue/AudioPlayer expects. */
const makeTrackData = (i) => ({
  bvid: `BV${i}`,
  title: `Song ${i + 1}`,
  audioUrl: `url${i + 1}`,
  duration: 180,
});

/** Populate a player's queue with N tracks using the Queue API. */
const populateQueue = (player, n) => {
  for (let i = 0; i < n; i++) {
    player.addToQueue(makeTrackData(i), `<@user>`);
  }
};

describe("regression: manual navigation bursts", () => {
  let player;

  beforeEach(() => {
    player = new AudioPlayer();
  });

  afterEach(() => jest.clearAllTimers());

  test("5 sequential skips advance by exactly 5", async () => {
    populateQueue(player, 10);
    player.currentIndex = 0;
    player.currentTrack = player.queue.items[0];
    player.queue.loopMode = "queue";
    player.voiceConnection = null;

    for (let i = 0; i < 5; i++) {
      await player.skip();
    }

    expect(player.currentIndex).toBe(5);
  });

  test("concurrent skips (all awaited) advance deterministically", async () => {
    populateQueue(player, 10);
    player.currentIndex = 0;
    player.currentTrack = player.queue.items[0];
    player.queue.loopMode = "queue";
    player.voiceConnection = null;

    await Promise.all([player.skip(), player.skip(), player.skip()]);

    expect(player.currentIndex).toBe(3);
  });

  test("skip then previous returns to original track", async () => {
    populateQueue(player, 5);
    player.currentIndex = 2;
    player.currentTrack = player.queue.items[2];
    player.queue.loopMode = "queue";
    player.voiceConnection = null;

    await player.skip();
    expect(player.currentIndex).toBe(3);

    await player.previous();
    expect(player.currentIndex).toBe(2);
  });

  test("skip at end with queue loop + stale Idle: wraps once, not twice", async () => {
    populateQueue(player, 3);
    player.currentIndex = 2;
    player.currentTrack = player.queue.items[2];
    player.queue.loopMode = "queue";
    player.voiceConnection = null;
    player.handleTrackEnd = jest.fn();

    await player.skip();
    expect(player.currentIndex).toBe(0);

    player._manualNavigating = true;
    player.startTime = Date.now() - 60 * 1000;
    player._handleIdle();

    expect(player.handleTrackEnd).not.toHaveBeenCalled();
    expect(player.currentIndex).toBe(0);
  });

  test("skip on empty queue (no tracks) stops playback cleanly", async () => {
    // Empty queue — no tracks added
    player.queue.loopMode = "none";
    player.voiceConnection = null;
    player._doDisconnect = jest.fn();

    const result = await player.skip();

    expect(result).toBe(false);
    expect(player.currentIndex).toBe(-1);
    expect(player.currentTrack).toBeNull();
  });

  test("skip resets startTime to avoid stale duration calculations", async () => {
    populateQueue(player, 3);
    player.currentIndex = 0;
    player.currentTrack = player.queue.items[0];
    player.startTime = Date.now() - 30 * 60 * 1000;
    player.queue.loopMode = "queue";
    player.voiceConnection = null;

    await player.skip();

    expect(player.startTime).toBeNull();
  });

  test("previous resets startTime", async () => {
    populateQueue(player, 3);
    player.currentIndex = 2;
    player.currentTrack = player.queue.items[2];
    player.startTime = Date.now() - 30 * 60 * 1000;
    player.queue.loopMode = "queue";
    player.voiceConnection = null;

    await player.previous();

    expect(player.startTime).toBeNull();
  });

  test("skip + stale Idle + another skip: advances by 2, Idle is absorbed", async () => {
    populateQueue(player, 5);
    player.currentIndex = 0;
    player.currentTrack = player.queue.items[0];
    player.queue.loopMode = "queue";
    player.voiceConnection = null;
    player.handleTrackEnd = jest.fn();

    await player.skip();
    expect(player.currentIndex).toBe(1);

    player._manualNavigating = true;
    player.startTime = Date.now() - 60 * 1000;
    player._handleIdle();
    expect(player.currentIndex).toBe(1);

    await player.skip();
    expect(player.currentIndex).toBe(2);
    expect(player.handleTrackEnd).not.toHaveBeenCalled();
  });
});
