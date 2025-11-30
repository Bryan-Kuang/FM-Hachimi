const EventEmitter = require('events')
const AudioManager = require('./audio/manager')
const logger = require('./logger_service')

class PlayerControl {
  constructor() {
    this.emitter = new EventEmitter()
    this.audioManager = null
  }

  initialize(audioManager) {
    this.audioManager = audioManager || AudioManager
  }

  onStateChanged(handler) {
    this.emitter.on('player_state_changed', handler)
  }

  emitState(guildId, state, track) {
    this.emitter.emit('player_state_changed', { guildId, state, track })
  }

  notifyState(guildId) {
    try {
      const player = this.audioManager.getPlayer(guildId)
      const state = player.getState()
      this.emitState(guildId, state, state.currentTrack)
    } catch (e) {
      logger.error('Notify state failed', { guildId, error: e.message })
    }
  }

  async play(guildId) {
    try {
      const player = this.audioManager.getPlayer(guildId)
      if (!player) return false
      const success = await player.playNext()
      const state = player.getState()
      this.emitState(guildId, state, state.currentTrack)
      return success
    } catch (e) {
      logger.error('Play action failed', { guildId, error: e.message })
      return false
    }
  }

  pause(guildId) {
    try {
      const result = this.audioManager.pausePlayback(guildId)
      if (result && result.player) {
        this.emitState(guildId, result.player, result.player.currentTrack)
      }
      return !!(result && result.success)
    } catch (e) {
      logger.error('Pause action failed', { guildId, error: e.message })
      return false
    }
  }

  resume(guildId) {
    try {
      const result = this.audioManager.resumePlayback(guildId)
      if (result && result.player) {
        this.emitState(guildId, result.player, result.player.currentTrack)
      }
      return !!(result && result.success)
    } catch (e) {
      logger.error('Resume action failed', { guildId, error: e.message })
      return false
    }
  }

  async next(guildId) {
    try {
      const result = await this.audioManager.skipTrack(guildId)
      if (result && result.player) {
        this.emitState(guildId, result.player, result.newTrack || result.player.currentTrack)
      }
      return !!(result && result.success)
    } catch (e) {
      logger.error('Next action failed', { guildId, error: e.message })
      return false
    }
  }

  async prev(guildId) {
    try {
      const result = await this.audioManager.previousTrack(guildId)
      if (result && result.player) {
        this.emitState(guildId, result.player, result.newTrack || result.player.currentTrack)
      }
      return !!(result && result.success)
    } catch (e) {
      logger.error('Prev action failed', { guildId, error: e.message })
      return false
    }
  }

  async stop(guildId) {
    try {
      const result = await this.audioManager.stopPlayback(guildId)
      if (result && result.player) {
        this.emitState(guildId, result.player, null)
      }
      return !!(result && result.success)
    } catch (e) {
      logger.error('Stop action failed', { guildId, error: e.message })
      return false
    }
  }
}

module.exports = new PlayerControl()

