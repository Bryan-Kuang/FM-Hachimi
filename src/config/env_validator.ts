/**
 * Environment validator — fail fast at boot if required config is missing
 * or ill-formed. Centralizes the precondition checks so main entry code
 * stays focused on composition.
 *
 * Returns structured result rather than throwing so callers control exit
 * policy (e.g. tests can assert on failures without catching exceptions).
 */

import type { EnvValidationResult } from '../types';

const REQUIRED_VARS = ['DISCORD_TOKEN', 'CLIENT_ID'];

function isNonEmptyString(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInt(value: string | undefined): boolean {
  if (value === undefined || value === null || value === "") return true; // optional
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

/**
 * Validate process.env for the bot's required and optional configuration.
 * @param env - defaults to process.env; accept override for tests
 */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const key of REQUIRED_VARS) {
    if (!isNonEmptyString(env[key])) {
      errors.push(`Missing required env var: ${key}`);
    }
  }

  const intVars = [
    "MAX_QUEUE_SIZE",
    "EXTRACTION_TIMEOUT",
    "INACTIVITY_TIMEOUT",
    "FFMPEG_ACTIVITY_CHECK_INTERVAL",
    "FFMPEG_INACTIVE_WARNING_THRESHOLD",
    "FFMPEG_INACTIVE_KILL_THRESHOLD",
    "URL_REFRESH_THRESHOLD",
    "AUDIO_FULL_TRACK_THRESHOLD_MS",
    "AUDIO_SHORT_PLAYBACK_RETRY_THRESHOLD_MS",
    "AUDIO_KILL_GRACE_PERIOD_MS",
    "AUDIO_FFMPEG_HANG_FORCE_KILL_MS",
    "VOICE_CONNECTION_TIMEOUT_MS",
    "VOICE_HANDOFF_WAIT_MS",
    "VOICE_AUTO_DISCONNECT_IDLE_MS",
    "RETRY_VOICE_JOIN_BASE_BACKOFF_MS",
    "RETRY_TRACK_DELAY_MS",
    "RETRY_CDN_BACKOFF_BASE_MS",
    "RETRY_CDN_BACKOFF_MULTIPLIER",
    "RETRY_CDN_BACKOFF_MAX_MS",
    "UI_PROGRESS_INTERVAL_MS",
    "UI_SLOW_EDIT_THRESHOLD_MS",
    "UI_SLOW_EDIT_STREAK_LIMIT",
    "UI_COOLDOWN_MS",
    "BILIBILI_VIEW_COUNT_THRESHOLD",
    "HACHIMI_PAGE_SIZE",
    "HACHIMI_MAX_PAGES",
    "HACHIMI_MAX_DURATION_SEC",
    "HACHIMI_MIN_DURATION_SEC",
    "BILIBILI_SEARCH_TIMEOUT",
  ];
  for (const key of intVars) {
    if (!isPositiveInt(env[key])) {
      errors.push(`Env var ${key} must be a positive integer, got: ${JSON.stringify(env[key])}`);
    }
  }

  if (env.BILIBILI_LIKE_RATE_THRESHOLD !== undefined && env.BILIBILI_LIKE_RATE_THRESHOLD !== "") {
    const v = Number(env.BILIBILI_LIKE_RATE_THRESHOLD);
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      errors.push(`BILIBILI_LIKE_RATE_THRESHOLD must be a number in [0, 1], got: ${JSON.stringify(env.BILIBILI_LIKE_RATE_THRESHOLD)}`);
    }
  }

  if (env.LOG_LEVEL && !["error", "warn", "info", "debug", "verbose", "silly"].includes(env.LOG_LEVEL)) {
    warnings.push(`Unrecognized LOG_LEVEL "${env.LOG_LEVEL}"; Winston will fall back to info`);
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, errors: [], warnings };
}

/**
 * Convenience wrapper used at boot: validate and exit(1) on failure.
 * Accepts an optional logger (falls back to console) to avoid cyclic deps
 * with logger_service.
 */
export function validateOrExit(
  env: NodeJS.ProcessEnv = process.env,
  logger: { warn?(msg: string): void; error?(msg: string): void; log?(msg: string): void } = console
): EnvValidationResult {
  const result = validateEnv(env);
  for (const w of result.warnings) {
    logger.warn ? logger.warn(w) : logger.log!(w);
  }
  if (!result.ok) {
    for (const e of result.errors) {
      logger.error ? logger.error(e) : logger.log!(e);
    }
    process.exit(1);
  }
  return result;
}
