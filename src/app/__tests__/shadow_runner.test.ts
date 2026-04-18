import { ShadowRunner, createShadowRunner } from "../shadow_runner";
import { Track } from "../../domain/track";
import type { PlaybackState, PlaybackEvent } from "../../domain/playback_state";
import { reset as resetMetrics, snapshot } from "../../infra/observability/metrics";

function mkTrack(id: string): Track {
  return new Track({ platform: "bilibili", nativeId: id, title: id, duration: 60, audioUrl: `https://cdn/${id}` });
}

function mkLogger() {
  return {
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
  };
}

describe("ShadowRunner — disabled by default", () => {
  beforeEach(() => resetMetrics());

  test("dispatch is a no-op when disabled", () => {
    const logger = mkLogger();
    const sr = new ShadowRunner({ enabled: false, guildId: "g1", logger });
    const next = sr.dispatch({ type: "PLAY_REQUESTED", track: mkTrack("a") });
    expect(next).toEqual({ kind: "idle" });
    expect(sr.getState()).toEqual({ kind: "idle" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("compareOutcome is a no-op when disabled", () => {
    const logger = mkLogger();
    const sr = new ShadowRunner({ enabled: false, guildId: "g1", logger });
    sr.compareOutcome({ kind: "retry" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("createShadowRunner returns disabled runner when env flag is unset", () => {
    const sr = createShadowRunner("g1", mkLogger(), {});
    expect(sr.enabled).toBe(false);
  });

  test("createShadowRunner enables when SHADOW_MODE_ENABLED=true", () => {
    const sr = createShadowRunner("g1", mkLogger(), { SHADOW_MODE_ENABLED: "true" });
    expect(sr.enabled).toBe(true);
  });
});

describe("ShadowRunner — enabled", () => {
  beforeEach(() => resetMetrics());

  test("dispatch advances state through the reducer", () => {
    const logger = mkLogger();
    const sr = new ShadowRunner({ enabled: true, guildId: "g1", logger });
    const a = mkTrack("a");
    sr.dispatch({ type: "PLAY_REQUESTED", track: a });
    expect(sr.getState().kind).toBe("connecting");
    sr.dispatch({ type: "VOICE_CONNECTED" });
    expect(sr.getState().kind).toBe("loading");
    sr.dispatch({ type: "STREAM_STARTED", trackId: a.id, at: new Date() });
    expect(sr.getState().kind).toBe("playing");
  });

  test("records shadow_transition_total metric per transition", () => {
    const logger = mkLogger();
    const sr = new ShadowRunner({ enabled: true, guildId: "g1", logger });
    sr.dispatch({ type: "PLAY_REQUESTED", track: mkTrack("a") });
    const snap = snapshot();
    expect(snap.counters.shadow_transition_total).toBeDefined();
  });

  test("compareOutcome warns on divergence", () => {
    const logger = mkLogger();
    const sr = new ShadowRunner({ enabled: true, guildId: "g1", logger });
    sr.dispatch({ type: "PLAY_REQUESTED", track: mkTrack("a") });
    // Shadow is in `connecting`, mapped outcome = advance_to_next
    sr.compareOutcome({ kind: "retry" }, "trace123");
    expect(logger.warn).toHaveBeenCalledWith(
      "shadow divergence",
      expect.objectContaining({
        guildId: "g1",
        traceId: "trace123",
        predicted: "advance_to_next",
        actual: { kind: "retry" },
      }),
    );
  });

  test("compareOutcome is silent when prediction matches", () => {
    const logger = mkLogger();
    const sr = new ShadowRunner({ enabled: true, guildId: "g1", logger });
    sr.compareOutcome({ kind: "idle" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("observer callbacks fire without affecting state", () => {
    const logger = mkLogger();
    const onTransition = jest.fn();
    const onDivergence = jest.fn();
    const sr = new ShadowRunner({
      enabled: true,
      guildId: "g1",
      logger,
      observer: { onTransition, onDivergence },
    });
    sr.dispatch({ type: "PLAY_REQUESTED", track: mkTrack("a") });
    expect(onTransition).toHaveBeenCalled();
    sr.compareOutcome({ kind: "retry" });
    expect(onDivergence).toHaveBeenCalled();
  });

  test("reset returns to idle", () => {
    const logger = mkLogger();
    const sr = new ShadowRunner({ enabled: true, guildId: "g1", logger });
    sr.dispatch({ type: "PLAY_REQUESTED", track: mkTrack("a") });
    sr.reset();
    expect(sr.getState()).toEqual({ kind: "idle" });
  });

  test("observer exceptions are swallowed", () => {
    const logger = mkLogger();
    const sr = new ShadowRunner({
      enabled: true,
      guildId: "g1",
      logger,
      observer: {
        onTransition: () => {
          throw new Error("boom");
        },
      },
    });
    expect(() => sr.dispatch({ type: "PLAY_REQUESTED", track: mkTrack("a") })).not.toThrow();
  });
});

describe("ShadowRunner — the 'stale Idle after skip' race", () => {
  beforeEach(() => resetMetrics());

  test("predicts loading(next) — the stale STREAM_ENDED is discarded, no divergence", () => {
    const logger = mkLogger();
    const sr = new ShadowRunner({ enabled: true, guildId: "g1", logger });
    const a = mkTrack("a");
    const b = mkTrack("b");

    // Drive shadow to `playing(a)`
    sr.dispatch({ type: "PLAY_REQUESTED", track: a });
    sr.dispatch({ type: "VOICE_CONNECTED" });
    sr.dispatch({ type: "STREAM_STARTED", trackId: a.id, at: new Date() });

    // User hits skip — shadow should move to `loading(b)`
    sr.dispatch({ type: "SKIP_REQUESTED", target: b });
    const afterSkip: PlaybackState = sr.getState();
    expect(afterSkip).toEqual({ kind: "loading", track: b });

    // Stale Idle arrives for the old track — shadow must discard it
    const stale: PlaybackEvent = { type: "STREAM_ENDED", trackId: a.id, reason: "complete", playedMs: 30000 };
    const afterStale = sr.dispatch(stale);
    expect(afterStale).toBe(afterSkip); // reference-equal = reducer returned prev unchanged

    // And when the real AudioPlayer reports "advance_to_next" after its own navigation,
    // the shadow agrees (loading → advance_to_next).
    sr.compareOutcome({ kind: "advance_to_next" });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
