/**
 * Regression: ProgressTracker must stay on ~1s cadence even when individual
 * Discord `message.edit` calls are slow.
 *
 * Old implementation:
 *   setInterval(() => updateProgress(), 1000)
 *   + `updating` flag inside updateProgress to drop overlapping ticks.
 *
 * Symptom (issue #12):
 *   Every time Discord rate-limited our edit, the pending edit took 2–6s.
 *   While in-flight, subsequent 1s interval ticks were dropped silently.
 *   When Discord finally ACK'd, we had to wait a full second for the NEXT
 *   interval tick — so the bar visibly dropped from 1/s to 1 per 3–5s.
 *
 * Fix: self-clocking setTimeout chain. The next tick is scheduled only after
 *   the previous `updateProgress` resolves, at `max(0, 1000 - elapsed)`.
 *   Fast path keeps the 1s cadence. Slow path catches up immediately.
 *
 * This test uses Jest's fake timers to drive the chain and asserts:
 *   - tick count is correct on the fast path
 *   - after a slow edit, the next tick fires at delay=0 (immediately)
 */

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock("../../src/ui/embeds", () => ({
  createNowPlayingEmbed: jest.fn(() => ({ embed: "stub" })),
}));
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

describe("regression: ProgressTracker self-clocking cadence", () => {
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

  test("fast edits: cadence holds at ~1s per tick", async () => {
    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);
    const edit = jest.fn().mockResolvedValue(undefined);

    tracker.startTracking("g1", { edit }, () => mkPlayerState());

    // The first tick is scheduled 1000ms out. Advance through 4 ticks.
    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(1000);
      // Drain any microtasks queued after the edit resolves (scheduleNext).
      await Promise.resolve();
    }

    // 4 ticks at 1s each → 4 edits. ±1 slack for microtask ordering.
    expect(edit.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(edit.mock.calls.length).toBeLessThanOrEqual(5);

    tracker.stopTracking("g1");
  });

  test("slow edit: next tick fires immediately after it settles (no full-1s wait)", async () => {
    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);

    let resolveSlowEdit;
    const slowEdit = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise((r) => (resolveSlowEdit = r)),
      )
      .mockResolvedValue(undefined);

    tracker.startTracking("g1", { edit: slowEdit }, () => mkPlayerState());

    // Kick off the first tick (scheduled 1000ms out).
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(slowEdit).toHaveBeenCalledTimes(1);

    // Simulate the edit taking 3 full seconds (Discord rate limit).
    await jest.advanceTimersByTimeAsync(3000);
    await Promise.resolve();
    // While the edit is pending, no new tick has fired — correct: the
    // self-clocking loop schedules the next tick AFTER the await resolves.
    expect(slowEdit).toHaveBeenCalledTimes(1);

    // Resolve the slow edit. Self-clocking loop computes:
    //   elapsed = 3000ms, nextDelay = max(0, 1000 - 3000) = 0
    // So the next tick must fire on the very next timer flush, not 1s later.
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
