/**
 * Pure playback state machine.
 *
 * Models the formerly-implicit state of AudioPlayer as an explicit
 * discriminated union + reducer. The five old boolean flags
 * (`_manualNavigating`, `_trackEndInProgress`, `_cdnRetryPending`,
 * `isPlaying`, `isPaused`) fold into the state's `kind` — illegal
 * combinations become unrepresentable instead of reachable-but-buggy.
 *
 * The reducer is pure: no IO, no timers, no listeners. The application
 * layer observes state transitions and executes side effects
 * (see src/app/playback_side_effects.ts). This split is what lets the
 * state logic be tested exhaustively without spinning up Discord or
 * FFmpeg.
 *
 * ──── Key race resolution ────
 * The old `_manualNavigating` flag was needed because after a user
 * pressed skip, the outgoing track's Idle event could still arrive and
 * be mistaken for a natural end-of-track, causing a double skip.
 * Under the state machine:
 *   - `SKIP_REQUESTED` moves Playing → Loading(nextTrack)
 *   - A delayed `STREAM_ENDED` for the previous trackId is recognized
 *     by comparing event.trackId to state.track.id and rejected.
 * No extra flag needed — the state itself carries the information.
 */

import type { Track } from "./track";
import type { DomainError } from "./errors";
import { ErrorCode } from "./errors";

export type PlaybackState =
  | { kind: "idle" }
  | { kind: "connecting"; track: Track }
  | { kind: "loading"; track: Track }
  | { kind: "playing"; track: Track; startedAt: Date }
  | { kind: "paused"; track: Track; pausedAt: Date; positionMs: number }
  | { kind: "retrying"; track: Track; reason: "cdn" | "short_playback" | "stream_error"; attempt: number }
  | { kind: "error"; error: DomainError; lastTrack: Track | null };

export type PlaybackEvent =
  /** User (or queue-auto-advance) asked to play a specific track. */
  | { type: "PLAY_REQUESTED"; track: Track }
  /** Voice channel joined and ready. */
  | { type: "VOICE_CONNECTED" }
  /** Voice connection failed permanently (e.g. permission denied). */
  | { type: "VOICE_DISCONNECTED"; reason: DomainError }
  /** First bytes of the audio stream flushed to Discord. */
  | { type: "STREAM_STARTED"; trackId: string; at: Date }
  /** Stream ended — naturally or due to an error. Carries the trackId so
   *  late-arriving events from a previous track can be discarded. */
  | {
      type: "STREAM_ENDED";
      trackId: string;
      reason: "complete" | "skipped" | "error" | "cdn_failure";
      playedMs: number;
    }
  /** User-initiated skip (forward or backward). Target track is resolved
   *  by the caller (app layer) from the current Queue. */
  | { type: "SKIP_REQUESTED"; target: Track }
  | { type: "PAUSE_REQUESTED"; positionMs: number }
  | { type: "RESUME_REQUESTED" }
  /** URL refreshed after a stale-CDN detection; resume loading. */
  | { type: "URL_REFRESHED"; track: Track }
  /** Unrecoverable failure (ffmpeg missing, yt-dlp crash, etc). */
  | { type: "FATAL_ERROR"; error: DomainError };

/** Max retries before giving up on a single track. */
export const MAX_RETRIES = 3;
/** A stream that ends this fast is treated as an error, not a natural end. */
export const SHORT_PLAYBACK_THRESHOLD_MS = 3000;

export interface ReducerOptions {
  /** Injected for testability — defaults to real clock. */
  now?: () => Date;
}

/**
 * Pure reducer. Returns the next state; never throws. Illegal transitions
 * return the prior state unchanged — callers may detect no-ops by
 * reference equality.
 */
export function reducePlayback(
  state: PlaybackState,
  event: PlaybackEvent,
  opts: ReducerOptions = {},
): PlaybackState {
  const now = opts.now ?? (() => new Date());

  // FATAL_ERROR is accepted from any state.
  if (event.type === "FATAL_ERROR") {
    const lastTrack =
      state.kind === "idle" || state.kind === "error" ? null : stateTrack(state);
    return { kind: "error", error: event.error, lastTrack };
  }

  switch (state.kind) {
    case "idle":
      return reduceFromIdle(state, event);
    case "connecting":
      return reduceFromConnecting(state, event, now);
    case "loading":
      return reduceFromLoading(state, event, now);
    case "playing":
      return reduceFromPlaying(state, event, now);
    case "paused":
      return reduceFromPaused(state, event, now);
    case "retrying":
      return reduceFromRetrying(state, event, now);
    case "error":
      return reduceFromError(state, event);
  }
}

function reduceFromIdle(state: PlaybackState & { kind: "idle" }, event: PlaybackEvent): PlaybackState {
  switch (event.type) {
    case "PLAY_REQUESTED":
      return { kind: "connecting", track: event.track };
    default:
      return state;
  }
}

function reduceFromConnecting(
  state: PlaybackState & { kind: "connecting" },
  event: PlaybackEvent,
  _now: () => Date,
): PlaybackState {
  switch (event.type) {
    case "VOICE_CONNECTED":
      return { kind: "loading", track: state.track };
    case "VOICE_DISCONNECTED":
      return { kind: "error", error: event.reason, lastTrack: state.track };
    case "PLAY_REQUESTED":
      // Still connecting — swap the target track.
      return { kind: "connecting", track: event.track };
    default:
      return state;
  }
}

function reduceFromLoading(
  state: PlaybackState & { kind: "loading" },
  event: PlaybackEvent,
  now: () => Date,
): PlaybackState {
  switch (event.type) {
    case "STREAM_STARTED":
      if (event.trackId !== state.track.id) return state; // stale event
      return { kind: "playing", track: state.track, startedAt: event.at ?? now() };
    case "URL_REFRESHED":
      return { kind: "loading", track: event.track };
    case "STREAM_ENDED":
      // A stream that "ended" without ever starting: either a CDN failure
      // in the first second, or yt-dlp/FFmpeg blew up. Route to retry.
      if (event.trackId !== state.track.id) return state;
      if (event.reason === "cdn_failure") return beginRetry(state.track, "cdn", 1);
      if (event.reason === "error") return beginRetry(state.track, "stream_error", 1);
      // "complete" / "skipped" from loading: no playback ever happened, go back to idle.
      return { kind: "idle" };
    case "PLAY_REQUESTED":
      // Redirect loading to a newer track (e.g. rapid /play before stream started).
      return { kind: "loading", track: event.track };
    case "SKIP_REQUESTED":
      return { kind: "loading", track: event.target };
    case "VOICE_DISCONNECTED":
      return { kind: "error", error: event.reason, lastTrack: state.track };
    default:
      return state;
  }
}

function reduceFromPlaying(
  state: PlaybackState & { kind: "playing" },
  event: PlaybackEvent,
  _now: () => Date,
): PlaybackState {
  switch (event.type) {
    case "STREAM_ENDED": {
      if (event.trackId !== state.track.id) return state; // late event from prior track
      if (event.reason === "cdn_failure" || event.reason === "error") {
        return beginRetry(state.track, event.reason === "cdn_failure" ? "cdn" : "stream_error", 1);
      }
      if (event.reason === "complete" || event.reason === "skipped") {
        // Short-playback heuristic: a "complete" after <3s is suspicious,
        // mirror the old AudioPlayer behaviour of retrying instead of advancing.
        if (
          event.reason === "complete" &&
          event.playedMs < SHORT_PLAYBACK_THRESHOLD_MS &&
          state.track.retryCount < MAX_RETRIES
        ) {
          return beginRetry(state.track, "short_playback", 1);
        }
        return { kind: "idle" };
      }
      return state;
    }
    case "PAUSE_REQUESTED":
      return {
        kind: "paused",
        track: state.track,
        pausedAt: _now(),
        positionMs: event.positionMs,
      };
    case "SKIP_REQUESTED":
      // The canonical race fix: once we enter loading(nextTrack), any
      // still-in-flight STREAM_ENDED from the outgoing track is discarded
      // by the trackId check above.
      return { kind: "loading", track: event.target };
    case "VOICE_DISCONNECTED":
      return { kind: "error", error: event.reason, lastTrack: state.track };
    case "PLAY_REQUESTED":
      return { kind: "loading", track: event.track };
    default:
      return state;
  }
}

function reduceFromPaused(
  state: PlaybackState & { kind: "paused" },
  event: PlaybackEvent,
  now: () => Date,
): PlaybackState {
  switch (event.type) {
    case "RESUME_REQUESTED":
      return { kind: "playing", track: state.track, startedAt: now() };
    case "SKIP_REQUESTED":
      return { kind: "loading", track: event.target };
    case "STREAM_ENDED":
      if (event.trackId !== state.track.id) return state;
      return { kind: "idle" };
    case "VOICE_DISCONNECTED":
      return { kind: "error", error: event.reason, lastTrack: state.track };
    case "PLAY_REQUESTED":
      return { kind: "loading", track: event.track };
    default:
      return state;
  }
}

function reduceFromRetrying(
  state: PlaybackState & { kind: "retrying" },
  event: PlaybackEvent,
  _now: () => Date,
): PlaybackState {
  switch (event.type) {
    case "URL_REFRESHED":
      return { kind: "loading", track: event.track };
    case "PLAY_REQUESTED":
      return { kind: "loading", track: event.track };
    case "SKIP_REQUESTED":
      return { kind: "loading", track: event.target };
    case "FATAL_ERROR":
      return { kind: "error", error: event.error, lastTrack: state.track };
    case "STREAM_ENDED":
      // Retry reached max — give up on this track and move on.
      if (state.attempt >= MAX_RETRIES) return { kind: "idle" };
      return state;
    default:
      return state;
  }
}

function reduceFromError(
  state: PlaybackState & { kind: "error" },
  event: PlaybackEvent,
): PlaybackState {
  // Only a fresh play request reopens the state machine.
  if (event.type === "PLAY_REQUESTED") {
    return { kind: "connecting", track: event.track };
  }
  return state;
}

function beginRetry(
  track: Track,
  reason: "cdn" | "short_playback" | "stream_error",
  attempt: number,
): PlaybackState {
  if (track.retryCount >= MAX_RETRIES) {
    return {
      kind: "error",
      error: {
        code: ErrorCode.CDN_UNREACHABLE,
        message: `Exhausted retries for track ${track.title}`,
        retryable: false,
      },
      lastTrack: track,
    };
  }
  return { kind: "retrying", track, reason, attempt };
}

/** Extract the track associated with a state, if any. */
export function stateTrack(state: PlaybackState): Track | null {
  switch (state.kind) {
    case "idle":
      return null;
    case "error":
      return state.lastTrack;
    default:
      return state.track;
  }
}
