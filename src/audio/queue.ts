/**
 * Queue
 * Pure data-structure managing an ordered list of tracks with a cursor
 * (currentIndex) and loop-mode semantics.
 *
 * Extracted from AudioPlayer so playback orchestration and queue bookkeeping
 * live in separate units. Queue has zero knowledge of voice connections,
 * FFmpeg, or Discord — it only knows about Track objects and indices.
 */

import Track = require('../models/track');
import Formatters = require('../utils/formatters');
import * as logger from '../services/logger_service';
import type { TrackData } from '../types';

type LoopMode = 'none' | 'track' | 'queue';

class Queue {
  items: Track[];
  currentIndex: number;
  currentTrack: Track | null;
  loopMode: LoopMode;

  constructor() {
    this.items = [];
    this.currentIndex = -1;
    this.currentTrack = null;
    this.loopMode = 'queue'; // 🎵 默认为queue loop
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  get length(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Whether skip() would succeed (next track or loop wraps around). */
  canSkip(): boolean {
    return (
      this.currentIndex < this.items.length - 1 ||
      this.loopMode === 'queue' ||
      this.loopMode === 'track'
    );
  }

  /** Whether previous() would succeed. */
  canGoBack(): boolean {
    return (
      this.currentIndex > 0 ||
      (this.loopMode === 'queue' && this.items.length > 1)
    );
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  /**
   * Append a track built from raw extraction data.
   * Returns the Track instance (for the caller to report title, etc.).
   */
  add(trackData: TrackData, requestedBy: string): Track {
    const track = new Track(trackData, requestedBy);
    this.items.push(track);
    logger.info('Track added to queue', {
      title: track.title,
      requestedBy,
      queueLength: this.items.length,
    });
    return track;
  }

  /**
   * Remove a track by index.
   * Cannot remove the currently-playing track.
   * Adjusts currentIndex when removing before it.
   */
  remove(index: number): boolean {
    if (index < 0 || index >= this.items.length) {
      logger.warn('Invalid queue index for removal', { index, queueLength: this.items.length });
      return false;
    }
    if (index === this.currentIndex) {
      logger.warn('Cannot remove currently playing track', { index });
      return false;
    }

    const removed = this.items[index];
    if (!removed) {
      logger.warn('Track at index is undefined', { index, queueLength: this.items.length });
      return false;
    }

    this.items.splice(index, 1);

    if (index < this.currentIndex) {
      this.currentIndex--;
    }

    logger.info('Track removed from queue', {
      removedTrack: removed.title || 'Unknown Track',
      index,
      newQueueLength: this.items.length,
      newCurrentIndex: this.currentIndex,
    });
    return true;
  }

  /**
   * Clear all tracks except the currently-playing one.
   */
  clear(): void {
    if (this.currentTrack) {
      this.items = [this.currentTrack];
      this.currentIndex = 0;
    } else {
      this.items = [];
      this.currentIndex = -1;
    }
    logger.info('Queue cleared');
  }

  /** Remove every track and reset the cursor. Used by stop/leave. */
  reset(): void {
    this.items = [];
    this.currentTrack = null;
    this.currentIndex = -1;
  }

  /**
   * Remove the currently-playing track (used when it is unplayable — e.g.
   * CDN retries exhausted). Unlike remove(), this targets the current index.
   * The cursor steps back one slot so a following advance() lands on the
   * dropped track's successor, and currentTrack is cleared so neither
   * track-loop nor queue-loop can resurrect it (2026-07-01 retry storm).
   */
  dropCurrent(): Track | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.items.length) return null;

    const [dropped] = this.items.splice(this.currentIndex, 1);
    this.currentIndex--;
    this.currentTrack = null;

    logger.info('Dropped unplayable track from queue', {
      title: dropped?.title || 'Unknown',
      newQueueLength: this.items.length,
      newCurrentIndex: this.currentIndex,
    });
    return dropped ?? null;
  }

  /**
   * Shuffle all tracks except the currently-playing one (which moves to
   * index 0). Fisher–Yates on the remainder.
   */
  shuffle(): void {
    if (this.items.length <= 1) return;

    const current = this.currentTrack;
    const rest = this.items.filter((_, i) => i !== this.currentIndex);

    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }

    if (current) {
      this.items = [current, ...rest];
      this.currentIndex = 0;
    } else {
      this.items = rest;
      this.currentIndex = -1;
    }
    logger.info('Queue shuffled', { queueLength: this.items.length });
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  // These return the Track that should play next (or null if nothing left).
  // They only update queue state — the caller decides whether to actually
  // start playback.

  /**
   * Advance to the first playable track (used when starting playback).
   * Returns the track to play, or null if the queue is empty.
   */
  peekNext(): Track | null {
    if (this.items.length === 0) {
      this.currentTrack = null;
      this.currentIndex = -1;
      return null;
    }

    if (this.currentTrack === null || this.currentIndex === -1) {
      this.currentIndex = 0;
    } else if (this.currentIndex >= this.items.length) {
      this.currentIndex = this.items.length - 1;
    }

    this.currentTrack = this.items[this.currentIndex];
    return this.currentTrack;
  }

  /**
   * Move cursor forward respecting loop mode.
   * Returns { track, ended } where `ended` is true if no more tracks
   * are available (loop=none and we hit the end).
   */
  advance(): { track: Track | null; ended: boolean } {
    if (this.loopMode === 'track' && this.currentTrack) {
      this.currentTrack.resetRetry();
      return { track: this.currentTrack, ended: false };
    }

    if (this.currentIndex < this.items.length - 1) {
      this.currentIndex++;
      this.currentTrack = this.items[this.currentIndex];
      this.currentTrack.resetRetry?.();
      return { track: this.currentTrack, ended: false };
    }

    if (this.loopMode === 'queue' && this.items.length > 0) {
      this.currentIndex = 0;
      this.currentTrack = this.items[0];
      if ((this.currentTrack.retryCount ?? 0) <= 2) {
        this.currentTrack.resetRetry?.();
      }
      logger.info('Queue loop: restarting from beginning', { queueLength: this.items.length });
      return { track: this.currentTrack, ended: false };
    }

    // No more tracks, no loop
    this.currentTrack = null;
    this.currentIndex = -1;
    return { track: null, ended: true };
  }

  /**
   * Move cursor backward respecting loop mode.
   * Returns the track to play, or null if can't go back.
   */
  goBack(): Track | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.currentTrack = this.items[this.currentIndex];
      this.currentTrack.resetRetry?.();
      return this.currentTrack;
    }

    if (this.loopMode === 'queue' && this.items.length > 0) {
      this.currentIndex = this.items.length - 1;
      this.currentTrack = this.items[this.currentIndex];
      this.currentTrack.resetRetry?.();
      logger.info('Queue loop: wrapping to last track', { queueLength: this.items.length });
      return this.currentTrack;
    }

    return null;
  }

  /**
   * Jump to a specific index. Returns the track or null if invalid.
   */
  jumpTo(index: number): Track | null {
    if (index < 0 || index >= this.items.length) return null;
    this.currentIndex = index;
    this.currentTrack = this.items[index];
    return this.currentTrack;
  }

  // ── Loop mode ────────────────────────────────────────────────────────────

  setLoopMode(mode: string): void {
    if (['none', 'track', 'queue'].includes(mode)) {
      this.loopMode = mode as LoopMode;
      logger.info('Loop mode changed', { mode });
    }
  }

  // ── Serialisation ────────────────────────────────────────────────────────

  /** Formatted queue for UI display. */
  getFormatted(): Array<Record<string, unknown>> {
    return this.items.map((track, index) => ({
      ...track,
      position: index + 1,
      isCurrentlyPlaying: index === this.currentIndex,
      duration: Formatters.formatTime(track.duration),
      addedAt: Formatters.formatTime(Date.now() - track.addedAt.getTime()),
    }));
  }
}

export = Queue;
