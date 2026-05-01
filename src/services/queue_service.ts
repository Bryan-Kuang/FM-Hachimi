/**
 * Queue Service
 * Manages queue operations: adding/removing tracks, loop mode, shuffle.
 * Extracted from PlaybackService to give each class a single responsibility.
 *
 * PlaybackService  → playback control (play/pause/resume/skip/stop)
 * QueueService     → queue management  (add/remove/clear/shuffle/loop)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as logger from './logger_service';

interface QueueServiceDeps {
  audioManager: any;
  extractor?: any;
}

class QueueService {
  private audioManager: any;
  private extractor: any;

  constructor({ audioManager, extractor }: QueueServiceDeps = {} as QueueServiceDeps) {
    this.audioManager = audioManager;
    this.extractor    = extractor ?? null;
  }

  /**
   * Expose the extractor so commands can validate its availability.
   */
  getExtractor(): any {
    return this.extractor;
  }

  // ---------------------------------------------------------------------------
  // Track operations
  // ---------------------------------------------------------------------------

  /**
   * Add a track to the guild queue.
   * Accepts either a video data object (from BilibiliExtractor) or a raw URL.
   */
  async addTrack(guildId: string, videoOrUrl: any, requestedBy: string): Promise<any> {
    try {
      const player = this.audioManager.getPlayer(guildId);
      let videoData = videoOrUrl;

      if (typeof videoOrUrl === 'string') {
        if (!this.extractor) throw new Error('Extractor not available');
        videoData = await this.extractor.extractAudio(videoOrUrl);
      }

      const track = player.addToQueue(videoData, requestedBy);
      return track;
    } catch (e: unknown) {
      logger.error('Add to queue failed', { guildId, error: (e as Error).message });
      return null;
    }
  }

  /**
   * Remove a track from the queue by its display index (0-based).
   */
  removeTrack(guildId: string, index: number): boolean {
    try {
      const player = this.audioManager.getPlayer(guildId);
      return player.removeFromQueue(index) as boolean;
    } catch (e: unknown) {
      logger.error('Remove from queue failed', { guildId, index, error: (e as Error).message });
      return false;
    }
  }

  /**
   * Clear all tracks from the queue.
   */
  clearQueue(guildId: string): boolean {
    try {
      const player = this.audioManager.getPlayer(guildId);
      player.clearQueue();
      return true;
    } catch (e: unknown) {
      logger.error('Clear queue failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  /**
   * Shuffle the queue.
   */
  shuffleQueue(guildId: string): any {
    return this.audioManager.shuffleQueue(guildId);
  }

  // ---------------------------------------------------------------------------
  // Loop mode
  // ---------------------------------------------------------------------------

  /**
   * Set loop mode for a guild.
   * @param mode - 'none' | 'queue' | 'track'
   */
  setLoopMode(guildId: string, mode: string): any {
    return this.audioManager.setLoopMode(guildId, mode);
  }

  /**
   * Get current loop mode for a guild.
   */
  getLoopMode(guildId: string): string {
    const player = this.audioManager.getPlayer(guildId);
    return player.loopMode as string;
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Get queue info for a guild, formatted for display.
   */
  getQueue(guildId: string): any {
    return this.audioManager.getQueue(guildId);
  }
}

export = QueueService;
