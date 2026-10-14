/**
 * Bilibili request guard — one process-wide place that
 *   - spaces consecutive Bilibili API requests (min gap + jitter),
 *   - remembers a recent risk-control rejection (HTTP 412) so background work
 *     can back off instead of hammering a blocked endpoint,
 *   - counts requests per UTC day and logs the previous day's totals.
 *
 * Context: on 2026-10-11 a 24h radio was issuing ~5000 Bilibili requests a
 * day when Bilibili started answering the production IP with HTTP 412.
 */

import * as logger from '../services/logger_service';
import * as metrics from '../observability/metrics';
import config = require('../config/config');

export type BilibiliRequestKind = 'search' | 'view' | 'playurl' | 'nav' | 'spi' | 'ytdlp' | 'other';

let nextSlotAt = 0;
let riskControlUntil = 0;
let day = currentDay();
let counts: Record<string, number> = {};

function currentDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function rollDay(): void {
  const today = currentDay();
  if (today === day) return;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  logger.info('Bilibili daily request count', { day, total, byKind: counts });
  day = today;
  counts = {};
}

/** Record one outgoing Bilibili request (API call or yt-dlp invocation). */
export function countRequest(kind: BilibiliRequestKind): void {
  rollDay();
  counts[kind] = (counts[kind] ?? 0) + 1;
  metrics.counter('bilibili_requests_total', 'Requests sent to Bilibili').inc({ kind });
}

/**
 * Wait for this request's turn. Slots are reserved synchronously, so
 * concurrent callers queue up behind each other instead of bursting.
 */
export async function acquireSlot(kind: BilibiliRequestKind): Promise<void> {
  const now = Date.now();
  const startAt = Math.max(now, nextSlotAt);
  const jitter = config.bilibili.requestJitterMs > 0
    ? Math.floor(Math.random() * config.bilibili.requestJitterMs)
    : 0;
  nextSlotAt = startAt + config.bilibili.minRequestGapMs + jitter;
  const waitMs = startAt - now;
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  countRequest(kind);
}

export function isRiskControlRejection(error: unknown): boolean {
  return /HTTP (?:Error )?412\b/.test((error as Error)?.message ?? '');
}

/** Note an HTTP 412 and start (or extend) the background cooldown. */
export function noteRiskControl(source: string): void {
  const wasCooling = isCoolingDown();
  riskControlUntil = Date.now() + config.bilibili.riskControlCooldownMs;
  metrics.counter('bilibili_risk_control_total', 'Bilibili HTTP 412 rejections').inc({ source });
  if (!wasCooling) {
    logger.warn('Bilibili risk control (HTTP 412); pausing background requests', {
      source,
      cooldownMs: config.bilibili.riskControlCooldownMs,
    });
  }
}

/** True while background work should avoid calling Bilibili. */
export function isCoolingDown(): boolean {
  return Date.now() < riskControlUntil;
}

/** Test hook. */
export function _reset(): void {
  nextSlotAt = 0;
  riskControlUntil = 0;
  day = currentDay();
  counts = {};
}
