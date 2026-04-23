/**
 * Regression: ProgressTracker cadence + dedup.
 *
 * Bug history:
 *   v1 (issue #12 — "播放进度显示在运行一段时间后进度条会从每秒更新变成几秒更新一次"):
 *     setInterval(1000) + `updating` flag silently dropped ticks while an edit
 *     was in-flight. When Discord finally ACK'd we still waited a full 1s for
 *     the next interval — the bar visibly slowed from 1/s to 1 per 3–5s.
 *
 *   v2 (PR #36 fix attempt):
 *     Self-clocking setTimeout chain — schedule next tick AFTER previous edit
 *     resolves. Fixed the catch-up latency but still issued an edit every 1s
 *     regardless of whether the rendered bar had changed. That put us at
 *     Discord's 5-edits-per-5s per-channel ceiling: any side edit (button
 *     click, state change) exhausted the bucket and blocked subsequent ticks
 *     for 2-4s. Over long sessions the drift re-appeared.
 *
 *   v3 (this version — the current fix):
 *     - Content-hash dedup: render every tick but only call `message.edit`
 *       when the visible progress field/description actually changed. Keeps
 *       real edit rate at ~1 per bar-segment flip (~3-15s depending on
 *       track length) — well below Discord's limit.
 *     - Absolute-time scheduling: `nextTickAt += intervalMs` (not
 *       `Date.now() + intervalMs`), so a slow edit doesn't push every
 *       subsequent tick late. If we fall >1 interval behind, jump target
 *       to `now` to avoid a burst that would re-exhaust the rate-limit
 *       bucket.
 *     - Drop `components` from tick-edit payload — buttons don't change
 *       per-tick, and InterfaceUpdater's state-change path sends the full
 *       edit (with components) on real transitions.
 *
 * These tests drive the self-clocking loop with Jest fake timers and assert:
 *   - cadence holds when each tick has changed content
 *   - identical renders DO NOT result in a `message.edit` call (dedup)
 *   - a slow edit followed by catch-up produces an immediate next edit,
 *     not a full-interval wait
 *   - stopTracking cancels a pending tick
 *   - no `components` is sent on tick edits
 */

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// The embed mock returns content that varies with currentTime — so different
// `currentTime` values produce different signatures (no dedup), but repeating
// the same currentTime deduplicates.
jest.mock("../../src/ui/embeds", () => ({
  createNowPlayingEmbed: jest.fn((_track, opts) => ({
    description: `t=${opts?.currentTime ?? 0}`,
    fields: [
      {
        name: "⏱️ Progress",
        value: `bar-${opts?.currentTime ?? 0}`,
      },
    ],
  })),
}));

// Buttons module is no longer required by progress_tracker (we stopped
// sending components on tick edits). Still mock it so any legacy import
// wouldn't hit real discord.js.
jest.mock("../../src/ui/buttons", () => ({
  createPlaybackControls: jest.fn(() => []),
}));

const ProgressTracker = require("../../src/ui/progress_tracker");

function mkSessionManager() {
  const sessions = new Map();
  return {
    get(id) {
      if (!sessions.has(id)) sessions.set(id, {});
      return sessions.get(id);
    },
    sessions,
  };
}

function mkPlayerState(overrides = {}) {
  return {
    currentTrack: { title: "t", duration: 300, requestedBy: "u" },
    isPlaying: true,
    currentTime: 42,
    currentIndex: 0,
    queueLength: 1,
    loopMode: "off",
    hasPrevious: false,
    hasNext: false,
    ...overrides,
  };
}

describe("regression: ProgressTracker cadence + dedup", () => {
  let savedEnv;
  beforeAll(() => {
    savedEnv = process.env.NODE_ENV;
    // startTracking short-circuits to a one-shot update under NODE_ENV=test;
    // we need the self-clocking loop path for these assertions.
    process.env.NODE_ENV = "production";
  });
  afterAll(() => {
    process.env.NODE_ENV = savedEnv;
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("changed content on each tick: cadence holds at ~1s per edit", async () => {
    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);
    const edit = jest.fn().mockResolvedValue(undefined);

    // Each call to getState returns a DIFFERENT currentTime, so dedup never
    // fires and every tick produces a real edit.
    let t = 0;
    const getState = () => mkPlayerState({ currentTime: ++t });

    tracker.startTracking("g1", { edit }, getState);

    // First tick is 1000ms out. Advance through 4 ticks.
    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
    }

    // 4 ticks at 1s each, each with fresh content → 4 edits.
    // ±1 slack for microtask ordering across jest fake-timer flushes.
    expect(edit.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(edit.mock.calls.length).toBeLessThanOrEqual(5);

    tracker.stopTracking("g1");
  });

  test("dedup: identical content across ticks produces only ONE edit", async () => {
    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);
    const edit = jest.fn().mockResolvedValue(undefined);

    // Static currentTime — every render hashes to the same signature.
    const getState = () => mkPlayerState({ currentTime: 42 });

    tracker.startTracking("g1", { edit }, getState);

    // Advance through 5 ticks.
    for (let i = 0; i < 5; i++) {
      await jest.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
    }

    // Only the first tick should have called edit; subsequent ticks dedup.
    expect(edit).toHaveBeenCalledTimes(1);

    tracker.stopTracking("g1");
  });

  test("tick edit does NOT include `components` (only embeds)", async () => {
    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);
    const edit = jest.fn().mockResolvedValue(undefined);

    let t = 0;
    const getState = () => mkPlayerState({ currentTime: ++t });

    tracker.startTracking("g1", { edit }, getState);
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(edit).toHaveBeenCalled();
    const payload = edit.mock.calls[0][0];
    expect(payload).toHaveProperty("embeds");
    expect(payload).not.toHaveProperty("components");

    tracker.stopTracking("g1");
  });

  test("slow edit: next tick fires immediately after catch-up (absolute-time schedule)", async () => {
    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);

    let resolveSlowEdit;
    const slowEdit = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise((r) => (resolveSlowEdit = r)),
      )
      .mockResolvedValue(undefined);

    // Different currentTime each call so dedup never kicks in.
    let t = 0;
    const getState = () => mkPlayerState({ currentTime: ++t });

    tracker.startTracking("g1", { edit: slowEdit }, getState);

    // Kick off the first tick (scheduled 1000ms out).
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(slowEdit).toHaveBeenCalledTimes(1);

    // Simulate the edit taking 3 full seconds (Discord rate limit hold).
    await jest.advanceTimersByTimeAsync(3000);
    await Promise.resolve();
    expect(slowEdit).toHaveBeenCalledTimes(1);

    // Resolve the slow edit. Absolute-time schedule:
    //   nextTickAt was set to start+2000 after tick 1 began
    //   now = start+4000 → target < now - 1000 → jump to now, delay = 0
    resolveSlowEdit();
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(slowEdit).toHaveBeenCalledTimes(2);

    tracker.stopTracking("g1");
  });

  test("stopTracking cancels an in-flight schedule", async () => {
    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);
    const edit = jest.fn().mockResolvedValue(undefined);

    tracker.startTracking("g1", { edit }, () => mkPlayerState());
    tracker.stopTracking("g1");

    // No pending tick should remain.
    await jest.advanceTimersByTimeAsync(5000);
    await Promise.resolve();
    expect(edit).not.toHaveBeenCalled();
  });
});
