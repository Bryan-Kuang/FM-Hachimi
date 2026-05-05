/**
 * Regression: double-skip via stale Idle events.
 *
 * When skip() kills FFmpeg, @discordjs/voice emits AudioPlayerStatus.Idle
 * at an unpredictable time (before, during, or after the new track starts).
 * Without `_manualNavigating`, that stale Idle runs through _handleIdle()
 * with a large actualPlaybackDuration and calls handleTrackEnd() → skip() again,
 * advancing the queue by 2 instead of 1.
 *
 * These tests pin the current guard behavior so refactoring must preserve it.
 */

jest.mock("child_process", () => ({ spawn: jest.fn(), execFile: jest.fn() }));
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const AudioPlayer = require("../../src/audio/audio_player");

const makeTrackData = (i) => ({
  bvid: `BV${i}`,
  title: `Song ${i + 1}`,
  audioUrl: `url${i + 1}`,
  duration: 180,
});

const populateQueue = (player, n) => {
  for (let i = 0; i < n; i++) {
    player.addToQueue(makeTrackData(i), `<@user>`);
  }
};

describe("regression: double-skip via stale Idle", () => {
  let player;

  beforeEach(() => {
    player = new AudioPlayer();
    player.handleTrackEnd = jest.fn();
    player.retryCurrentTrack = jest.fn();
  });

  afterEach(() => jest.clearAllTimers());

  test("Idle arriving AFTER skip completed does not advance queue again", async () => {
    populateQueue(player, 5);
    player.currentIndex = 1;
    player.currentTrack = player.queue.items[1];
    player.startTime = Date.now() - 60 * 1000;
    player.queue.loopMode = "queue";
    player.voiceConnection = null;

    await player.skip();
    expect(player.currentIndex).toBe(2);

    player._manualNavigating = true;
    player.startTime = Date.now() - 60 * 1000;
    player._handleIdle();

    expect(player.handleTrackEnd).not.toHaveBeenCalled();
    expect(player.currentIndex).toBe(2);
  });

  test("three rapid skips advance by exactly 3, not 6", async () => {
    populateQueue(player, 10);
    player.currentIndex = 0;
    player.currentTrack = player.queue.items[0];
    player.queue.loopMode = "queue";
    player.voiceConnection = null;

    await player.skip();
    player._manualNavigating = true;
    player._handleIdle();

    await player.skip();
    player._manualNavigating = true;
    player._handleIdle();

    await player.skip();
    player._manualNavigating = true;
    player._handleIdle();

    expect(player.currentIndex).toBe(3);
    expect(player.handleTrackEnd).not.toHaveBeenCalled();
  });

  test("guard clears itself after consuming one stale Idle", () => {
    player.currentTrack = { title: "t", duration: 100, resetRetry: jest.fn() };
    player._manualNavigating = true;

    player._handleIdle();
    expect(player._manualNavigating).toBe(false);

    player.startTime = Date.now() - 10 * 1000;
    player._handleIdle();
    expect(player.handleTrackEnd).toHaveBeenCalledTimes(1);
  });

  test("legitimate track-end (no manual nav) still advances queue", () => {
    player.currentTrack = { title: "t", duration: 100, resetRetry: jest.fn() };
    player._manualNavigating = false;
    player.startTime = Date.now() - 120 * 1000;

    player._handleIdle();

    expect(player.handleTrackEnd).toHaveBeenCalledTimes(1);
  });
});
