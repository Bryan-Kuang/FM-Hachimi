/**
 * CDN retry helpers — pure functions extracted from audio_player.js.
 *
 * isCdnFailure: decides whether an FFmpeg exit (code + stderr) looks
 *   like a recoverable CDN glitch rather than a hard failure.
 * computeCdnBackoffMs: exponential backoff math for retry attempts.
 * sleep: setTimeout wrapper that unrefs so tests/process exit aren't
 *   blocked by a pending timer.
 */

interface CdnRetryConfig {
  cdnBackoffBaseMs: number;
  cdnBackoffMultiplier: number;
  cdnBackoffMaxMs: number;
}

export function isCdnFailure(code: number, stderr: string): boolean {
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

export function computeCdnBackoffMs(
  attempt: number,
  retryConfig: CdnRetryConfig,
  env: NodeJS.ProcessEnv = process.env
): number {
  if (env.NODE_ENV === 'test') return 0;
  const { cdnBackoffBaseMs: base, cdnBackoffMultiplier: multiplier, cdnBackoffMaxMs: max } = retryConfig;
  const exp = Math.max(0, attempt - 1);
  return Math.min(base * Math.pow(multiplier, exp), max);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}
