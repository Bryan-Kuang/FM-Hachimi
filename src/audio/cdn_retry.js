/**
 * CDN retry helpers — pure functions extracted from audio_player.js.
 *
 * These three functions have zero dependency on AudioPlayer state:
 *   - isCdnFailure: decides whether an FFmpeg exit (code + stderr) looks
 *     like a recoverable CDN glitch rather than a hard failure.
 *   - computeCdnBackoffMs: exponential backoff math for retry attempts.
 *   - sleep: setTimeout wrapper that unrefs so tests/process exit aren't
 *     blocked by a pending timer.
 *
 * They live here (not inside AudioPlayer) so the regex table and backoff
 * math are trivially unit-testable in isolation and so readers don't
 * have to scroll past 1400 lines of playback logic to find them.
 *
 * Behavior is byte-for-byte identical to the previous in-class versions —
 * AudioPlayer's `isCdnFailure` / `_computeCdnBackoffMs` / `_sleep`
 * methods are now thin delegations so existing callers and tests that
 * invoke them as methods keep working.
 */

/**
 * Detect whether an FFmpeg exit looks like a retryable CDN problem
 * (signed URL expired, akamai 403, upstream reset, etc.) as opposed to
 * a hard failure (bad args, local FS issue, malformed input).
 *
 * Only three exit codes are ever considered retryable:
 *   255 — FFmpeg's generic error exit; paired with stderr patterns
 *   8   — "Invalid data found when processing input", specifically
 *         observed for HTTPS-layer CDN hiccups (seen in 2026-04-22 prod)
 *   251 — TLS / I/O error before FFmpeg could open the input
 *
 * If the exit code matches AND stderr contains a known CDN-failure
 * pattern → retryable. Otherwise it's propagated as a real error.
 *
 * @param {number} code    — FFmpeg process exit code
 * @param {string} stderr  — accumulated stderr text
 * @returns {boolean}
 */
function isCdnFailure(code, stderr) {
  const retryableCodes = new Set([255, 8, 251]);
  if (!retryableCodes.has(code)) return false;
  const cdnPatterns = [
    /End of file/i,
    /Server returned 4\d{2}/i,
    /Server returned 5\d{2}/i,
    /Connection reset/i,
    /Connection refused/i,
    /Connection timed out/i,
    /I\/O error/i,
    /HTTP error/i,
    /403 Forbidden/i,
  ];
  return cdnPatterns.some((p) => p.test(stderr));
}

/**
 * Exponential backoff for CDN retries. `attempt` is 1-indexed — the
 * first retry is attempt 1 and gets `base` ms of sleep; subsequent
 * retries multiply by `multiplier` up to a `max` cap.
 *
 * Returns 0 under NODE_ENV=test so unit tests stay fast without having
 * to mock timers.
 *
 * @param {number} attempt     — 1-indexed retry attempt counter
 * @param {{cdnBackoffBaseMs:number, cdnBackoffMultiplier:number, cdnBackoffMaxMs:number}} retryConfig
 * @param {NodeJS.ProcessEnv} env  — defaults to process.env; injected for tests
 * @returns {number}           — delay in ms before next retry
 */
function computeCdnBackoffMs(attempt, retryConfig, env = process.env) {
  if (env.NODE_ENV === "test") return 0;
  const base = retryConfig.cdnBackoffBaseMs;
  const multiplier = retryConfig.cdnBackoffMultiplier;
  const max = retryConfig.cdnBackoffMaxMs;
  const exp = Math.max(0, attempt - 1);
  const computed = base * Math.pow(multiplier, exp);
  return Math.min(computed, max);
}

/**
 * Promise-returning setTimeout. The underlying timer is `unref()`-ed so
 * a pending sleep never keeps the Node process alive on shutdown.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === "function") t.unref();
  });
}

module.exports = { isCdnFailure, computeCdnBackoffMs, sleep };
