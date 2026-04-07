/**
 * Playback Service
 * Unified service layer that absorbs PlayerControl and PlaylistManager logic.
 * Acts as the single bridge between command layer and audio layer.
 */

const EventEmitter = require('events')
const logger = require('./logger_service')

class PlaybackService extends EventEmitter {
  /**
   * @param {Object} deps - Injected dependencies (all required)
   * @param {Object} deps.audioManager - AudioManager instance
   * @param {Object} deps.interfaceUpdater - InterfaceUpdater instance
   * @param {Object} deps.progressTracker - ProgressTracker instance
   * @param {Object} deps.extractor - BilibiliExtractor instance
   * @param {Object} [deps.historyStore] - HistoryStore instance
   */
  constructor({ audioManager, interfaceUpdater, progressTracker, extractor, historyStore } = {}) {
    super()
    this.audioManager     = audioManager
    this.interfaceUpdater = interfaceUpdater
    this.progressTracker  = progressTracker
    this.extractor        = extractor   // kept for getExtractor() used by search / interactionCreate
    this.historyStore     = historyStore || null
    /** @type {Map<string, AbortController>} Per-guild AbortControllers for running hachimi ops */
    this._hachimiControllers = new Map()
  }

  _setHachimiController(guildId, controller) {
    this._hachimiControllers.set(guildId, controller)
  }

  _clearHachimiController(guildId) {
    this._hachimiControllers.delete(guildId)
  }

  /**
   * Public accessor for the Bilibili extractor.
   * @returns {Object|null}
   */
  getExtractor() {
    return this.extractor
  }

  // ---------------------------------------------------------------------------
  // State emission (compatible with PlayerControl's event contract)
  // ---------------------------------------------------------------------------

  /**
   * Register a handler for player state changes.
   * Compatible with PlayerControl's event contract -- used by InterfaceUpdater.bind().
   * @param {Function} handler - Callback receiving { guildId, state, track }
   */
  onStateChanged(handler) {
    this.on('player_state_changed', handler)
  }

  /**
   * Emit a player_state_changed event.
   * Payload: { guildId, state, track }
   * InterfaceUpdater listens for this event.
   */
  _emitState(guildId, state, track) {
    this.emit('player_state_changed', { guildId, state, track })
  }

  /**
   * Read the current player state and emit it.
   * Convenience wrapper used after operations that need a fresh state push.
   * @param {string} guildId
   */
  notifyState(guildId) {
    try {
      const player = this.audioManager.getPlayer(guildId)
      const state = player.getState()
      this._emitState(guildId, state, state.currentTrack)
    } catch (e) {
      logger.error('Notify state failed', { guildId, error: e.message })
    }
  }

  // ---------------------------------------------------------------------------
  // Playback control (absorbed from PlayerControl)
  // ---------------------------------------------------------------------------

  /**
   * Start playback for the guild (plays next track in queue).
   * @param {string} guildId
   * @returns {Promise<boolean>}
   */
  async play(guildId) {
    try {
      const player = this.audioManager.getPlayer(guildId)
      if (!player) return false
      const success = await player.playNext()
      const state = player.getState()
      this._emitState(guildId, state, state.currentTrack)
      return success
    } catch (e) {
      logger.error('Play action failed', { guildId, error: e.message })
      return false
    }
  }

  /**
   * Pause playback.
   * @param {string} guildId
   * @returns {boolean}
   */
  pause(guildId) {
    try {
      const result = this.audioManager.pausePlayback(guildId)
      if (result && result.player) {
        this._emitState(guildId, result.player, result.player.currentTrack)
      }
      return !!(result && result.success)
    } catch (e) {
      logger.error('Pause action failed', { guildId, error: e.message })
      return false
    }
  }

  /**
   * Resume playback.
   * @param {string} guildId
   * @returns {boolean}
   */
  resume(guildId) {
    try {
      const result = this.audioManager.resumePlayback(guildId)
      if (result && result.player) {
        this._emitState(guildId, result.player, result.player.currentTrack)
      }
      return !!(result && result.success)
    } catch (e) {
      logger.error('Resume action failed', { guildId, error: e.message })
      return false
    }
  }

  /**
   * Skip to next track.
   * @param {string} guildId
   * @returns {Promise<boolean>}
   */
  async skip(guildId) {
    try {
      const result = await this.audioManager.skipTrack(guildId)
      if (result && result.player) {
        this._emitState(guildId, result.player, result.newTrack || result.player.currentTrack)
      }
      return !!(result && result.success)
    } catch (e) {
      logger.error('Skip action failed', { guildId, error: e.message })
      return false
    }
  }

  /**
   * Go to previous track.
   * @param {string} guildId
   * @returns {Promise<boolean>}
   */
  async previous(guildId) {
    try {
      const result = await this.audioManager.previousTrack(guildId)
      if (result && result.player) {
        this._emitState(guildId, result.player, result.newTrack || result.player.currentTrack)
      }
      return !!(result && result.success)
    } catch (e) {
      logger.error('Previous action failed', { guildId, error: e.message })
      return false
    }
  }

  /**
   * Stop playback, clear queue, leave voice channel, and clear UI context.
   * @param {string} guildId
   * @returns {Promise<boolean>}
   */
  async stop(guildId) {
    try {
      // Abort any in-flight hachimi search/parse for this guild
      this._hachimiControllers.get(guildId)?.abort()
      this._hachimiControllers.delete(guildId)
      const result = await this.audioManager.stopPlayback(guildId)
      if (result && result.player) {
        this._emitState(guildId, result.player, null)
      }
      if (result && result.success) {
        this.interfaceUpdater.clearContext(guildId)
      }
      return !!(result && result.success)
    } catch (e) {
      logger.error('Stop action failed', { guildId, error: e.message })
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Get the AudioPlayer instance for a guild.
   * @param {string} guildId
   * @returns {Object} AudioPlayer
   */
  getPlayer(guildId) {
    return this.audioManager.getPlayer(guildId)
  }

  /**
   * Get the currently playing track.
   * @param {string} guildId
   * @returns {Object|null}
   */
  getCurrentTrack(guildId) {
    const player = this.audioManager.getPlayer(guildId)
    return player.currentTrack
  }

  /**
   * Check if audio is currently playing in a guild.
   * @param {string} guildId
   * @returns {boolean}
   */
  isPlaying(guildId) {
    const player = this.audioManager.getPlayer(guildId)
    return player.isPlaying
  }

  // ---------------------------------------------------------------------------
  // UI context management (proxied to InterfaceUpdater)
  // ---------------------------------------------------------------------------

  /**
   * Set UI playback context for a guild.
   * @param {string} guildId
   * @param {string} channelId
   * @param {string} [messageId]
   */
  setUIContext(guildId, channelId, messageId) {
    this.interfaceUpdater.setPlaybackContext(guildId, channelId, messageId)
  }

  /**
   * Clear UI context for a guild.
   * @param {string} guildId
   */
  clearUIContext(guildId) {
    this.interfaceUpdater.clearContext(guildId)
  }

  /**
   * Check whether a UI context exists for a guild.
   * @param {string} guildId
   * @returns {boolean}
   */
  hasUIContext(guildId) {
    return this.interfaceUpdater.hasContext(guildId)
  }

  /**
   * Get the UI context for a guild (channelId, messageId).
   * @param {string} guildId
   * @returns {Object|null}
   */
  getUIContext(guildId) {
    return this.interfaceUpdater.getContext(guildId)
  }

  // ---------------------------------------------------------------------------
  // High-level playback entry point (delegates to AudioManager)
  // ---------------------------------------------------------------------------

  /**
   * Play a Bilibili video: extract, join voice, add to queue, start playback.
   * Delegates to AudioManager.playBilibiliVideo().
   * @param {Object} interaction - Discord interaction
   * @param {string} url - Bilibili video URL
   * @returns {Promise<Object>} Result object with { success, track, player, error, ... }
   */
  async playBilibiliVideo(interaction, url) {
    return this.audioManager.playBilibiliVideo(interaction, url)
  }

  // ---------------------------------------------------------------------------
  // Button interaction handler (extracted from interactionCreate.js)
  // ---------------------------------------------------------------------------

  /**
   * Handle a button interaction from the player controls.
   * Routes control buttons through PlaybackService and delegates
   * non-control buttons to AudioManager.
   *
   * @param {Object} interaction - Discord button interaction
   * @returns {Promise<Object>} Result object with at least { success }
   */
  async handleButtonInteraction(interaction) {
    const customId = interaction.customId
    const guildId = interaction.guild.id

    // --- Control buttons (play/pause, skip, prev, stop) ---
    if (['pause_resume', 'skip', 'prev', 'stop'].includes(customId)) {
      this.setUIContext(guildId, interaction.channelId)
      const player = this.getPlayer(guildId)

      if (customId === 'pause_resume') {
        if (player.isPlaying) {
          const ok = this.pause(guildId)
          return { success: ok }
        } else if (player.isPaused) {
          const ok = this.resume(guildId)
          return { success: ok }
        }
        return { success: false, error: 'No audio to pause/resume' }
      }

      if (customId === 'skip') {
        const ok = await this.skip(guildId)
        return { success: ok }
      }

      if (customId === 'prev') {
        const ok = await this.previous(guildId)
        return { success: ok }
      }

      if (customId === 'stop') {
        const ok = await this.stop(guildId)
        return { success: ok }
      }
    }

    // --- Non-control buttons: delegate to AudioManager ---
    return this.audioManager.handleButtonInteraction(interaction)
  }
}

module.exports = PlaybackService
