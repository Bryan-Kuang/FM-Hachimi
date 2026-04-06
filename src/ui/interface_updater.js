const EmbedBuilders = require('../ui/embeds')
const ButtonBuilders = require('../ui/buttons')
const logger = require('../services/logger_service')

class InterfaceUpdater {
  /**
   * @param {Object} sessionManager - SessionManager instance
   * @param {Object} progressTracker - ProgressTracker instance
   * @param {Object} audioManager - AudioManager instance
   */
  constructor(sessionManager, progressTracker, audioManager) {
    this.client = null
    this.sessionManager = sessionManager
    this.progressTracker = progressTracker
    this.audioManager = audioManager
  }

  setClient(client) {
    this.client = client
  }

  setPlaybackContext(guildId, channelId, messageId) {
    const session = this.sessionManager.get(guildId)
    const prev = session.uiContext || {}
    session.uiContext = { channelId, messageId: messageId || prev.messageId }
  }

  clearContext(guildId) {
    const session = this.sessionManager.get(guildId)
    session.uiContext = null
    session.uiSeq = 0
  }

  /**
   * Check whether a UI context exists for a guild.
   * @param {string} guildId
   * @returns {boolean}
   */
  hasContext(guildId) {
    const session = this.sessionManager.get(guildId)
    return session.uiContext != null
  }

  /**
   * Get the UI context for a guild.
   * @param {string} guildId
   * @returns {Object|null}
   */
  getContext(guildId) {
    return this.sessionManager.get(guildId).uiContext
  }

  bind(playerControl) {
    playerControl.onStateChanged(async ({ guildId, state }) => {
      await this.handleUpdate(guildId, state)
    })
  }

  async handleUpdate(guildId, state) {
    try {
      const session = this.sessionManager.get(guildId)
      const s = (session.uiSeq || 0) + 1
      session.uiSeq = s
      const ctx = session.uiContext
      if (!ctx || !ctx.channelId) return
      if (!state.currentTrack) {
        this.progressTracker.stopTracking(guildId)
        return
      }
      // Capture to local variable to prevent race condition during async ops
      const currentTrack = state.currentTrack
      const channel = this.client.channels.cache.get(ctx.channelId) || await this.client.channels.fetch(ctx.channelId)
      const currentTime = this.audioManager.getPlayer(guildId).getCurrentTime()
      const embed = EmbedBuilders.createNowPlayingEmbed(currentTrack, {
        currentTime,
        requestedBy: currentTrack.requestedBy,
        queuePosition: (state.currentIndex >= 0 ? state.currentIndex + 1 : 0),
        totalQueue: state.queueLength,
        loopMode: state.loopMode
      })
      const components = ButtonBuilders.createPlaybackControls({
        isPlaying: state.isPlaying,
        hasQueue: state.queueLength > 0,
        canGoBack: state.hasPrevious,
        canSkip: state.hasNext,
        loopMode: state.loopMode
      })
      const options = { embeds: [embed], components }
      if (ctx.messageId) {
        try {
          const msg = await channel.messages.edit(ctx.messageId, options)
          if (!msg) throw new Error('Message edit returned null')
          if ((session.uiSeq || 0) !== s) return
          if (state.isPlaying && state.currentTrack) {
            this.progressTracker.startTracking(guildId, msg, () => this._getPlayerState(guildId))
          } else {
            this.progressTracker.stopTracking(guildId)
          }
        } catch (e) {
          // Disable buttons on stale message to prevent ghost interactions
          try {
            await channel.messages.edit(ctx.messageId, { components: [] })
          } catch (_) { /* message may already be deleted */ }
          const sent = await channel.send(options)
          session.uiContext = { channelId: ctx.channelId, messageId: sent.id }
          if (state.isPlaying && state.currentTrack) {
            this.progressTracker.startTracking(guildId, sent, () => this._getPlayerState(guildId))
          } else {
            this.progressTracker.stopTracking(guildId)
          }
        }
      } else {
        const sent = await channel.send(options)
        session.uiContext = { channelId: ctx.channelId, messageId: sent.id }
        if (state.isPlaying && state.currentTrack) {
          this.progressTracker.startTracking(guildId, sent, () => this._getPlayerState(guildId))
        } else {
          this.progressTracker.stopTracking(guildId)
        }
      }
    } catch (e) {
      logger.error('Interface update failed', { guildId, error: e.message })
    }
  }

  /**
   * Get current player state for progress tracking
   * @param {string} guildId - Discord guild ID
   * @returns {{ currentTrack, isPlaying, currentTime, currentIndex, queueLength, loopMode, hasPrevious, hasNext }}
   */
  _getPlayerState(guildId) {
    const player = this.audioManager.getPlayer(guildId)
    if (!player) return null
    return {
      currentTrack: player.currentTrack,
      isPlaying: player.isPlaying,
      currentTime: player.getCurrentTime(),
      currentIndex: player.currentIndex,
      queueLength: player.queue ? player.queue.length : 0,
      loopMode: player.loopMode,
      hasPrevious: player.currentIndex > 0,
      hasNext: player.queue ? player.currentIndex < player.queue.length - 1 : false
    }
  }
}

module.exports = InterfaceUpdater
