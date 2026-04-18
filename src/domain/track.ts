/**
 * Immutable Track entity.
 *
 * Every mutating operation returns a new instance — enforced via
 * `readonly` properties + `Object.freeze`. This makes reducers safe
 * (reducePlayback can pass tracks through without defensive copies)
 * and eliminates the whole class of bugs where `currentTrack.retryCount++`
 * was modifying shared state across queues.
 *
 * Keeps the legacy field names (bvid, audioUrl, etc.) so existing JS
 * consumers that hold references to a Track during the migration
 * don't break — see src/models/track.js for the mutable predecessor.
 */

import type { Platform, TrackId } from "./types";
import { makeTrackId } from "./types";

export interface TrackData {
  platform: Platform;
  nativeId: string;
  title: string;
  duration: number;
  audioUrl: string;
  thumbnail?: string;
  author?: string;
  normalizedUrl?: string;
  originalUrl?: string;
  extractedAt?: Date;
  requestedBy?: string | null;
  retryCount?: number;
  audioUrlExpiresAt?: Date;
}

export class Track {
  readonly id: TrackId;
  readonly platform: Platform;
  readonly nativeId: string;
  readonly title: string;
  readonly duration: number;
  readonly audioUrl: string;
  readonly thumbnail?: string;
  readonly author?: string;
  readonly normalizedUrl?: string;
  readonly originalUrl?: string;
  readonly extractedAt?: Date;
  readonly requestedBy: string | null;
  readonly retryCount: number;
  readonly audioUrlExpiresAt?: Date;
  readonly addedAt: Date;

  constructor(data: TrackData, addedAt: Date = new Date()) {
    this.platform = data.platform;
    this.nativeId = data.nativeId;
    this.id = makeTrackId(data.platform, data.nativeId);
    this.title = data.title;
    this.duration = data.duration;
    this.audioUrl = data.audioUrl;
    this.thumbnail = data.thumbnail;
    this.author = data.author;
    this.normalizedUrl = data.normalizedUrl;
    this.originalUrl = data.originalUrl;
    this.extractedAt = data.extractedAt;
    this.requestedBy = data.requestedBy ?? null;
    this.retryCount = data.retryCount ?? 0;
    this.audioUrlExpiresAt = data.audioUrlExpiresAt;
    this.addedAt = addedAt;
    Object.freeze(this);
  }

  /**
   * Whether the cached audio URL is stale enough to warrant re-extraction.
   * Uses the configured threshold (default 20 min) when available;
   * callers can override for tests.
   */
  isExpired(urlRefreshThresholdMs: number, now: Date = new Date()): boolean {
    if (!this.extractedAt) return false;
    return now.getTime() - this.extractedAt.getTime() > urlRefreshThresholdMs;
  }

  withRefreshedUrl(
    audioUrl: string,
    extractedAt: Date = new Date(),
    audioUrlExpiresAt?: Date,
  ): Track {
    return new Track(
      {
        ...this.toData(),
        audioUrl,
        extractedAt,
        audioUrlExpiresAt,
      },
      this.addedAt,
    );
  }

  withIncrementedRetry(): Track {
    return new Track(
      { ...this.toData(), retryCount: this.retryCount + 1 },
      this.addedAt,
    );
  }

  withResetRetry(): Track {
    if (this.retryCount === 0) return this;
    return new Track({ ...this.toData(), retryCount: 0 }, this.addedAt);
  }

  /** Export a raw data view suitable for cloning or serializing. */
  toData(): TrackData {
    return {
      platform: this.platform,
      nativeId: this.nativeId,
      title: this.title,
      duration: this.duration,
      audioUrl: this.audioUrl,
      thumbnail: this.thumbnail,
      author: this.author,
      normalizedUrl: this.normalizedUrl,
      originalUrl: this.originalUrl,
      extractedAt: this.extractedAt,
      requestedBy: this.requestedBy,
      retryCount: this.retryCount,
      audioUrlExpiresAt: this.audioUrlExpiresAt,
    };
  }
}
