/**
 * Immutable Queue aggregate root.
 *
 * Maintains the invariant:
 *   - tracks.length === 0  ⇒  currentIndex === -1
 *   - tracks.length > 0    ⇒  currentIndex ∈ [-1, tracks.length)
 *     where -1 signals "exhausted" (reached past the tail in loop mode `off`).
 *
 * Every mutation returns a fresh Queue; the underlying track array is
 * never mutated. Loop mode transitions are also pure — `moveNext` consults
 * the current loopMode to decide whether to wrap around or return an
 * "exhausted" queue with `currentIndex = -1`.
 */

import type { LoopMode } from "./types";
import { Track } from "./track";

export interface QueueData {
  tracks: readonly Track[];
  currentIndex: number;
  loopMode: LoopMode;
}

export class Queue {
  readonly tracks: readonly Track[];
  readonly currentIndex: number;
  readonly loopMode: LoopMode;

  constructor(data: Partial<QueueData> = {}) {
    const tracks = Object.freeze([...(data.tracks ?? [])]);
    const currentIndex = data.currentIndex ?? (tracks.length > 0 ? 0 : -1);

    // Normalize inconsistent state rather than throwing — reducer must
    // not crash on malformed inputs. `-1` on a non-empty queue is valid
    // (exhausted state under loop=off); only out-of-range positives clamp to 0.
    if (tracks.length === 0) {
      this.currentIndex = -1;
    } else if (currentIndex < -1 || currentIndex >= tracks.length) {
      this.currentIndex = 0;
    } else {
      this.currentIndex = currentIndex;
    }

    this.tracks = tracks;
    this.loopMode = data.loopMode ?? "queue";
    Object.freeze(this);
  }

  static empty(loopMode: LoopMode = "queue"): Queue {
    return new Queue({ tracks: [], currentIndex: -1, loopMode });
  }

  get size(): number {
    return this.tracks.length;
  }

  get isEmpty(): boolean {
    return this.tracks.length === 0;
  }

  get currentTrack(): Track | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.tracks.length) return null;
    return this.tracks[this.currentIndex];
  }

  add(track: Track): Queue {
    const next = [...this.tracks, track];
    const idx = this.tracks.length === 0 ? 0 : this.currentIndex;
    return new Queue({ tracks: next, currentIndex: idx, loopMode: this.loopMode });
  }

  /** Remove by 0-based position. Adjusts currentIndex to preserve the currently-playing track when possible. */
  removeAt(index: number): Queue {
    if (index < 0 || index >= this.tracks.length) return this;
    const next = this.tracks.filter((_, i) => i !== index);
    let nextIndex = this.currentIndex;
    if (index < this.currentIndex) nextIndex = this.currentIndex - 1;
    else if (index === this.currentIndex) nextIndex = this.currentIndex; // new track slides in
    if (nextIndex >= next.length) nextIndex = next.length === 0 ? -1 : next.length - 1;
    return new Queue({ tracks: next, currentIndex: nextIndex, loopMode: this.loopMode });
  }

  clear(): Queue {
    return new Queue({ tracks: [], currentIndex: -1, loopMode: this.loopMode });
  }

  /**
   * Advance the pointer according to loopMode.
   * - `off`: move forward; if past end, return a queue with currentIndex=-1 (exhausted)
   * - `track`: stay on the same index
   * - `queue`: wrap around to 0 when past end
   */
  moveNext(): Queue {
    if (this.isEmpty) return this;
    if (this.loopMode === "track") return this;
    const nextIdx = this.currentIndex + 1;
    if (nextIdx >= this.tracks.length) {
      if (this.loopMode === "queue") {
        return new Queue({ tracks: this.tracks, currentIndex: 0, loopMode: this.loopMode });
      }
      return new Queue({ tracks: this.tracks, currentIndex: -1, loopMode: this.loopMode });
    }
    return new Queue({ tracks: this.tracks, currentIndex: nextIdx, loopMode: this.loopMode });
  }

  /**
   * Move to the previous track.
   * - `track`: stay in place
   * - `queue` / `off`: step back; if already at 0, wrap to last for `queue`, stay at 0 for `off`
   */
  movePrev(): Queue {
    if (this.isEmpty) return this;
    if (this.loopMode === "track") return this;
    const prevIdx = this.currentIndex - 1;
    if (prevIdx < 0) {
      if (this.loopMode === "queue") {
        return new Queue({
          tracks: this.tracks,
          currentIndex: this.tracks.length - 1,
          loopMode: this.loopMode,
        });
      }
      return this; // at head under `off`
    }
    return new Queue({ tracks: this.tracks, currentIndex: prevIdx, loopMode: this.loopMode });
  }

  /** Jump to a specific queue index. Returns `this` if out-of-range. */
  jumpTo(index: number): Queue {
    if (this.isEmpty) return this;
    if (index < 0 || index >= this.tracks.length) return this;
    if (index === this.currentIndex) return this;
    return new Queue({ tracks: this.tracks, currentIndex: index, loopMode: this.loopMode });
  }

  setLoopMode(mode: LoopMode): Queue {
    if (mode === this.loopMode) return this;
    return new Queue({ tracks: this.tracks, currentIndex: this.currentIndex, loopMode: mode });
  }

  /**
   * Fisher–Yates shuffle of tracks OTHER than the currently playing one.
   * Current track retains its logical position (index 0 of the new queue)
   * so playback isn't interrupted.
   */
  shuffle(rand: () => number = Math.random): Queue {
    if (this.tracks.length < 2) return this;
    const current = this.currentTrack;
    const others = this.tracks.filter((_, i) => i !== this.currentIndex);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    const next = current ? [current, ...others] : others;
    return new Queue({ tracks: next, currentIndex: current ? 0 : -1, loopMode: this.loopMode });
  }

  /** Replace the track at a position — used when refreshing a stale URL in place. */
  replaceAt(index: number, track: Track): Queue {
    if (index < 0 || index >= this.tracks.length) return this;
    if (this.tracks[index] === track) return this;
    const next = this.tracks.map((t, i) => (i === index ? track : t));
    return new Queue({ tracks: next, currentIndex: this.currentIndex, loopMode: this.loopMode });
  }
}
