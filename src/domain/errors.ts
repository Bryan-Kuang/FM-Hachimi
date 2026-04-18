/**
 * Domain error taxonomy. Every application-layer operation returns
 * `Result<T>` so the caller can branch on the discriminant without
 * try/catch choreography. Callers at the edge (commands, UI) map
 * `ErrorCode` → user-facing localized messages.
 */

export enum ErrorCode {
  VOICE_PERMISSION_DENIED = "VOICE_PERMISSION_DENIED",
  VOICE_CONNECTION_TIMEOUT = "VOICE_CONNECTION_TIMEOUT",
  GUILD_NOT_IN_VOICE = "GUILD_NOT_IN_VOICE",
  EXTRACTION_FAILED = "EXTRACTION_FAILED",
  CDN_UNREACHABLE = "CDN_UNREACHABLE",
  FFMPEG_NOT_INSTALLED = "FFMPEG_NOT_INSTALLED",
  YT_DLP_NOT_INSTALLED = "YT_DLP_NOT_INSTALLED",
  RATE_LIMITED = "RATE_LIMITED",
  QUEUE_FULL = "QUEUE_FULL",
  QUEUE_EMPTY = "QUEUE_EMPTY",
  TRACK_NOT_FOUND = "TRACK_NOT_FOUND",
  INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",
  UNKNOWN = "UNKNOWN",
}

export interface DomainError {
  code: ErrorCode;
  message: string;
  /** Whether retrying the same operation may succeed without user intervention. */
  retryable: boolean;
  cause?: unknown;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: DomainError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(
  code: ErrorCode,
  message: string,
  opts: { retryable?: boolean; cause?: unknown } = {},
): Result<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: opts.retryable ?? false,
      cause: opts.cause,
    },
  };
}
