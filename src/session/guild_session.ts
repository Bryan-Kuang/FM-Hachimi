/**
 * Guild Session
 * Per-guild state container for player, UI, and playback tracking
 */

import type { UiContext, ProgressTrackerState } from '../types';

import type AudioPlayer from '../audio/audio_player';
type AudioPlayerInstance = AudioPlayer;

class GuildSession {
  guildId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  player: AudioPlayerInstance | null;
  uiContext: UiContext | null;
  uiSeq: number;
  progressTracker: ProgressTrackerState | null;
  history: Set<string>;
  historyLimit: number;

  constructor(guildId: string) {
    this.guildId = guildId;
    this.player = null;
    this.uiContext = null;
    this.uiSeq = 0;
    this.progressTracker = null;
    this.history = new Set();
    this.historyLimit = 50;
  }

  /**
   * Add a bvid to the play history, evicting oldest if over limit.
   */
  addHistory(bvid: string): void {
    // Move to tail (newest) by re-inserting
    if (this.history.has(bvid)) this.history.delete(bvid);
    this.history.add(bvid);
    // Evict oldest if over limit
    while (this.history.size > this.historyLimit) {
      const oldest = this.history.values().next().value as string;
      this.history.delete(oldest);
    }
  }

  /**
   * Check if a bvid exists in the play history.
   */
  hasHistory(bvid: string): boolean {
    return this.history.has(bvid);
  }

  /**
   * Filter candidates that are not in the play history.
   * Candidates must have a `bvid` property for history lookup.
   * Items with an absent/undefined bvid are always kept (pass-through).
   */
  filterHistory<T extends { bvid?: string }>(candidates: T[]): T[] {
    return (Array.isArray(candidates) ? candidates : []).filter(
      // items with no bvid pass through; others are kept if not in history
      (v) => v.bvid == null || !this.history.has(v.bvid)
    );
  }
}

export = GuildSession;
