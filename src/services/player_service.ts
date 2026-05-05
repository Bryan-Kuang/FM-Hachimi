/**
 * Player Service
 * Single service layer bridging command/UI layer and audio layer.
 * Absorbs both PlaybackService (play/pause/skip/stop/state) and
 * QueueService (add/remove/clear/shuffle/loop) responsibilities.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';
import * as logger from './logger_service';

interface PlayerServiceDeps {
  audioManager: any;
  interfaceUpdater: any;
  progressTracker: any;
  extractor: any;
  historyStore?: any;
}

class PlayerService extends EventEmitter {
  private audioManager: any;
  private interfaceUpdater: any;
  private extractor: any;
  /** Per-guild AbortControllers for running hachimi ops */
  private _hachimiControllers: Map<string, AbortController>;

  constructor({
    audioManager,
    interfaceUpdater,
    progressTracker: _progressTracker,
    extractor,
    historyStore: _historyStore,
  }: PlayerServiceDeps = {} as PlayerServiceDeps) {
    super();
    this.audioManager      = audioManager;
    this.interfaceUpdater  = interfaceUpdater;
    this.extractor         = extractor;
    this._hachimiControllers = new Map();
  }

  _setHachimiController(guildId: string, controller: AbortController): void {
    this._hachimiControllers.set(guildId, controller);
  }

  _clearHachimiController(guildId: string): void {
    this._hachimiControllers.delete(guildId);
  }

  /**
   * Public accessor for the Bilibili extractor.
   */
  getExtractor(): any {
    return this.extractor;
  }

  // ---------------------------------------------------------------------------
  // State emission (InterfaceUpdater listens for 'player_state_changed')
  // ---------------------------------------------------------------------------

  onStateChanged(handler: (event: { guildId: string; state: any; track: any }) => void): void {
    this.on('player_state_changed', handler);
  }

  _emitState(guildId: string, state: any, track: any): void {
    this.emit('player_state_changed', { guildId, state, track });
  }

  notifyState(guildId: string): void {
    try {
      const player = this.audioManager.getPlayer(guildId);
      const state = player.getState();
      this._emitState(guildId, state, state.currentTrack);
    } catch (e: unknown) {
      logger.error('Notify state failed', { guildId, error: (e as Error).message });
    }
  }

  // ---------------------------------------------------------------------------
  // Playback control
  // ---------------------------------------------------------------------------

  async play(guildId: string): Promise<boolean> {
    try {
      const player = this.audioManager.getPlayer(guildId);
      if (!player) return false;
      const success = await player.playNext() as boolean;
      const state = player.getState();
      this._emitState(guildId, state, state.currentTrack);
      return success;
    } catch (e: unknown) {
      logger.error('Play action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  pause(guildId: string): boolean {
    try {
      const result = this.audioManager.pausePlayback(guildId);
      if (result && result.player) {
        this._emitState(guildId, result.player, result.player.currentTrack);
      }
      return !!(result && result.success);
    } catch (e: unknown) {
      logger.error('Pause action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  resume(guildId: string): boolean {
    try {
      const result = this.audioManager.resumePlayback(guildId);
      if (result && result.player) {
        this._emitState(guildId, result.player, result.player.currentTrack);
      }
      return !!(result && result.success);
    } catch (e: unknown) {
      logger.error('Resume action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  async skip(guildId: string): Promise<boolean> {
    try {
      const result = await this.audioManager.skipTrack(guildId);
      if (result && result.player) {
        this._emitState(guildId, result.player, result.newTrack || result.player.currentTrack);
      }
      return !!(result && result.success);
    } catch (e: unknown) {
      logger.error('Skip action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  async previous(guildId: string): Promise<boolean> {
    try {
      const result = await this.audioManager.previousTrack(guildId);
      if (result && result.player) {
        this._emitState(guildId, result.player, result.newTrack || result.player.currentTrack);
      }
      return !!(result && result.success);
    } catch (e: unknown) {
      logger.error('Previous action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  async stop(guildId: string): Promise<boolean> {
    try {
      this._hachimiControllers.get(guildId)?.abort();
      this._hachimiControllers.delete(guildId);
      const result = await this.audioManager.stopPlayback(guildId);
      if (result && result.player) {
        this._emitState(guildId, result.player, null);
      }
      if (result && result.success) {
        this.interfaceUpdater.clearContext(guildId);
      }
      return !!(result && result.success);
    } catch (e: unknown) {
      logger.error('Stop action failed', { guildId, error: (e as Error).message });
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Queue operations (absorbed from QueueService)
  // ---------------------------------------------------------------------------

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

  removeTrack(guildId: string, index: number): boolean {
    try {
      const player = this.audioManager.getPlayer(guildId);
      return player.removeFromQueue(index) as boolean;
    } catch (e: unknown) {
      logger.error('Remove from queue failed', { guildId, index, error: (e as Error).message });
      return false;
    }
  }

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

  shuffleQueue(guildId: string): any {
    return this.audioManager.shuffleQueue(guildId);
  }

  setLoopMode(guildId: string, mode: string): any {
    return this.audioManager.setLoopMode(guildId, mode);
  }

  getLoopMode(guildId: string): string {
    const player = this.audioManager.getPlayer(guildId);
    return player.loopMode as string;
  }

  getQueue(guildId: string): any {
    return this.audioManager.getQueue(guildId);
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  getPlayer(guildId: string): any {
    return this.audioManager.getPlayer(guildId);
  }

  getCurrentTrack(guildId: string): any {
    const player = this.audioManager.getPlayer(guildId);
    return player.currentTrack;
  }

  isPlaying(guildId: string): boolean {
    const player = this.audioManager.getPlayer(guildId);
    return player.isPlaying as boolean;
  }

  // ---------------------------------------------------------------------------
  // UI context management
  // ---------------------------------------------------------------------------

  setUIContext(guildId: string, channelId: string, messageId?: string): void {
    this.interfaceUpdater.setPlaybackContext(guildId, channelId, messageId);
  }

  clearUIContext(guildId: string): void {
    this.interfaceUpdater.clearContext(guildId);
  }

  hasUIContext(guildId: string): boolean {
    return this.interfaceUpdater.hasContext(guildId) as boolean;
  }

  getUIContext(guildId: string): { channelId: string; messageId: string } | null {
    return this.interfaceUpdater.getContext(guildId) as { channelId: string; messageId: string } | null;
  }

  // ---------------------------------------------------------------------------
  // High-level playback entry point
  // ---------------------------------------------------------------------------

  async playBilibiliVideo(interaction: any, url: string): Promise<any> {
    return this.audioManager.playBilibiliVideo(interaction, url);
  }

  // ---------------------------------------------------------------------------
  // Button interaction handler
  // ---------------------------------------------------------------------------

  async handleButtonInteraction(interaction: any): Promise<{ success: boolean; error?: string }> {
    const customId = interaction.customId as string;
    const guildId = interaction.guild.id as string;

    if (['pause_resume', 'skip', 'prev', 'stop'].includes(customId)) {
      this.setUIContext(guildId, interaction.channelId as string);
      const player = this.getPlayer(guildId);

      if (customId === 'pause_resume') {
        if (player.isPlaying) return { success: this.pause(guildId) };
        else if (player.isPaused) return { success: this.resume(guildId) };
        return { success: false, error: 'No audio to pause/resume' };
      }
      if (customId === 'skip') return { success: await this.skip(guildId) };
      if (customId === 'prev') return { success: await this.previous(guildId) };
      if (customId === 'stop') return { success: await this.stop(guildId) };
    }

    return this.audioManager.handleButtonInteraction(interaction) as Promise<{ success: boolean }>;
  }
}

export = PlayerService;
