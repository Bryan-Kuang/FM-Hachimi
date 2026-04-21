/**
 * Phase 1 shadow-mode runner.
 *
 * Runs alongside the legacy AudioPlayer without affecting its behaviour.
 * AudioPlayer emits observation events ("we just saw X happen") and the
 * shadow runner feeds them through the pure reducer to compute what the
 * new state machine would have done. When the prediction diverges from
 * the old implementation's observed outcome, we log a warning with a
 * structured diff for later human review.
 *
 * Goals:
 *   1. Zero production impact. Every entry point short-circuits when
 *      disabled, and nothing here throws even on malformed input.
 *   2. Cheap to run. No timers, no subscriptions to Discord events,
 *      no allocation beyond the bare minimum per transition.
 *   3. Debuggable. Every log line carries guildId + traceId + the full
 *      event so reviewers can reconstruct the context.
 */

import {
  reducePlayback,
  type PlaybackState,
  type PlaybackEvent,
} from "../domain/playback_state";
import { counter } from "../infra/observability/metrics";

/**
 * Minimal logger contract — any `logger_service`-style object works.
 * Typed here so shadow runner does not depend on winston directly.
 */
export interface ShadowLogger {
  warn(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
}

/**
 * Optional hook used in tests to peek at each transition without writing
 * through the logger.
 */
export interface ShadowObserver {
  onTransition?(prev: PlaybackState, event: PlaybackEvent, next: PlaybackState): void;
  onDivergence?(reason: string, ctx: Record<string, unknown>): void;
}

export interface ShadowRunnerOptions {
  enabled: boolean;
  guildId: string;
  logger: ShadowLogger;
  observer?: ShadowObserver;
}

/** Declared outcomes that audio_player.js can report to us. */
export type ObservedOutcome =
  | { kind: "advance_to_next" }
  | { kind: "retry" }
  | { kind: "idle" }
  | { kind: "skip" }
  | { kind: "error"; code: string };

/**
 * Per-guild shadow runner. Holds its own PlaybackState snapshot and
 * applies the reducer as audio_player.js reports events.
 */
export class ShadowRunner {
  private state: PlaybackState = { kind: "idle" };
  private guildId: string;
  private readonly logger: ShadowLogger;
  private readonly observer?: ShadowObserver;
  readonly enabled: boolean;

  constructor(opts: ShadowRunnerOptions) {
    this.enabled = opts.enabled;
    this.guildId = opts.guildId;
    this.logger = opts.logger;
    this.observer = opts.observer;
  }

  /**
   * Attach the real guildId after construction. AudioPlayer creates its
   * runner in the constructor — before `currentGuild` is known — so the
   * initial id is a placeholder. Without this setter every log line and
   * metric label would read `guildId: "unknown"`, which is useless for
   * aggregation. Callers invoke this on voice join, once the id is
   * resolved, so every subsequent event carries the correct attribution.
   * No-op on empty input so accidental calls cannot blank the id.
   */
  setGuildId(guildId: string): void {
    if (!guildId) return;
    this.guildId = guildId;
  }

  /** Reset the shadow state — e.g. on guild leave. */
  reset(): void {
    this.state = { kind: "idle" };
  }

  /** Read-only peek at the current prediction. */
  getState(): PlaybackState {
    return this.state;
  }

  /**
   * Dispatch an event through the reducer. Safe to call with `enabled=false`;
   * in that case we do nothing at all. When enabled, we:
   *   - apply the reducer
   *   - update our cached state
   *   - record a counter metric per transition kind
   *   - fire observer.onTransition when provided
   */
  dispatch(event: PlaybackEvent): PlaybackState {
    if (!this.enabled) return this.state;
    let next: PlaybackState;
    try {
      next = reducePlayback(this.state, event);
    } catch (err) {
      // Reducer is pure and should never throw; if it does, we log and
      // keep the old state so the shadow doesn't wedge itself.
      this.logger.warn("shadow reducer threw — keeping prior state", {
        guildId: this.guildId,
        event,
        error: err instanceof Error ? err.message : String(err),
      });
      counter("shadow_reducer_threw_total").inc({ guild: this.guildId });
      return this.state;
    }
    const prev = this.state;
    this.state = next;
    try {
      this.observer?.onTransition?.(prev, event, next);
    } catch {
      // Observers must never destabilize the shadow.
    }
    counter("shadow_transition_total").inc({
      guild: this.guildId,
      from: prev.kind,
      to: next.kind,
    });
    if (prev.kind !== next.kind) {
      this.logger.debug("shadow transition", {
        guildId: this.guildId,
        from: prev.kind,
        to: next.kind,
        eventType: event.type,
      });
    }
    return next;
  }

  /**
   * Compare a declared real-world outcome against the shadow prediction.
   * If they disagree, emit a warn log + metric so we can aggregate the
   * divergence rate over the bake period.
   */
  compareOutcome(actual: ObservedOutcome, traceId?: string): void {
    if (!this.enabled) return;
    const predicted = mapStateToOutcome(this.state);
    if (predicted === actual.kind) return;
    this.logger.warn("shadow divergence", {
      guildId: this.guildId,
      traceId,
      predicted,
      actual,
      shadowState: this.state.kind,
    });
    counter("shadow_divergence_total").inc({
      guild: this.guildId,
      predicted,
      actual: actual.kind,
    });
    this.observer?.onDivergence?.("outcome_mismatch", {
      predicted,
      actual,
      shadowState: this.state.kind,
    });
  }
}

/**
 * Reduce the shadow's rich state down to the coarse outcome categories
 * that the legacy AudioPlayer thinks in. Used for divergence comparison.
 */
function mapStateToOutcome(state: PlaybackState): ObservedOutcome["kind"] {
  switch (state.kind) {
    case "idle":
      return "idle";
    case "retrying":
      return "retry";
    case "error":
      return "error";
    case "playing":
    case "loading":
    case "connecting":
    case "paused":
      return "advance_to_next";
  }
}

/**
 * Factory used by src/index.js composition root. Respects the
 * `SHADOW_MODE_ENABLED` env flag: unset / false ⇒ a disabled runner
 * whose dispatch() is a no-op, so the legacy path is untouched by default.
 */
export function createShadowRunner(
  guildId: string,
  logger: ShadowLogger,
  env: Record<string, string | undefined> = process.env,
  observer?: ShadowObserver,
): ShadowRunner {
  const enabled = env.SHADOW_MODE_ENABLED === "true";
  return new ShadowRunner({ enabled, guildId, logger, observer });
}
