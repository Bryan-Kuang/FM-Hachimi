const EmbedBuilders = require('../ui/embeds')
const ButtonBuilders = require('../ui/buttons')
const logger = require('../logger_service')

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
      const channel = this.client.channels.cache.get(ctx.channelId) || await this.client.channels.fetch(ctx.channelId)
      const embed = EmbedBuilders.createNowPlayingEmbed(state.currentTrack, {
        requestedBy: state.currentTrack?.requestedBy,
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
        } catch (e) {
          const sent = await channel.send(options)
          this.contexts.set(guildId, { channelId: ctx.channelId, messageId: sent.id })
        }
      } else {
        const sent = await channel.send(options)
        this.contexts.set(guildId, { channelId: ctx.channelId, messageId: sent.id })
      }
    } catch (e) {
      logger.error('Interface update failed', { guildId, error: e.message })
    }
  }
}

module.exports = new InterfaceUpdater()
