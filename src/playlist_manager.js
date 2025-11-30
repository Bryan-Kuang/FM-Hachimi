const EventEmitter = require('events')
const AudioManager = require('./audio/manager')
const logger = require('./logger_service')

class PlaylistManager {
  constructor() {
    this.emitter = new EventEmitter()
    this.audioManager = null
  }

  initialize(audioManager) {
    this.audioManager = audioManager || AudioManager
  }

  onMessage(handler) {
    this.emitter.on('playlist_message', handler)
  }

  emitMessage(guildId, text) {
    this.emitter.emit('playlist_message', { guildId, text })
  }

  async add(guildId, videoOrUrl, requestedBy) {
    try {
      const player = this.audioManager.getPlayer(guildId)
      let videoData = videoOrUrl
      if (typeof videoOrUrl === 'string') {
        const extractor = this.audioManager.getExtractor()
        if (!extractor) {
          throw new Error('Extractor not available')
        }
        videoData = await extractor.extractAudio(videoOrUrl)
      }
      const track = player.addToQueue(videoData, requestedBy)
      this.emitMessage(guildId, `✅ Added: ${track.title}`)
      return track
    } catch (e) {
      logger.error('Add to playlist failed', { guildId, error: e.message })
      this.emitMessage(guildId, `❌ Add failed: ${e.message}`)
      return null
    }
  }

  remove(guildId, index) {
    try {
      const player = this.audioManager.getPlayer(guildId)
      const ok = player.removeFromQueue(index)
      this.emitMessage(guildId, ok ? `🗑️ Removed #${index + 1}` : `❌ Remove failed #${index + 1}`)
      return ok
    } catch (e) {
      logger.error('Remove from playlist failed', { guildId, index, error: e.message })
      this.emitMessage(guildId, `❌ Remove failed: ${e.message}`)
      return false
    }
  }
}

module.exports = new PlaylistManager()

