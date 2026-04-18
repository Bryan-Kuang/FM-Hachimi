import {
  reducePlayback,
  type PlaybackState,
  type PlaybackEvent,
  MAX_RETRIES,
} from "../playback_state";
import { Track, type TrackData } from "../track";
import { ErrorCode } from "../errors";

function mkTrack(nativeId: string, extra: Partial<TrackData> = {}): Track {
  return new Track({
    platform: "bilibili",
    nativeId,
    title: nativeId,
    duration: 180,
    audioUrl: `https://cdn/${nativeId}`,
    ...extra,
  });
}

const idle: PlaybackState = { kind: "idle" };

describe("reducer from idle", () => {
  test("PLAY_REQUESTED → connecting", () => {
    const a = mkTrack("a");
    const next = reducePlayback(idle, { type: "PLAY_REQUESTED", track: a });
    expect(next.kind).toBe("connecting");
    if (next.kind === "connecting") expect(next.track).toBe(a);
  });

  test("ignores irrelevant events from idle", () => {
    const irrelevant: PlaybackEvent[] = [
      { type: "VOICE_CONNECTED" },
      { type: "STREAM_STARTED", trackId: "x", at: new Date() },
      { type: "PAUSE_REQUESTED", positionMs: 100 },
      { type: "RESUME_REQUESTED" },
    ];
    for (const ev of irrelevant) {
      expect(reducePlayback(idle, ev)).toBe(idle);
    }
  });
});

describe("reducer from connecting", () => {
  const a = mkTrack("a");
  const connecting: PlaybackState = { kind: "connecting", track: a };

  test("VOICE_CONNECTED → loading", () => {
    const next = reducePlayback(connecting, { type: "VOICE_CONNECTED" });
    expect(next).toEqual({ kind: "loading", track: a });
  });

  test("VOICE_DISCONNECTED → error", () => {
    const err = { code: ErrorCode.VOICE_PERMISSION_DENIED, message: "denied", retryable: false };
    const next = reducePlayback(connecting, { type: "VOICE_DISCONNECTED", reason: err });
    expect(next).toEqual({ kind: "error", error: err, lastTrack: a });
  });

  test("PLAY_REQUESTED swaps target track while still connecting", () => {
    const b = mkTrack("b");
    const next = reducePlayback(connecting, { type: "PLAY_REQUESTED", track: b });
    expect(next).toEqual({ kind: "connecting", track: b });
  });
});

describe("reducer from loading", () => {
  const a = mkTrack("a");
  const loading: PlaybackState = { kind: "loading", track: a };
  const now = new Date("2025-01-01T00:00:00Z");

  test("STREAM_STARTED with matching trackId → playing", () => {
    const next = reducePlayback(loading, { type: "STREAM_STARTED", trackId: a.id, at: now });
    expect(next).toEqual({ kind: "playing", track: a, startedAt: now });
  });

  test("STREAM_STARTED with stale trackId is ignored", () => {
    const next = reducePlayback(loading, { type: "STREAM_STARTED", trackId: "stale:XX", at: now });
    expect(next).toBe(loading);
  });

  test("URL_REFRESHED swaps track in loading state", () => {
    const refreshed = a.withRefreshedUrl("https://cdn/new");
    const next = reducePlayback(loading, { type: "URL_REFRESHED", track: refreshed });
    if (next.kind !== "loading") throw new Error("expected loading");
    expect(next.track.audioUrl).toBe("https://cdn/new");
  });

  test("STREAM_ENDED with cdn_failure → retrying(cdn)", () => {
    const next = reducePlayback(loading, {
      type: "STREAM_ENDED",
      trackId: a.id,
      reason: "cdn_failure",
      playedMs: 0,
    });
    if (next.kind !== "retrying") throw new Error("expected retrying");
    expect(next.reason).toBe("cdn");
  });

  test("SKIP_REQUESTED in loading redirects target", () => {
    const b = mkTrack("b");
    const next = reducePlayback(loading, { type: "SKIP_REQUESTED", target: b });
    expect(next).toEqual({ kind: "loading", track: b });
  });
});

describe("reducer from playing — the central race fix", () => {
  const a = mkTrack("a");
  const b = mkTrack("b");
  const startedAt = new Date("2025-01-01T00:00:00Z");
  const playing: PlaybackState = { kind: "playing", track: a, startedAt };

  test("SKIP_REQUESTED → loading(next) — subsequent stale STREAM_ENDED is discarded", () => {
    // User hits /skip mid-playback
    const afterSkip = reducePlayback(playing, { type: "SKIP_REQUESTED", target: b });
    expect(afterSkip).toEqual({ kind: "loading", track: b });

    // Old track's Idle event arrives *after* the skip
    const stale: PlaybackEvent = {
      type: "STREAM_ENDED",
      trackId: a.id,
      reason: "complete",
      playedMs: 30000,
    };
    const final = reducePlayback(afterSkip, stale);
    // Should NOT advance or double-skip — state stays as loading(b)
    expect(final).toBe(afterSkip);
  });

  test("STREAM_ENDED(complete, long) → idle", () => {
    const next = reducePlayback(playing, {
      type: "STREAM_ENDED",
      trackId: a.id,
      reason: "complete",
      playedMs: 60000,
    });
    expect(next).toEqual({ kind: "idle" });
  });

  test("STREAM_ENDED(complete, <3s) → retrying(short_playback)", () => {
    const next = reducePlayback(playing, {
      type: "STREAM_ENDED",
      trackId: a.id,
      reason: "complete",
      playedMs: 500,
    });
    if (next.kind !== "retrying") throw new Error("expected retrying");
    expect(next.reason).toBe("short_playback");
  });

  test("STREAM_ENDED(cdn_failure) → retrying(cdn)", () => {
    const next = reducePlayback(playing, {
      type: "STREAM_ENDED",
      trackId: a.id,
      reason: "cdn_failure",
      playedMs: 500,
    });
    if (next.kind !== "retrying") throw new Error("expected retrying");
    expect(next.reason).toBe("cdn");
  });

  test("STREAM_ENDED with mismatched trackId ignored", () => {
    const next = reducePlayback(playing, {
      type: "STREAM_ENDED",
      trackId: "stale:XX",
      reason: "complete",
      playedMs: 60000,
    });
    expect(next).toBe(playing);
  });

  test("PAUSE_REQUESTED → paused", () => {
    const next = reducePlayback(playing, { type: "PAUSE_REQUESTED", positionMs: 5000 });
    if (next.kind !== "paused") throw new Error("expected paused");
    expect(next.positionMs).toBe(5000);
    expect(next.track).toBe(a);
  });
});

describe("reducer from paused", () => {
  const a = mkTrack("a");
  const paused: PlaybackState = {
    kind: "paused",
    track: a,
    pausedAt: new Date(),
    positionMs: 5000,
  };

  test("RESUME_REQUESTED → playing", () => {
    const next = reducePlayback(paused, { type: "RESUME_REQUESTED" });
    expect(next.kind).toBe("playing");
  });

  test("SKIP_REQUESTED → loading(target)", () => {
    const b = mkTrack("b");
    const next = reducePlayback(paused, { type: "SKIP_REQUESTED", target: b });
    expect(next).toEqual({ kind: "loading", track: b });
  });
});

describe("reducer retry budget", () => {
  test("retries exhaust after MAX_RETRIES — beginRetry returns error", () => {
    // Track arrived already maxed out from a previous retry cycle
    const t = mkTrack("a", { retryCount: MAX_RETRIES });
    const playing: PlaybackState = { kind: "playing", track: t, startedAt: new Date() };
    const next = reducePlayback(playing, {
      type: "STREAM_ENDED",
      trackId: t.id,
      reason: "cdn_failure",
      playedMs: 200,
    });
    if (next.kind !== "error") throw new Error(`expected error, got ${next.kind}`);
    expect(next.error.code).toBe(ErrorCode.CDN_UNREACHABLE);
  });

  test("retrying + URL_REFRESHED → loading", () => {
    const t = mkTrack("a");
    const retrying: PlaybackState = { kind: "retrying", track: t, reason: "cdn", attempt: 1 };
    const refreshed = t.withRefreshedUrl("https://cdn/new");
    const next = reducePlayback(retrying, { type: "URL_REFRESHED", track: refreshed });
    expect(next).toEqual({ kind: "loading", track: refreshed });
  });
});

describe("reducer FATAL_ERROR from any state", () => {
  const kinds: PlaybackState[] = [
    idle,
    { kind: "connecting", track: mkTrack("a") },
    { kind: "loading", track: mkTrack("a") },
    { kind: "playing", track: mkTrack("a"), startedAt: new Date() },
    { kind: "paused", track: mkTrack("a"), pausedAt: new Date(), positionMs: 0 },
    { kind: "retrying", track: mkTrack("a"), reason: "cdn", attempt: 1 },
  ];
  const err = { code: ErrorCode.FFMPEG_NOT_INSTALLED, message: "missing", retryable: false };

  test.each(kinds.map((s) => [s.kind, s]))("from %s → error", (_, start) => {
    const next = reducePlayback(start, { type: "FATAL_ERROR", error: err });
    expect(next.kind).toBe("error");
  });
});

describe("reducer from error — only PLAY_REQUESTED reopens", () => {
  const errState: PlaybackState = {
    kind: "error",
    error: { code: ErrorCode.CDN_UNREACHABLE, message: "x", retryable: false },
    lastTrack: null,
  };

  test("PLAY_REQUESTED → connecting", () => {
    const a = mkTrack("a");
    const next = reducePlayback(errState, { type: "PLAY_REQUESTED", track: a });
    expect(next).toEqual({ kind: "connecting", track: a });
  });

  test("STREAM_ENDED ignored from error", () => {
    const next = reducePlayback(errState, {
      type: "STREAM_ENDED",
      trackId: "x",
      reason: "complete",
      playedMs: 10,
    });
    expect(next).toBe(errState);
  });
});

describe("reducer never throws on any event × state combination", () => {
  const states: PlaybackState[] = [
    idle,
    { kind: "connecting", track: mkTrack("a") },
    { kind: "loading", track: mkTrack("a") },
    { kind: "playing", track: mkTrack("a"), startedAt: new Date() },
    { kind: "paused", track: mkTrack("a"), pausedAt: new Date(), positionMs: 1000 },
    { kind: "retrying", track: mkTrack("a"), reason: "cdn", attempt: 1 },
    { kind: "error", error: { code: ErrorCode.UNKNOWN, message: "x", retryable: false }, lastTrack: null },
  ];
  const events: PlaybackEvent[] = [
    { type: "PLAY_REQUESTED", track: mkTrack("b") },
    { type: "VOICE_CONNECTED" },
    { type: "VOICE_DISCONNECTED", reason: { code: ErrorCode.UNKNOWN, message: "x", retryable: false } },
    { type: "STREAM_STARTED", trackId: "b", at: new Date() },
    { type: "STREAM_ENDED", trackId: "b", reason: "complete", playedMs: 100 },
    { type: "SKIP_REQUESTED", target: mkTrack("c") },
    { type: "PAUSE_REQUESTED", positionMs: 100 },
    { type: "RESUME_REQUESTED" },
    { type: "URL_REFRESHED", track: mkTrack("d") },
    { type: "FATAL_ERROR", error: { code: ErrorCode.UNKNOWN, message: "x", retryable: false } },
  ];

  for (const s of states) {
    for (const e of events) {
      test(`${s.kind} × ${e.type} does not throw`, () => {
        expect(() => reducePlayback(s, e)).not.toThrow();
      });
    }
  }
});
