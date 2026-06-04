import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as logger from '../services/logger_service';
import * as metrics from '../observability/metrics';

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

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const DEFAULT_VALIDATE_URLS = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=AUfXW1EdLew',
];

const DEFAULT_COOKIE_FILE = '/app/secrets/youtube_cookies.txt';
const DEFAULT_BROWSER_SPEC = 'chrome+basictext:/app/youtube-browser-profile';
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const NETSCAPE_HEADER = '# Netscape HTTP Cookie File\n';

class YouTubeCookieRefreshService {
  private enabled: boolean;
  private cookiesFile: string;
  private browserSpec: string;
  private validateUrls: string[];
  private refreshIntervalMs: number;
  private cooldownMs: number;
  private tmpDir: string;
  private interval: NodeJS.Timeout | null;
  private inFlight: Promise<CookieRefreshResult> | null;
  private lastAttemptAt: number;

  constructor(options: CookieRefreshOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.cookiesFile = options.cookiesFile || process.env.YOUTUBE_COOKIES_FILE || DEFAULT_COOKIE_FILE;
    this.browserSpec = options.browserSpec || process.env.YOUTUBE_COOKIE_BROWSER_SPEC || DEFAULT_BROWSER_SPEC;
    this.validateUrls = options.validateUrls?.length ? options.validateUrls : DEFAULT_VALIDATE_URLS;
    this.refreshIntervalMs = Math.max(0, options.refreshIntervalMs ?? DEFAULT_INTERVAL_MS);
    this.cooldownMs = Math.max(0, options.cooldownMs ?? DEFAULT_COOLDOWN_MS);
    this.tmpDir = options.tmpDir || os.tmpdir();
    this.interval = null;
    this.inFlight = null;
    this.lastAttemptAt = 0;
  }

  start(): void {
    if (!this.enabled || this.refreshIntervalMs <= 0 || this.interval) return;

    this.interval = setInterval(() => {
      this.refreshInBackground({ reason: 'scheduled' });
    }, this.refreshIntervalMs).unref();
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }

  refreshInBackground(context: CookieRefreshContext = {}): void {
    void this.refreshNow(context).catch((error: unknown) => {
      logger.warn('YouTube cookie background refresh failed', {
        reason: context.reason,
        source: context.source,
        error: (error as Error).message,
      });
    });
  }

  async refreshNow(context: CookieRefreshContext = {}): Promise<CookieRefreshResult> {
    if (!this.enabled) {
      return { success: false, refreshed: false, skipped: true, error: 'YouTube cookie auto-refresh is disabled' };
    }

    if (this.inFlight) {
      logger.info('Joining in-flight YouTube cookie refresh', {
        reason: context.reason,
        source: context.source,
      });
      return this.inFlight;
    }

    const now = Date.now();
    if (!context.force && this.lastAttemptAt > 0 && now - this.lastAttemptAt < this.cooldownMs) {
      return {
        success: false,
        refreshed: false,
        skipped: true,
        error: `YouTube cookie refresh is cooling down for ${this.cooldownMs - (now - this.lastAttemptAt)}ms`,
      };
    }

    this.lastAttemptAt = now;
    this.inFlight = this.doRefresh(context).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doRefresh(context: CookieRefreshContext): Promise<CookieRefreshResult> {
    let workDir: string | null = null;

    try {
      fs.mkdirSync(path.dirname(this.cookiesFile), { recursive: true });
      fs.mkdirSync(this.tmpDir, { recursive: true });

      workDir = fs.mkdtempSync(path.join(this.tmpDir, 'yt-cookie-refresh-'));
      const candidateFile = path.join(workDir, 'youtube_cookies.txt');
      fs.writeFileSync(candidateFile, NETSCAPE_HEADER, { mode: 0o600 });

      logger.info('Refreshing YouTube cookies', {
        reason: context.reason,
        source: context.source,
        browserSpec: this.redactBrowserSpec(this.browserSpec),
      });

      const exportResult = await this.runYtDlp([
        '--cookies-from-browser', this.browserSpec,
        '--cookies', candidateFile,
        '--skip-download',
        '--flat-playlist',
        '--playlist-items', '0',
        '--extractor-args', 'youtubetab:skip=authcheck',
        'https://www.youtube.com/',
      ]);

      if (exportResult.code !== 0) {
        return this.failure('YouTube cookie export failed', exportResult.stderr);
      }

      if (!this.hasCookiePayload(candidateFile)) {
        return this.failure('YouTube cookie export produced no usable cookies');
      }

      for (const validateUrl of this.validateUrls) {
        const validateResult = await this.runYtDlp([
          '--cookies', candidateFile,
          '--skip-download',
          '--no-playlist',
          '--no-warnings',
          '--js-runtimes', 'node',
          '--format', 'bestaudio[vcodec=none][acodec!=none]/best[height<=360][acodec!=none]/worst[acodec!=none]',
          '--print', 'id',
          validateUrl,
        ]);

        if (validateResult.code !== 0) {
          return this.failure('Exported YouTube cookies failed validation', validateResult.stderr);
        }
      }

      const candidate = fs.readFileSync(candidateFile);
      fs.writeFileSync(this.cookiesFile, candidate, { mode: 0o600 });
      fs.chmodSync(this.cookiesFile, 0o600);

      logger.info('YouTube cookies refreshed successfully', {
        reason: context.reason,
        source: context.source,
        validationCount: this.validateUrls.length,
      });

      // Observability: scrapers/alerts derive cookie age from now - this gauge.
      metrics.gauge(
        'youtube_cookie_last_refresh_success_timestamp_seconds',
        'Unix time (s) of the last successful YouTube cookie refresh',
      ).set(Math.floor(Date.now() / 1000));
      metrics.counter('youtube_cookie_refresh_total', 'YouTube cookie refresh attempts by result')
        .inc({ result: 'success' });

      return { success: true, refreshed: true };
    } catch (error: unknown) {
      return this.failure('YouTube cookie refresh failed', (error as Error).message);
    } finally {
      if (workDir) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }
  }

  private hasCookiePayload(cookieFile: string): boolean {
    if (!fs.existsSync(cookieFile)) return false;
    const raw = fs.readFileSync(cookieFile, 'utf8');
    const dataLines = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .map(line => line.startsWith('#HttpOnly_') ? line.replace(/^#HttpOnly_/, '') : line)
      .filter(line => line && !line.startsWith('#'));
    return dataLines.some(line => line.includes('youtube.com') || line.includes('\tSID\t'));
  }

  private failure(message: string, rawDetails = ''): CookieRefreshResult {
    const error = rawDetails ? `${message}: ${this.redact(rawDetails)}` : message;
    logger.warn('YouTube cookie refresh failed', { error });
    metrics.counter('youtube_cookie_refresh_total', 'YouTube cookie refresh attempts by result')
      .inc({ result: 'failure' });
    return { success: false, refreshed: false, error };
  }

  private runYtDlp(args: string[], timeoutMs = 90_000): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child: ChildProcess = spawn('yt-dlp', args);
      let stdout = '';
      let stderr = '';
      let settled = false;

      child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      const timeoutId = setTimeout(() => {
        if (settled) return;
        child.kill('SIGTERM');
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000).unref();
        settled = true;
        resolve({ code: 143, stdout, stderr: `${stderr}\nTimed out` });
      }, timeoutMs).unref();

      child.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve({ code, stdout, stderr });
      });

      child.on('error', (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  private redactBrowserSpec(value: string): string {
    return value.replace(/:(\/[^:\s]+)/, ':<profile>');
  }

  private redact(value: string): string {
    return value
      .replace(/https?:\/\/\S+/g, '<redacted-url>')
      .replace(/([?&](?:sig|signature|expire|ei|spc|lsig|n)=)[^&\s]+/gi, '$1<redacted>')
      .replace(/(SID|HSID|SSID|SAPISID|APISID|LOGIN_INFO)\t[^\s]+/g, '$1\t<redacted>');
  }
}

export = YouTubeCookieRefreshService;
