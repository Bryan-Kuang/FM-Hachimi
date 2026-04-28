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

  // Helper: inject a ready-to-use tracker state object directly into the
  // session, bypassing startTracking()'s timer scheduling. This lets these
  // tests exercise updateProgress() in isolation without racing against a
  // background setTimeout chain.
  function injectTracker(sm, guildId, { edit, getState, overrides = {} }) {
    const state = {
      message: { edit },
      guildId,
      getPlayerState: getState,
      stopped: false,
      timer: null,
      lastSignature: null,
      nextTickAt: Date.now() + 1000,
      consecutiveSlowEdits: 0,
      cooldownUntil: 0,
      slowEditThresholdMs: 1500,
      slowEditStreakLimit: 3,
      cooldownMs: 5000,
      cooldownStreak: 0,
      lastCooldownEndedAt: 0,
      ...overrides,
    };
    sm.get(guildId).progressTracker = state;
    return state;
  }

  test("back-pressure cooldown: slow-edit streak sets cooldown window", async () => {
    // Simulates the user-reported failure:
    //   "bar refreshed every second at the start, then after a while
    //    started refreshing every few seconds."
    // Root cause: once Discord's rate-limit bucket is drained, each
    // `message.edit()` takes >1s, the absolute-time scheduler keeps
    // scheduling delay=0 ticks, and we pile new edits into an already-
    // stuck queue — unbounded runaway.
    //
    // Defense: after N consecutive slow edits we stop sending any edit
    // for `cooldownMs`, letting the bucket and queue drain.
    //
    // White-box test: drive updateProgress() directly and assert the
    // state-machine fields. We need real wall-clock timing for the edit
    // latency measurement, but bypass startTracking()'s background loop
    // so it doesn't interfere.
    jest.useRealTimers();

    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);

    // Each edit takes 2000ms — well above the 1500ms slow threshold.
    const slowEdit = jest
      .fn()
      .mockImplementation(
        () => new Promise((r) => setTimeout(r, 2000)),
      );

    let t = 0;
    const getState = () => mkPlayerState({ currentTime: ++t });
    const trackerState = injectTracker(sm, "g1", {
      edit: slowEdit,
      getState,
    });

    // Drive 3 direct updateProgress calls — each records a slow edit.
    // The 3rd hits the streak limit and arms cooldown.
    await tracker.updateProgress("g1");
    expect(trackerState.consecutiveSlowEdits).toBe(1);
    expect(trackerState.cooldownUntil).toBe(0);

    await tracker.updateProgress("g1");
    expect(trackerState.consecutiveSlowEdits).toBe(2);
    expect(trackerState.cooldownUntil).toBe(0);

    await tracker.updateProgress("g1");
    // After hitting the streak limit: streak resets, cooldown armed.
    expect(trackerState.consecutiveSlowEdits).toBe(0);
    expect(trackerState.cooldownUntil).toBeGreaterThan(Date.now());

    // While cooldown is active, updateProgress must NOT call edit again.
    const editsBefore = slowEdit.mock.calls.length;
    await tracker.updateProgress("g1");
    await tracker.updateProgress("g1");
    expect(slowEdit.mock.calls.length).toBe(editsBefore);

    jest.useFakeTimers(); // restore for afterEach contract
  }, 15000);

  test("cooldown recovers: after cooldownUntil passes, edits resume", async () => {
    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);

    const fastEdit = jest.fn().mockResolvedValue(undefined);
    let t = 0;
    const getState = () => mkPlayerState({ currentTime: ++t });
    const trackerState = injectTracker(sm, "g1", {
      edit: fastEdit,
      getState,
    });

    // A past-deadline cooldown is inactive — updateProgress should proceed.
    trackerState.cooldownUntil = Date.now() - 1;
    await tracker.updateProgress("g1");
    expect(fastEdit).toHaveBeenCalledTimes(1);

    // A future-deadline cooldown IS active — updateProgress must skip.
    trackerState.cooldownUntil = Date.now() + 10_000;
    await tracker.updateProgress("g1");
    expect(fastEdit).toHaveBeenCalledTimes(1);
  });

  test("slow-edit counter resets on a fast edit (one-off latency spike is noise)", async () => {
    // A single slow edit (e.g. transient network jitter) should NOT
    // latch us toward cooldown. The streak must reset on any fast edit.
    jest.useRealTimers();

    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);

    let call = 0;
    const edit = jest.fn().mockImplementation(() => {
      call += 1;
      // alternate: slow, fast, slow, fast — streak never reaches 3
      if (call % 2 === 1) return new Promise((r) => setTimeout(r, 2000));
      return Promise.resolve();
    });

    let t = 0;
    const getState = () => mkPlayerState({ currentTime: ++t });
    const trackerState = injectTracker(sm, "g1", { edit, getState });

    for (let i = 0; i < 6; i++) {
      await tracker.updateProgress("g1");
    }

    // After 6 alternating edits, streak should be 0 or 1, never hit 3.
    expect(trackerState.consecutiveSlowEdits).toBeLessThan(3);
    expect(trackerState.cooldownUntil).toBe(0);

    jest.useFakeTimers();
  }, 20000);

  test("dedup-skip resets consecutiveSlowEdits (skipped tick is not 'slow')", async () => {
    // Bug history: a dedup-skipped tick used to leave `consecutiveSlowEdits`
    // untouched, so the pattern (slow, slow, dedup-skip, slow) would trip the
    // 3-strike streak detector even though only 3 of those 4 ticks actually
    // pressured Discord's rate-limit bucket. The skipped tick didn't hit
    // Discord at all and shouldn't count toward back-pressure evidence.
    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);

    const edit = jest.fn().mockResolvedValue(undefined);
    // Static currentTime so signature is stable across calls.
    const getState = () => mkPlayerState({ currentTime: 42 });
    const trackerState = injectTracker(sm, "g1", { edit, getState });

    // Pretend two prior slow edits already happened.
    trackerState.consecutiveSlowEdits = 2;

    // First call seeds lastSignature (edit fires; "fast" path resets streak
    // — that's the normal post-edit behavior).
    await tracker.updateProgress("g1");
    expect(edit).toHaveBeenCalledTimes(1);
    expect(trackerState.consecutiveSlowEdits).toBe(0);

    // Re-arm the streak; next call should hit dedup (signature unchanged) and
    // STILL reset the counter — that's the regression.
    trackerState.consecutiveSlowEdits = 2;
    await tracker.updateProgress("g1");
    expect(edit).toHaveBeenCalledTimes(1); // dedup-skipped
    expect(trackerState.consecutiveSlowEdits).toBe(0);
  });

  test("chained cooldowns back off geometrically (5s → 10s → 20s, capped 4×)", async () => {
    // Bug surface: when Discord's rate-limit bucket genuinely stays drained,
    // a fixed 5s cooldown ends and we immediately resume 1s edits, which
    // trip the streak detector again within seconds. Without backoff we
    // ping-pong forever between 5s freeze and 3 slow edits. Geometric
    // backoff (5 → 10 → 20s, capped at 4×) gives the bucket real time to
    // drain on persistently slow channels.
    jest.useRealTimers();

    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);

    const slowEdit = jest
      .fn()
      .mockImplementation(() => new Promise((r) => setTimeout(r, 2000)));

    let t = 0;
    const getState = () => mkPlayerState({ currentTime: ++t });
    // Widen cooldownMs to 30s so the ~6s of real time spent driving 3 slow
    // edits stays comfortably inside the "recent cooldown" chain window.
    // (Real-time test: each slow edit blocks 2s, which would exceed a 5s
    // window before the third edit lands.)
    const trackerState = injectTracker(sm, "g1", {
      edit: slowEdit,
      getState,
      overrides: { cooldownMs: 30_000 },
    });

    // Pre-condition: a previous cooldown ended just now → next cooldown
    // should be the SECOND in a chain.
    trackerState.cooldownStreak = 1;
    trackerState.lastCooldownEndedAt = Date.now();

    // Drive 3 slow edits to arm the next cooldown.
    await tracker.updateProgress("g1");
    await tracker.updateProgress("g1");
    const beforeArm = Date.now();
    await tracker.updateProgress("g1");

    // 2nd in chain → multiplier 2 → 60s cooldown (30s base × 2×).
    expect(trackerState.cooldownStreak).toBe(2);
    // cooldownUntil is set to `Date.now() + cooldownDuration` AT arm time,
    // which is ~2s (one slow edit) after `beforeArm`. So the gap from
    // beforeArm spans ~62s in the happy path, with real-timer jitter on top.
    const gapFromBeforeArm = trackerState.cooldownUntil - beforeArm;
    expect(gapFromBeforeArm).toBeGreaterThanOrEqual(60_000);
    expect(gapFromBeforeArm).toBeLessThanOrEqual(65_000);

    jest.useFakeTimers();
  }, 20000);

  test("cooldownStreak resets after a sustained healthy window", async () => {
    // After the channel recovers (no cooldown for ≥cooldownMs after the
    // previous one ended), the next isolated cooldown should start fresh
    // at 1× — otherwise a flaky 30-min stretch would permanently pin us
    // at the 4× cap even after the network calmed down.
    const sm = mkSessionManager();
    const tracker = new ProgressTracker(sm);

    const fastEdit = jest.fn().mockResolvedValue(undefined);
    const getState = () => mkPlayerState({ currentTime: 1 });
    const trackerState = injectTracker(sm, "g1", {
      edit: fastEdit,
      getState,
    });

    // Pre-condition: previous cooldown ended well outside the cooldownMs
    // healthy-window threshold (cooldownMs is 5000ms in our tracker).
    trackerState.cooldownStreak = 3;
    trackerState.lastCooldownEndedAt = Date.now() - 60_000;

    // A healthy fast edit must wipe the chain counter.
    await tracker.updateProgress("g1");
    expect(fastEdit).toHaveBeenCalledTimes(1);
    expect(trackerState.cooldownStreak).toBe(0);
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
