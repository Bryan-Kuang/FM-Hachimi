/**
 * Gateway Watchdog
 *
 * discord.js reconnects on its own for most transport failures, but not all of
 * them: `@discordjs/ws@1.2.3` only treats ECONNRESET/ECONNREFUSED/ETIMEDOUT/
 * EAI_AGAIN as network errors (dist/index.js:570). An HTTP-level handshake
 * failure — `Unexpected server response: 503` — carries no `.code`, so
 * `failedToConnectDueToNetworkError` stays false, the 1006 close falls to the
 * default branch, and the shard is destroyed with `recover: Resume`. Resume
 * keeps the session, so the stale `resume_gateway_url` is reused forever,
 * retried on a fixed 500 ms timer with no backoff and no attempt cap.
 *
 * On 2026-09-01 that wedged the bot for ~50 minutes against a gateway host
 * Discord had drained while recovering from an outage: 13k log lines, frozen
 * playback, and a container still reporting `healthy`. A fresh WebSocket from
 * the same container connected in 132 ms the whole time — only the shard was
 * stuck.
 *
 * This watchdog watches the shard's connectivity and escalates when an outage
 * outlives `stuckTimeoutMs`. Escalation is a process exit: a restart drops the
 * poisoned session and forces a fresh IDENTIFY, which is the only way out of
 * the loop from inside the process.
 */

import * as logger from '../services/logger_service';

export interface StuckReport {
  unhealthyForMs: number;
  failures:       number;
  lastError:      string | null;
  lastShardId:    number | null;
}

export interface GatewayWatchdogOptions {
  /** Outage duration after which `onStuck` fires. 0 disables escalation. */
  stuckTimeoutMs: number;
  /** Minimum gap between failure log lines, so a hot retry loop can't spam. */
  logIntervalMs:  number;
  onStuck:        (report: StuckReport) => void;
  now?:           () => number;
}

class GatewayWatchdog {
  private readonly stuckTimeoutMs: number;
  private readonly logIntervalMs:  number;
  private readonly onStuck:        (report: StuckReport) => void;
  private readonly now:            () => number;

  private unhealthySince: number | null = null;
  private failures        = 0;
  private suppressedLogs  = 0;
  private lastLoggedAt    = 0;
  private lastError: string | null  = null;
  private lastShardId: number | null = null;
  private escalated       = false;

  constructor(options: GatewayWatchdogOptions) {
    this.stuckTimeoutMs = options.stuckTimeoutMs;
    this.logIntervalMs  = options.logIntervalMs;
    this.onStuck        = options.onStuck;
    this.now            = options.now ?? (() => Date.now());
  }

  isHealthy(): boolean {
    return this.unhealthySince === null;
  }

  unhealthyForMs(): number {
    if (this.unhealthySince === null) return 0;
    return this.now() - this.unhealthySince;
  }

  /**
   * A shard failed to stay connected (transport error or disconnect).
   * Repeated calls keep the original outage start — the age of the outage is
   * what decides escalation, not the number of failures.
   */
  recordFailure(shardId: number | null, error: string): void {
    const now = this.now();

    this.failures   += 1;
    this.lastError   = error;
    this.lastShardId = shardId;

    if (this.unhealthySince === null) {
      this.unhealthySince = now;
      this.lastLoggedAt   = now;
      this.suppressedLogs = 0;
      logger.warn('Discord gateway connection lost; watching for recovery', {
        shardId, error,
      });
      return;
    }

    if (now - this.lastLoggedAt >= this.logIntervalMs) {
      logger.warn('Discord gateway still failing to reconnect', {
        shardId,
        error,
        outageMs:   now - this.unhealthySince,
        failures:   this.failures,
        suppressed: this.suppressedLogs,
      });
      this.lastLoggedAt   = now;
      this.suppressedLogs = 0;
    } else {
      this.suppressedLogs += 1;
    }
  }

  /** The shard is talking to Discord again. */
  recordRecovery(reason: string): void {
    if (this.unhealthySince === null) return;

    logger.info('Discord gateway recovered', {
      reason,
      outageMs: this.now() - this.unhealthySince,
      failures: this.failures,
    });

    this.unhealthySince = null;
    this.failures       = 0;
    this.suppressedLogs = 0;
    this.escalated      = false;
    this.lastError      = null;
    this.lastShardId    = null;
  }

  /** Fires `onStuck` once per outage when it outlives the timeout. */
  check(): void {
    if (this.stuckTimeoutMs <= 0) return;
    if (this.unhealthySince === null || this.escalated) return;

    const unhealthyForMs = this.unhealthyForMs();
    if (unhealthyForMs <= this.stuckTimeoutMs) return;

    this.escalated = true;
    this.onStuck({
      unhealthyForMs,
      failures:    this.failures,
      lastError:   this.lastError,
      lastShardId: this.lastShardId,
    });
  }
}

export { GatewayWatchdog };
