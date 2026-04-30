// Shared domain types — imported by all layers.
// Keep this file free of runtime imports (types only).

export type GuildId = string;
export type UserId = string;
export type ChannelId = string;
export type MessageId = string;

/** Raw data returned by BilibiliExtractor.extractAudio() */
export interface TrackData {
  bvid: string;
  title: string;
  audioUrl: string;
  url?: string;
  originalUrl?: string;
  normalizedUrl?: string;
  id?: string;
  videoId?: string;
  duration: number;          // seconds; 0 = unknown
  thumbnail?: string;
  author?: string;
  platform?: 'bilibili';
  extractedAt?: string;      // ISO 8601 string from new Date().toISOString()
}

/** UI message reference stored in GuildSession */
export interface UiContext {
  channelId: ChannelId;
  messageId: MessageId;
}

/** Shape of a Track's requestedBy field */
export interface Requester {
  id: UserId;
  tag: string;   // Discord mention string, e.g. "<@123456789>"
}

/** Return type of validateEnv() */
export interface EnvValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Shape of a running progress-tracker stored on GuildSession.progressTracker.
 * Defined here (types.ts) so guild_session.ts, session_manager.ts, and
 * progress_tracker.ts all share the same interface without circular deps.
 */
export interface ProgressTrackerState {
  message: unknown;                             // Discord Message object
  guildId: string;
  getPlayerState: () => unknown;                // callback → player state
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  lastSignature: string | null;
  nextTickAt: number;
  cooldownUntil: number;
  consecutiveSlowEdits: number;
  cooldownStreak: number;
  lastCooldownEndedAt: number;
  slowEditThresholdMs: number;
  slowEditStreakLimit: number;
  cooldownMs: number;
}
