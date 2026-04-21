/**
 * Regression: CDN failure retry coordination via `_cdnRetryPending`.
 *
 * When FFmpeg exits quickly with exit code 255 due to CDN issues (403, 404,
 * connection reset, etc.), the close handler sets `_cdnRetryPending = true`.
 * The subsequent Idle event must call retryCurrentTrack() instead of
 * handleTrackEnd() so the track gets a fresh URL. If the track actually
 * played to completion, the CDN flag must be cleared and the track advance.
 */

jest.mock("child_process", () => ({ spawn: jest.fn(), execFile: jest.fn() }));
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const AudioPlayer = require("../../src/playback/audio_player");

describe("regression: CDN retry coordination", () => {
  let player;

  beforeEach(() => {
    player = new AudioPlayer();
    player.handleTrackEnd = jest.fn();
    player.retryCurrentTrack = jest.fn();
  });

  afterEach(() => jest.clearAllTimers());

  test("Idle with _cdnRetryPending=true calls retryCurrentTrack, not handleTrackEnd", () => {
    player.currentTrack = { title: "t", duration: 300, resetRetry: jest.fn() };
    player.startTime = Date.now() - 1000;
    player._cdnRetryPending = true;

    player._handleIdle();

    expect(player.retryCurrentTrack).toHaveBeenCalledTimes(1);
    expect(player.handleTrackEnd).not.toHaveBeenCalled();
  });

  test("full-track playback clears _cdnRetryPending and advances normally", () => {
    player.currentTrack = { title: "t", duration: 100, resetRetry: jest.fn() };
    player.startTime = Date.now() - 101 * 1000;
    player._cdnRetryPending = true;

    player._handleIdle();

    expect(player._cdnRetryPending).toBe(false);
    expect(player.retryCurrentTrack).not.toHaveBeenCalled();
    expect(player.handleTrackEnd).toHaveBeenCalledTimes(1);
  });

  test("unknown duration + short playback + CDN flag → retry", () => {
    player.currentTrack = { title: "live", duration: 0, resetRetry: jest.fn() };
    player.startTime = Date.now() - 500;
    player._cdnRetryPending = true;

    player._handleIdle();

    expect(player.retryCurrentTrack).toHaveBeenCalled();
    expect(player.handleTrackEnd).not.toHaveBeenCalled();
  });

  test("unknown duration + >15s playback clears CDN flag (treated as full track)", () => {
    player.currentTrack = { title: "live", duration: 0, resetRetry: jest.fn() };
    player.startTime = Date.now() - 20 * 1000;
    player._cdnRetryPending = true;

    player._handleIdle();

    expect(player._cdnRetryPending).toBe(false);
    expect(player.retryCurrentTrack).not.toHaveBeenCalled();
  });

  describe("isCdnFailure pattern matching", () => {
    test.each([
      // Code 255 — historical FFmpeg "input open failure"
      [255, "Will reconnect at 123, error=End of file.", true],
      [255, "Server returned 403 Forbidden", true],
      [255, "Server returned 503 Service Unavailable", true],
      [255, "Connection reset by peer", true],
      [255, "Connection timed out", true],
      [255, "I/O error reading from network", true],
      // Code 8 — modern FFmpeg HTTP-side failures (production regression
      // 2026-04-21: 16/24 of today's 403s exited with code 8 instead of 255,
      // which silently bypassed the CDN retry path → URL never refreshed)
      [8, "[https @ 0x7a1] HTTP error 403 Forbidden", true],
      [8, "Server returned 403 Forbidden (access denied)", true],
      // Code 251 — TLS/I/O collapse (1 occurrence today)
      [251, "[tls @ 0x7c2] Unknown error\nError opening input: I/O error", true],
      // Codes that should NOT trigger retry
      [0, "End of file", false],
      [1, "Server returned 403", false],
      [137, "Connection reset", false], // SIGKILL — we initiated it
      [255, "Invalid data found when processing input", false], // bad input, not CDN
      [255, "", false],
      [8, "Invalid argument", false], // code 8 with non-CDN stderr
    ])("code=%i stderr=%j → %s", (code, stderr, expected) => {
      expect(player.isCdnFailure(code, stderr)).toBe(expected);
    });
  });

  describe("_doDisconnect — Cannot-find-module './manager' regression", () => {
    // Production regression 2026-04-21: every inactivity-timeout disconnect
    // threw "Cannot find module './manager'" inside a setTimeout callback,
    // became uncaughtException, and aborted cleanup mid-flight — leaving
    // the bot stuck in voice while the audio thread was already gone.
    test("does not throw when called with a connected voice connection", () => {
      player.voiceConnection = { destroy: jest.fn() };
      player.currentGuild = "guild-42";
      player._cancelInactivityTimer = jest.fn();
      expect(() => player._doDisconnect()).not.toThrow();
      expect(player.voiceConnection).toBeNull();
      expect(player.currentGuild).toBeNull();
    });

    test("survives voiceConnection.destroy() throwing (no longer silently swallowed)", () => {
      player.voiceConnection = {
        destroy: jest.fn(() => { throw new Error("already destroyed"); }),
      };
      player.currentGuild = "guild-42";
      player._cancelInactivityTimer = jest.fn();
      expect(() => player._doDisconnect()).not.toThrow();
      expect(player.voiceConnection).toBeNull();
    });

    test("does not require a non-existent './manager' module", () => {
      // Defensive: if anyone re-introduces require('./manager') the require
      // cache will be cold and Node throws MODULE_NOT_FOUND. Running through
      // _doDisconnect proves no lazy require is hiding inside.
      player.voiceConnection = null;
      player.currentGuild = null;
      player._cancelInactivityTimer = jest.fn();
      expect(() => player._doDisconnect()).not.toThrow();
    });
  });

  test("retryCurrentTrack clears _cdnRetryPending", async () => {
    const realRetry = AudioPlayer.prototype.retryCurrentTrack;
    player.retryCurrentTrack = realRetry.bind(player);
    player._cdnRetryPending = true;
    player.currentTrack = null;

    await player.retryCurrentTrack();

    expect(player._cdnRetryPending).toBe(false);
  });
});
