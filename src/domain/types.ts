/**
 * Core domain primitives — shared across Track, Queue, PlaybackState, and
 * the application layer. Pure types, no runtime deps.
 */

export type Platform = "bilibili" | "youtube" | "spotify";

export type LoopMode = "off" | "track" | "queue";

/** Context accompanying every user-initiated playback command. */
export interface PlaybackContext {
  guildId: string;
  userId: string;
  voiceChannelId: string;
  textChannelId: string;
  /** Optional 8-char trace id for log correlation (see infra/observability/trace). */
  traceId?: string;
}

/** Universal track identifier: `${platform}:${nativeId}` (e.g. `bilibili:BV1xxxx`). */
export type TrackId = string;

export function makeTrackId(platform: Platform, nativeId: string): TrackId {
  return `${platform}:${nativeId}`;
}

export function parseTrackId(id: TrackId): { platform: Platform; nativeId: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0 || idx === id.length - 1) return null;
  const platform = id.slice(0, idx) as Platform;
  return { platform, nativeId: id.slice(idx + 1) };
}
