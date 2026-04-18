/**
 * Translates pure state transitions into the real-world side effects
 * (voice connect, yt-dlp spawn, FFmpeg teardown, UI edits, …).
 *
 * In Phase 1 this class is a *skeleton* — it knows the shape of the work
 * but doesn't call any Infra yet, because Phase 1 is shadow-only. Phase 2
 * will fill in the dependencies (AudioStreamer, ExtractorRegistry) and
 * Phase 3 will wire it into the command layer as the new playback pipeline.
 *
 * Design rule: this file is the ONLY place where reducer state transitions
 * become IO. Tests can observe what IO would fire by injecting a fake
 * effects adapter instead of the real one.
 */

import type { PlaybackState, PlaybackEvent } from "../domain/playback_state";
import type { Track } from "../domain/track";

/**
 * What the side-effect layer needs from its environment. Keeping this as
 * a narrow interface lets Phase 2 swap in DiscordVoiceStreamer / real
 * extractors, and Phase 1 tests supply a trivial mock.
 */
export interface SideEffectDeps {
  connectVoice(track: Track): Promise<void>;
  startStream(track: Track): Promise<void>;
  stopStream(): Promise<void>;
  refreshUrl(track: Track): Promise<Track>;
  /** Invoked whenever a transition would trigger a retry; lets the orchestrator schedule the next attempt. */
  scheduleRetry?(track: Track, attempt: number): void;
  /** Optional hook to report dropped/skipped events for observability. */
  onNoOp?(prevKind: string, event: PlaybackEvent): void;
}

export type EffectKind =
  | "connect_voice"
  | "start_stream"
  | "stop_stream"
  | "refresh_url"
  | "schedule_retry"
  | "noop";

export interface EffectPlan {
  kind: EffectKind;
  track?: Track;
  attempt?: number;
}

/**
 * Pure function from (prev, next) state pair → which side effect to run.
 * Split out for unit testing; the executor's job then reduces to
 * "match on kind → call the matching dep".
 */
export function planEffect(
  prev: PlaybackState,
  next: PlaybackState,
): EffectPlan {
  // No state change — nothing to do.
  if (prev === next) return { kind: "noop" };

  if (next.kind === "connecting" && prev.kind !== "connecting") {
    return { kind: "connect_voice", track: next.track };
  }

  if (next.kind === "loading" && (prev.kind === "connecting" || prev.kind === "retrying")) {
    return { kind: "start_stream", track: next.track };
  }

  // Loading swapped target (e.g. SKIP while loading, URL_REFRESHED)
  if (
    next.kind === "loading" &&
    prev.kind === "loading" &&
    prev.track.id !== next.track.id
  ) {
    return { kind: "start_stream", track: next.track };
  }

  if (next.kind === "retrying") {
    return { kind: "schedule_retry", track: next.track, attempt: next.attempt };
  }

  if (prev.kind !== "idle" && next.kind === "idle") {
    return { kind: "stop_stream" };
  }

  if (next.kind === "error" && prev.kind !== "error") {
    return { kind: "stop_stream" };
  }

  return { kind: "noop" };
}

/**
 * Tiny executor that pairs reducer output with IO. Intentionally very
 * thin so the rule-shape is easy to audit: `planEffect` decides what,
 * the deps decide how.
 */
export class PlaybackSideEffects {
  constructor(private readonly deps: SideEffectDeps) {}

  async apply(prev: PlaybackState, next: PlaybackState, event: PlaybackEvent): Promise<void> {
    const plan = planEffect(prev, next);
    switch (plan.kind) {
      case "connect_voice":
        if (plan.track) await this.deps.connectVoice(plan.track);
        return;
      case "start_stream":
        if (plan.track) await this.deps.startStream(plan.track);
        return;
      case "stop_stream":
        await this.deps.stopStream();
        return;
      case "refresh_url":
        if (plan.track) await this.deps.refreshUrl(plan.track);
        return;
      case "schedule_retry":
        if (plan.track && plan.attempt !== undefined) {
          this.deps.scheduleRetry?.(plan.track, plan.attempt);
        }
        return;
      case "noop":
        this.deps.onNoOp?.(prev.kind, event);
        return;
    }
  }
}
