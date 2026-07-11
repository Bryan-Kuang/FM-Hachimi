/**
 * Thin adapter over the extracted `ytdlp-cookie-keeper` package (which grew
 * out of this file). Owns the app-specific concerns the package deliberately
 * doesn't: the `enabled` config gate, structured logging, and Prometheus
 * metrics wiring. The refresh mechanics (export -> validate -> atomic swap,
 * cooldown, in-flight dedup, redaction) live upstream.
 */

import cookieKeeper = require('ytdlp-cookie-keeper');
import logger = require('../services/logger_service');
import metrics = require('../observability/metrics');

interface CookieRefreshContext {
  reason?: string;
  source?: string;
  force?: boolean;
}

interface CookieRefreshResult {
  success: boolean;
  refreshed: boolean;
  skipped?: boolean;
  error?: string;
}

interface CookieRefreshOptions {
  enabled?: boolean;
  cookiesFile?: string;
  browserSpec?: string;
  validateUrls?: string[];
  refreshIntervalMs?: number;
  cooldownMs?: number;
  tmpDir?: string;
}

const DEFAULT_COOKIE_FILE = '/app/secrets/youtube_cookies.txt';
const DEFAULT_BROWSER_SPEC = 'chrome+basictext:/app/youtube-browser-profile';

class YouTubeCookieRefreshService {
  private enabled: boolean;
  private keeper: cookieKeeper.CookieKeeper;

  constructor(options: CookieRefreshOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.keeper = new cookieKeeper.CookieKeeper({
      cookiesFile: options.cookiesFile || process.env.YOUTUBE_COOKIES_FILE || DEFAULT_COOKIE_FILE,
      browserSpec: options.browserSpec || process.env.YOUTUBE_COOKIE_BROWSER_SPEC || DEFAULT_BROWSER_SPEC,
      validateUrls: options.validateUrls,
      refreshIntervalMs: options.refreshIntervalMs,
      cooldownMs: options.cooldownMs,
      tmpDir: options.tmpDir,
    });

    this.keeper.on('refresh:start', (event) => {
      logger.info('Refreshing YouTube cookies', {
        reason: event.reason,
        source: event.source,
        browserSpec: event.browserSpec,
      });
    });

    this.keeper.on('refresh:success', (event) => {
      logger.info('YouTube cookies refreshed successfully', {
        reason: event.reason,
        source: event.source,
        validationCount: event.validateUrlCount,
      });
      // Observability: scrapers/alerts derive cookie age from now - this gauge.
      metrics.gauge(
        'youtube_cookie_last_refresh_success_timestamp_seconds',
        'Unix time (s) of the last successful YouTube cookie refresh',
      ).set(Math.floor(event.timestampMs / 1000));
      metrics.counter('youtube_cookie_refresh_total', 'YouTube cookie refresh attempts by result')
        .inc({ result: 'success' });
    });

    this.keeper.on('refresh:failure', (event) => {
      logger.warn('YouTube cookie refresh failed', { error: event.error });
      metrics.counter('youtube_cookie_refresh_total', 'YouTube cookie refresh attempts by result')
        .inc({ result: 'failure' });
    });
  }

  start(): void {
    if (!this.enabled) return;
    this.keeper.start();
  }

  stop(): void {
    this.keeper.stop();
  }

  refreshInBackground(context: CookieRefreshContext = {}): void {
    if (!this.enabled) return;
    this.keeper.refreshInBackground(context);
  }

  async refreshNow(context: CookieRefreshContext = {}): Promise<CookieRefreshResult> {
    if (!this.enabled) {
      return { success: false, refreshed: false, skipped: true, error: 'YouTube cookie auto-refresh is disabled' };
    }
    return this.keeper.refreshNow(context);
  }
}

export = YouTubeCookieRefreshService;
