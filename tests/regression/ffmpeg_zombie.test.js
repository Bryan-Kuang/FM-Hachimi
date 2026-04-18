/**
 * Regression: FFmpeg child process cleanup.
 *
 * `cleanupFFmpegProcess` must:
 *   1. Send SIGTERM to the tracked FFmpeg process
 *   2. Clear `this.ffmpegProcess` to null immediately (prevents accidental
 *      double-kill of a newly spawned process)
 *   3. Schedule a SIGKILL 1 second later as a safety net
 *   4. Be idempotent — calling twice with no process is a no-op
 *
 * Prior bug: broken-pipe errors when skip/stop left FFmpeg alive or killed
 * a process that a newer spawn had just overwritten.
 */

jest.mock("child_process", () => ({
  spawn: jest.fn(),
  execFile: jest.fn(),
}));
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const AudioPlayer = require("../../src/playback/audio_player");

const makeFakeFFmpeg = () => ({
  pid: Math.floor(Math.random() * 100000),
  killed: false,
  stdin: { destroyed: false, end: jest.fn() },
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() },
  on: jest.fn(),
  kill: jest.fn(function (signal) {
    if (signal === "SIGKILL") this.killed = true;
  }),
});

describe("regression: FFmpeg zombie prevention", () => {
  let player;
  let fake;

  beforeEach(() => {
    jest.useFakeTimers();
    player = new AudioPlayer();
    fake = makeFakeFFmpeg();
    player.ffmpegProcess = fake;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test("cleanupFFmpegProcess sends SIGTERM and clears the reference", () => {
    player.cleanupFFmpegProcess();

    expect(fake.kill).toHaveBeenCalledWith("SIGTERM");
    expect(player.ffmpegProcess).toBeNull();
  });

  test("cleanupFFmpegProcess gracefully ends stdin before killing", () => {
    player.cleanupFFmpegProcess();

    expect(fake.stdin.end).toHaveBeenCalled();
    expect(fake.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("cleanupFFmpegProcess force-kills with SIGKILL after 1s if process still alive", () => {
    player.cleanupFFmpegProcess();
    expect(fake.kill).toHaveBeenCalledWith("SIGTERM");
    expect(fake.kill).not.toHaveBeenCalledWith("SIGKILL");

    jest.advanceTimersByTime(1100);

    expect(fake.kill).toHaveBeenCalledWith("SIGKILL");
  });

  test("cleanupFFmpegProcess does NOT SIGKILL if process exited gracefully after SIGTERM", () => {
    fake.kill.mockImplementationOnce(() => { fake.killed = true; });

    player.cleanupFFmpegProcess();
    jest.advanceTimersByTime(1100);

    const sigkillCalls = fake.kill.mock.calls.filter((c) => c[0] === "SIGKILL");
    expect(sigkillCalls.length).toBe(0);
  });

  test("cleanupFFmpegProcess is a no-op when no process is tracked", () => {
    player.ffmpegProcess = null;

    expect(() => player.cleanupFFmpegProcess()).not.toThrow();
    expect(player.ffmpegProcess).toBeNull();
  });

  test("cleanupFFmpegProcess is a no-op when process already killed", () => {
    fake.killed = true;
    player.cleanupFFmpegProcess();

    expect(fake.kill).not.toHaveBeenCalled();
  });

  test("cleanupFFmpegProcess does not kill a newer replacement process", () => {
    player.cleanupFFmpegProcess();
    expect(player.ffmpegProcess).toBeNull();

    const newer = makeFakeFFmpeg();
    player.ffmpegProcess = newer;

    jest.advanceTimersByTime(1100);

    const oldSigkill = fake.kill.mock.calls.filter((c) => c[0] === "SIGKILL");
    expect(oldSigkill.length).toBe(1);
    expect(newer.kill).not.toHaveBeenCalled();
  });

  test("stdin.end is guarded against already-destroyed streams", () => {
    fake.stdin.destroyed = true;
    player.cleanupFFmpegProcess();

    expect(fake.stdin.end).not.toHaveBeenCalled();
    expect(fake.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("errors during cleanup are caught, not propagated", () => {
    fake.kill.mockImplementationOnce(() => { throw new Error("boom"); });

    expect(() => player.cleanupFFmpegProcess()).not.toThrow();
    expect(player.ffmpegProcess).toBeNull();
  });
});
