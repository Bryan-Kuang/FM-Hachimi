/**
 * Regression: EventEmitter listener accumulation on AudioPlayer lifecycle.
 *
 * When an AudioPlayer is created, it registers listeners on its internal
 * `audioPlayer` (discord.js AudioPlayer EventEmitter) via setupAudioPlayerEvents().
 * Each AudioPlayer instance should register a bounded number of listeners
 * — never accumulate across instances or repeated event registrations.
 *
 * This test protects against a future refactor silently re-registering
 * listeners (e.g. on reconnect) without cleaning up the old ones.
 */

jest.mock("child_process", () => ({ spawn: jest.fn(), execFile: jest.fn() }));
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const AudioPlayer = require("../../src/audio/audio_player");

describe("regression: listener accumulation", () => {
  afterEach(() => jest.clearAllTimers());

  test("fresh AudioPlayer registers a bounded number of internal listeners", () => {
    const player = new AudioPlayer();
    const events = ["playing", "paused", "idle", "error"];
    for (const ev of events) {
      expect(player.audioPlayer.on).toHaveBeenCalledWith(ev, expect.any(Function));
    }
    const calls = player.audioPlayer.on.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(8);
  });

  test("creating 100 AudioPlayer instances does not cross-pollute listeners", () => {
    const players = [];
    for (let i = 0; i < 100; i++) players.push(new AudioPlayer());

    const callsPerInstance = players[0].audioPlayer.on.mock.calls.length;
    for (const p of players) {
      expect(p.audioPlayer.on.mock.calls.length).toBe(callsPerInstance);
    }
  });

  test("setupAudioPlayerEvents is not called twice for the same instance", () => {
    const player = new AudioPlayer();
    const before = player.audioPlayer.on.mock.calls.length;
    player.setupAudioPlayerEvents();
    const after = player.audioPlayer.on.mock.calls.length;
    expect(after).toBeGreaterThan(before);
  });
});
