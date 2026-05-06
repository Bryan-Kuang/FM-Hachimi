/**
 * Track
 * Represents a single audio track in the queue.
 * Encapsulates all track metadata and playback state,
 * replacing the plain object that was assembled in AudioPlayer.addToQueue().
 */

import config = require('../config/config');
import type { TrackData, StreamHeaders } from '../types';

class Track implements TrackData {
  // Fields spread from TrackData via Object.assign:
  bvid!: string;
  title!: string;
  audioUrl!: string;
  url?: string;
  originalUrl?: string;
  normalizedUrl?: string;
  duration!: number;
  thumbnail?: string;
  author?: string;
  platform?: 'bilibili';
  extractedAt?: string;
  id?: string;
  videoId?: string;
  streamHeaders?: StreamHeaders;

  // Queue-time fields:
  requestedBy: string | null;
  addedAt: Date;
  retryCount: number;

  constructor(data: TrackData, requestedBy: string) {
    Object.assign(this, data);
    this.requestedBy = requestedBy || null;
    this.addedAt     = new Date();
    this.retryCount  = 0;
  }

  isExpired(): boolean {
    if (!this.extractedAt) return false;
    const age = Date.now() - new Date(this.extractedAt).getTime();
    return age > config.audio.urlRefreshThreshold;
  }

  incrementRetry(): void {
    this.retryCount = (this.retryCount || 0) + 1;
  }

  resetRetry(): void {
    this.retryCount = 0;
  }
}

export = Track;
