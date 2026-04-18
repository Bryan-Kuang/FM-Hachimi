import { planEffect, PlaybackSideEffects, type SideEffectDeps } from "../playback_side_effects";
import type { PlaybackState } from "../../domain/playback_state";
import { Track } from "../../domain/track";
import { ErrorCode } from "../../domain/errors";

function mkTrack(id: string): Track {
  return new Track({ platform: "bilibili", nativeId: id, title: id, duration: 60, audioUrl: `https://cdn/${id}` });
}

describe("planEffect", () => {
  const a = mkTrack("a");
  const b = mkTrack("b");

  test("noop when state is unchanged by reference", () => {
    const s: PlaybackState = { kind: "idle" };
    expect(planEffect(s, s)).toEqual({ kind: "noop" });
  });

  test("idle → connecting ⇒ connect_voice", () => {
    expect(
      planEffect({ kind: "idle" }, { kind: "connecting", track: a }),
    ).toEqual({ kind: "connect_voice", track: a });
  });

  test("connecting → loading ⇒ start_stream", () => {
    expect(
      planEffect({ kind: "connecting", track: a }, { kind: "loading", track: a }),
    ).toEqual({ kind: "start_stream", track: a });
  });

  test("loading → loading with different track ⇒ start_stream", () => {
    expect(
      planEffect({ kind: "loading", track: a }, { kind: "loading", track: b }),
    ).toEqual({ kind: "start_stream", track: b });
  });

  test("anything → retrying ⇒ schedule_retry", () => {
    expect(
      planEffect(
        { kind: "playing", track: a, startedAt: new Date() },
        { kind: "retrying", track: a, reason: "cdn", attempt: 1 },
      ),
    ).toEqual({ kind: "schedule_retry", track: a, attempt: 1 });
  });

  test("playing → idle ⇒ stop_stream", () => {
    expect(
      planEffect(
        { kind: "playing", track: a, startedAt: new Date() },
        { kind: "idle" },
      ),
    ).toEqual({ kind: "stop_stream" });
  });

  test("non-error → error ⇒ stop_stream", () => {
    expect(
      planEffect(
        { kind: "playing", track: a, startedAt: new Date() },
        {
          kind: "error",
          error: { code: ErrorCode.UNKNOWN, message: "x", retryable: false },
          lastTrack: a,
        },
      ),
    ).toEqual({ kind: "stop_stream" });
  });
});

describe("PlaybackSideEffects executor", () => {
  function mkDeps(): SideEffectDeps & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      connectVoice: async (t) => { calls.push(`connect:${t.id}`); },
      startStream: async (t) => { calls.push(`start:${t.id}`); },
      stopStream: async () => { calls.push("stop"); },
      refreshUrl: async (t) => { calls.push(`refresh:${t.id}`); return t; },
      scheduleRetry: (t, attempt) => { calls.push(`retry:${t.id}:${attempt}`); },
      onNoOp: (prev) => { calls.push(`noop:${prev}`); },
    };
  }

  test("dispatches to the matching dep based on planned effect", async () => {
    const deps = mkDeps();
    const exec = new PlaybackSideEffects(deps);
    const a = mkTrack("a");

    await exec.apply({ kind: "idle" }, { kind: "connecting", track: a }, {
      type: "PLAY_REQUESTED",
      track: a,
    });
    await exec.apply(
      { kind: "connecting", track: a },
      { kind: "loading", track: a },
      { type: "VOICE_CONNECTED" },
    );
    await exec.apply(
      { kind: "playing", track: a, startedAt: new Date() },
      { kind: "retrying", track: a, reason: "cdn", attempt: 1 },
      { type: "STREAM_ENDED", trackId: a.id, reason: "cdn_failure", playedMs: 100 },
    );
    expect(deps.calls).toEqual([
      "connect:bilibili:a",
      "start:bilibili:a",
      "retry:bilibili:a:1",
    ]);
  });

  test("noop delivers onNoOp hook with previous kind", async () => {
    const deps = mkDeps();
    const exec = new PlaybackSideEffects(deps);
    const s: PlaybackState = { kind: "idle" };
    await exec.apply(s, s, { type: "VOICE_CONNECTED" });
    expect(deps.calls).toEqual(["noop:idle"]);
  });
});
