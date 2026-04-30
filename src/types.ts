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
  duration: number;          // seconds; 0 = unknown
  thumbnail?: string;
  author?: string;
  platform?: 'bilibili';
  extractedAt?: number;      // Date.now() at extraction time
}

/** UI message reference stored in GuildSession */
export interface UiContext {
  channelId: ChannelId;
  messageId: MessageId;
}

/** Shape of a Track's requestedBy field */
export interface Requester {
  id: UserId;
  tag: string;   // Discord displayName
}

/** Return type of validateEnv() */
export interface EnvValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
