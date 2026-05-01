/**
 * Playback Service
 * Unified service layer that absorbs PlayerControl and PlaylistManager logic.
 * Acts as the single bridge between command layer and audio layer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';
import * as logger from './logger_service';

interface PlaybackServiceDeps {
  audioManager: any;
  interfaceUpdater: any;
  progressTracker: any;
  extractor: any;
  historyStore?: any;
}

class PlaybackService extends EventEmitter {
  private audioManager: any;
  private interfaceUpdater: any;
  private extractor: any;
  /** Per-guild AbortControllers for running hachimi ops */
  private _hachimiControllers: Map<string, AbortController>;

  constructor({
    audioManager,
    interfaceUpdater,
    progressTracker: _progressTracker,   // received but not used directly in this class
    extractor,
    historyStore: _historyStore,         // received but not used directly in this class
  }: PlaybackServiceDeps = {} as PlaybackServiceDeps) {
    super();
    this.audioManager      = audioManager;
    this.interfaceUpdater  = interfaceUpdater;
    this.extractor         = extractor;   // kept for getExtractor() used by search / interactionCreate
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
  // State emission (compatible with PlayerControl's event contract)
  // ---------------------------------------------------------------------------

  /**
   * Register a handler for player state changes.
   * Compatible with PlayerControl's event contract — used by InterfaceUpdater.bind().
   */
  onStateChanged(handler: (event: { guildId: string; state: any; track: any }) => void): void {
    this.on('player_state_changed', handler);
  }

  /**
   * Emit a player_state_changed event.
   * Payload: { guildId, state, track }
   * InterfaceUpdater listens for this event.
   */
  _emitState(guildId: string, state: any, track: any): void {
    this.emit('player_state_changed', { guildId, state, track });
  }

  /**
   * Read the current player state and emit it.
   * Convenience wrapper used after operations that need a fresh state push.
   */
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
  // Playback control (absorbed from PlayerControl)
  // ---------------------------------------------------------------------------

  /**
   * Start playback for the guild (plays next track in queue).
   */
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

  /**
   * Pause playback.
   */
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

  /**
   * Resume playback.
   */
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

  /**
   * Skip to next track.
   */
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

  /**
   * Go to previous track.
   */
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

  /**
   * Stop playback, clear queue, leave voice channel, and clear UI context.
   */
  async stop(guildId: string): Promise<boolean> {
    try {
      // Abort any in-flight hachimi search/parse for this guild
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
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Get the AudioPlayer instance for a guild.
   */
  getPlayer(guildId: string): any {
    return this.audioManager.getPlayer(guildId);
  }

  /**
   * Get the currently playing track.
   */
  getCurrentTrack(guildId: string): any {
    const player = this.audioManager.getPlayer(guildId);
    return player.currentTrack;
  }

  /**
   * Check if audio is currently playing in a guild.
   */
  isPlaying(guildId: string): boolean {
    const player = this.audioManager.getPlayer(guildId);
    return player.isPlaying as boolean;
  }

  // ---------------------------------------------------------------------------
  // UI context management (proxied to InterfaceUpdater)
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
  // High-level playback entry point (delegates to AudioManager)
  // ---------------------------------------------------------------------------

  /**
   * Play a Bilibili video: extract, join voice, add to queue, start playback.
   * Delegates to AudioManager.playBilibiliVideo().
   */
  async playBilibiliVideo(interaction: any, url: string): Promise<any> {
    return this.audioManager.playBilibiliVideo(interaction, url);
  }

  // ---------------------------------------------------------------------------
  // Button interaction handler (extracted from interactionCreate.js)
  // ---------------------------------------------------------------------------

  /**
   * Handle a button interaction from the player controls.
   * Routes control buttons through PlaybackService and delegates
   * non-control buttons to AudioManager.
   */
  async handleButtonInteraction(interaction: any): Promise<{ success: boolean; error?: string }> {
    const customId = interaction.customId as string;
    const guildId = interaction.guild.id as string;

    // --- Control buttons (play/pause, skip, prev, stop) ---
    if (['pause_resume', 'skip', 'prev', 'stop'].includes(customId)) {
      this.setUIContext(guildId, interaction.channelId as string);
      const player = this.getPlayer(guildId);

      if (customId === 'pause_resume') {
        if (player.isPlaying) {
          const ok = this.pause(guildId);
          return { success: ok };
        } else if (player.isPaused) {
          const ok = this.resume(guildId);
          return { success: ok };
        }
        return { success: false, error: 'No audio to pause/resume' };
      }

      if (customId === 'skip') {
        const ok = await this.skip(guildId);
        return { success: ok };
      }

      if (customId === 'prev') {
        const ok = await this.previous(guildId);
        return { success: ok };
      }

      if (customId === 'stop') {
        const ok = await this.stop(guildId);
        return { success: ok };
      }
    }

    // --- Non-control buttons: delegate to AudioManager ---
    return this.audioManager.handleButtonInteraction(interaction) as Promise<{ success: boolean }>;
  }
}

export = PlaybackService;
