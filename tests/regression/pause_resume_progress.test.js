/**
 * Regression: pause/resume must not reset or drift the progress bar.
 *
 * Bug history (issue #12 — "播放进度显示在运行一段时间后进度条会从每秒更新变成几秒更新一次"):
 *   AudioPlayer's Playing event handler unconditionally set
 *   `this.startTime = Date.now()`, and `getCurrentTime()` was `(now - startTime)/1000`.
 *   That's fine for a brand-new track, but Playing fires *again* on:
 *     - Paused → Playing (user /resume)
 *     - AutoPaused → Playing (buffer-underrun recovery mid-stream)
 *   Each such transition backdated the progress bar to 0:00, making the
 *   displayed position drift further and further behind real audio position.
 *
 * Fix: audio-position is now tracked by a pause-aware pair
 *   (`_accumulatedPlayMs` + `_currentPlayStartedAt`) that `getCurrentTime()`
 *   reads. `startTime` remains the wall-clock start (needed by `_handleIdle`
 *   for its 3s early-exit retry heuristic) and is NOT used for progress.
 *
 * These tests drive the audio player through event transitions directly
 * (not via .play()/.pause()) to avoid the real @discordjs/voice state machine.
 */

jest.mock("child_process", () => ({ spawn: jest.fn(), execFile: jest.fn() }));
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Override the global `@discordjs/voice` mock (tests/setup.js) with one that
// returns a real EventEmitter as the audioPlayer — we need emit() to drive
// Playing/Paused transitions by hand.
jest.mock("@discordjs/voice", () => {
  const { EventEmitter } = require("events");
  return {
    createAudioPlayer: jest.fn(() => {
      const ee = new EventEmitter();
      ee.play = jest.fn();
      ee.pause = jest.fn();
      ee.stop = jest.fn();
      ee.state = { status: "idle" };
      return ee;
    }),
    createAudioResource: jest.fn(() => ({ metadata: {}, playStream: {} })),
    joinVoiceChannel: jest.fn(),
    getVoiceConnection: jest.fn(),
    AudioPlayerStatus: {
      Idle: "idle",
      Buffering: "buffering",
      Playing: "playing",
      Paused: "paused",
      AutoPaused: "autopaused",
    },
    VoiceConnectionStatus: {
      Ready: "ready",
      Connecting: "connecting",
      Disconnected: "disconnected",
    },
    StreamType: { Arbitrary: "arbitrary" },
  };
});

const { AudioPlayerStatus } = require("@discordjs/voice");
const AudioPlayer = require("../../src/audio/audio_player");

function emitPlaying(player) {
  player.audioPlayer.emit(AudioPlayerStatus.Playing);
}
function emitPaused(player) {
  player.audioPlayer.emit(AudioPlayerStatus.Paused);
}
function emitAutoPaused(player) {
  player.audioPlayer.emit(AudioPlayerStatus.AutoPaused);
}

describe("regression: pause/resume progress accuracy", () => {
  let player;
  let nowSpy;
  let currentNow;

  beforeEach(() => {
    player = new AudioPlayer();
    player.currentTrack = { title: "t", audioUrl: "u", duration: 300 };
    currentNow = 1_000_000;
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => currentNow);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  const advance = (ms) => {
    currentNow += ms;
  };

  test("fresh Playing event starts the clock at 0", () => {
    emitPlaying(player);
    expect(player.getCurrentTime()).toBe(0);
  });

  test("while playing, getCurrentTime advances with wall clock", () => {
    emitPlaying(player);
    advance(5000);
    expect(player.getCurrentTime()).toBeCloseTo(5, 2);
    advance(10_000);
    expect(player.getCurrentTime()).toBeCloseTo(15, 2);
  });

  test("Paused freezes the clock; resume continues from the frozen value", () => {
    emitPlaying(player);
    advance(10_000);
    emitPaused(player);
    const frozenAt = player.getCurrentTime();
    expect(frozenAt).toBeCloseTo(10, 2);

    // Wall clock moves 30s while paused — getCurrentTime must not move.
    advance(30_000);
    expect(player.getCurrentTime()).toBeCloseTo(10, 2);

    // Resume: a fresh Playing event fires. Old bug: this reset to 0. Fixed: continues at 10s.
    emitPlaying(player);
    expect(player.getCurrentTime()).toBeCloseTo(10, 2);

    advance(5000);
    expect(player.getCurrentTime()).toBeCloseTo(15, 2);
  });

  test("spurious Playing event mid-playback does NOT reset progress (AutoPaused recovery)", () => {
    // Simulates @discordjs/voice briefly flipping AutoPaused → Playing during
    // a buffer underrun. In the old code each such flip zeroed the bar.
    emitPlaying(player);
    advance(20_000);
    expect(player.getCurrentTime()).toBeCloseTo(20, 2);

    // A second Playing fires without an intervening Paused — must be idempotent.
    emitPlaying(player);
    expect(player.getCurrentTime()).toBeCloseTo(20, 2);

    advance(3000);
    expect(player.getCurrentTime()).toBeCloseTo(23, 2);
  });

  test("multiple pause/resume cycles accumulate correctly", () => {
    emitPlaying(player);
    advance(5000);
    emitPaused(player);
    advance(10_000); // paused — not counted
    emitPlaying(player);
    advance(7000);
    emitPaused(player);
    advance(2000); // paused — not counted
    emitPlaying(player);
    advance(3000);

    // Played segments: 5s + 7s + 3s = 15s
    expect(player.getCurrentTime()).toBeCloseTo(15, 2);
  });

  test("skip() resets progress to 0 for the next track", async () => {
    player.queue = [
      { title: "a", audioUrl: "u1", duration: 300, resetRetry: jest.fn() },
      { title: "b", audioUrl: "u2", duration: 300, resetRetry: jest.fn() },
    ];
    player.currentIndex = 0;
    player.currentTrack = player.queue[0];
    player.voiceConnection = null; // bypass actual playback

    emitPlaying(player);
    advance(45_000);
    expect(player.getCurrentTime()).toBeCloseTo(45, 2);

    await player.skip();
    // After skip, before the new Playing fires, we're at 0 for the new track.
    expect(player.getCurrentTime()).toBe(0);
  });

  test("getCurrentTime clamps to track duration", () => {
    player.currentTrack = { title: "t", audioUrl: "u", duration: 10 };
    emitPlaying(player);
    advance(999_999);
    expect(player.getCurrentTime()).toBe(10);
  });

  test("getCurrentTime returns 0 with no current track", () => {
    player.currentTrack = null;
    emitPlaying(player);
    expect(player.getCurrentTime()).toBe(0);
  });

  test("AutoPaused freezes the clock; recovery continues without drift", () => {
    // Real-world cause: Bilibili CDN jitter / FFmpeg buffer underrun makes
    // @discordjs/voice transition Playing → AutoPaused → Playing. Before the
    // AutoPaused listener was added, wall-clock time during AutoPaused was
    // counted as if the song were playing, drifting the bar progressively
    // ahead of actual audio.
    emitPlaying(player);
    advance(30_000); // played 30s
    expect(player.getCurrentTime()).toBeCloseTo(30, 2);

    // Buffer underrun: AutoPaused fires. Audio is silent.
    emitAutoPaused(player);
    advance(5000); // 5s of silence — must NOT count as playback
    expect(player.getCurrentTime()).toBeCloseTo(30, 2);

    // Recovery: Playing fires again. Clock resumes from 30s.
    emitPlaying(player);
    advance(10_000);
    expect(player.getCurrentTime()).toBeCloseTo(40, 2);
  });

  test("multiple AutoPaused cycles do not accumulate drift", () => {
    // Simulates a flaky network with several brief stalls during a long song.
    emitPlaying(player);
    advance(60_000); // 60s real playback

    // 4 buffer underruns of 3s each: bar should still read 60s afterwards.
    for (let i = 0; i < 4; i++) {
      emitAutoPaused(player);
      advance(3000);
      emitPlaying(player);
    }
    expect(player.getCurrentTime()).toBeCloseTo(60, 2);

    advance(10_000); // 10s more real playback
    expect(player.getCurrentTime()).toBeCloseTo(70, 2);
  });

  test("_handleIdle's startTime-based retry math is NOT affected by pause-aware refactor", () => {
    // Sanity check on the comment-documented invariant: startTime still tracks
    // wall-clock including pause time, so _handleIdle won't think a paused song
    // that ended is a sub-3s early exit.
    emitPlaying(player);
    advance(1000);
    emitPaused(player);
    advance(60_000); // long pause
    // startTime was set at Playing and NOT cleared by Paused → elapsed wall-clock
    // from startTime is now 61s, well above the 3s retry threshold.
    expect(Date.now() - player.startTime).toBeGreaterThan(3000);
  });
});
