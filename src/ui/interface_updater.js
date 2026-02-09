const EmbedBuilders = require('../ui/embeds')
const ButtonBuilders = require('../ui/buttons')
const logger = require('../services/logger_service')
const ProgressTracker = require('../audio/progress-tracker')
const AudioManager = require('../audio/manager')

class InterfaceUpdater {
  constructor() {
    this.client = null
    this.contexts = new Map()
    this.seq = new Map()
  }

  setClient(client) {
    this.client = client
  }

  setPlaybackContext(guildId, channelId, messageId) {
    const prev = this.contexts.get(guildId) || {}
    this.contexts.set(guildId, { channelId, messageId: messageId || prev.messageId })
  }

  clearContext(guildId) {
    this.contexts.delete(guildId)
    this.seq.delete(guildId)
  }

  bind(playerControl) {
    playerControl.onStateChanged(async ({ guildId, state }) => {
      await this.handleUpdate(guildId, state)
    })
  }

  async handleUpdate(guildId, state) {
    try {
      const s = (this.seq.get(guildId) || 0) + 1
      this.seq.set(guildId, s)
      const ctx = this.contexts.get(guildId)
      if (!ctx || !ctx.channelId) return
      if (!state.currentTrack) {
        ProgressTracker.stopTracking(guildId)
        return
      }
      // Capture to local variable to prevent race condition during async ops
      const currentTrack = state.currentTrack
      const channel = this.client.channels.cache.get(ctx.channelId) || await this.client.channels.fetch(ctx.channelId)
      const currentTime = AudioManager.getPlayer(guildId).getCurrentTime()
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
          if ((this.seq.get(guildId) || 0) !== s) return
          if (state.isPlaying && state.currentTrack) {
            ProgressTracker.startTracking(guildId, msg)
          } else {
            ProgressTracker.stopTracking(guildId)
          }
        } catch (e) {
          const sent = await channel.send(options)
          this.contexts.set(guildId, { channelId: ctx.channelId, messageId: sent.id })
          if (state.isPlaying && state.currentTrack) {
            ProgressTracker.startTracking(guildId, sent)
          } else {
            ProgressTracker.stopTracking(guildId)
          }
        }
      } else {
        const sent = await channel.send(options)
        this.contexts.set(guildId, { channelId: ctx.channelId, messageId: sent.id })
        if (state.isPlaying && state.currentTrack) {
          ProgressTracker.startTracking(guildId, sent)
        } else {
          ProgressTracker.stopTracking(guildId)
        }
      }
    } catch (e) {
      logger.error('Interface update failed', { guildId, error: e.message })
    }
  }
}

module.exports = new InterfaceUpdater()
