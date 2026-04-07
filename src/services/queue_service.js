/**
 * Queue Service
 * Manages queue operations: adding/removing tracks, loop mode, shuffle.
 * Extracted from PlaybackService to give each class a single responsibility.
 *
 * PlaybackService  → playback control (play/pause/resume/skip/stop)
 * QueueService     → queue management  (add/remove/clear/shuffle/loop)
 */

const logger = require('./logger_service')

class QueueService {
  /**
   * @param {Object} deps
   * @param {Object} deps.audioManager - AudioManager instance
   * @param {Object} deps.extractor    - BilibiliExtractor instance
   */
  constructor({ audioManager, extractor } = {}) {
    this.audioManager = audioManager
    this.extractor    = extractor || null
  }

  /**
   * Expose the extractor so commands can validate its availability.
   * @returns {Object|null}
   */
  getExtractor() {
    return this.extractor
  }

  // ---------------------------------------------------------------------------
  // Track operations
  // ---------------------------------------------------------------------------

  /**
   * Add a track to the guild queue.
   * Accepts either a video data object (from BilibiliExtractor) or a raw URL.
   *
   * @param {string}        guildId      - Discord guild ID
   * @param {Object|string} videoOrUrl   - Extracted video data or Bilibili URL
   * @param {string}        requestedBy  - Display name of the requesting user
   * @returns {Promise<Object|null>} The Track object, or null on failure
   */
  async addTrack(guildId, videoOrUrl, requestedBy) {
    try {
      const player = this.audioManager.getPlayer(guildId)
      let videoData = videoOrUrl

      if (typeof videoOrUrl === 'string') {
        if (!this.extractor) throw new Error('Extractor not available')
        videoData = await this.extractor.extractAudio(videoOrUrl)
      }

      const track = player.addToQueue(videoData, requestedBy)
      return track
    } catch (e) {
      logger.error('Add to queue failed', { guildId, error: e.message })
      return null
    }
  }

  /**
   * Remove a track from the queue by its display index (0-based).
   *
   * @param {string} guildId
   * @param {number} index
   * @returns {boolean}
   */
  removeTrack(guildId, index) {
    try {
      const player = this.audioManager.getPlayer(guildId)
      return player.removeFromQueue(index)
    } catch (e) {
      logger.error('Remove from queue failed', { guildId, index, error: e.message })
      return false
    }
  }

  /**
   * Clear all tracks from the queue.
   *
   * @param {string} guildId
   * @returns {boolean}
   */
  clearQueue(guildId) {
    try {
      const player = this.audioManager.getPlayer(guildId)
      player.clearQueue()
      return true
    } catch (e) {
      logger.error('Clear queue failed', { guildId, error: e.message })
      return false
    }
  }

  /**
   * Shuffle the queue.
   *
   * @param {string} guildId
   * @returns {Object} Result with success flag and player state
   */
  shuffleQueue(guildId) {
    return this.audioManager.shuffleQueue(guildId)
  }

  // ---------------------------------------------------------------------------
  // Loop mode
  // ---------------------------------------------------------------------------

  /**
   * Set loop mode for a guild.
   *
   * @param {string} guildId
   * @param {string} mode - 'none' | 'queue' | 'track'
   * @returns {Object} Result with success flag
   */
  setLoopMode(guildId, mode) {
    return this.audioManager.setLoopMode(guildId, mode)
  }

  /**
   * Get current loop mode for a guild.
   *
   * @param {string} guildId
   * @returns {string}
   */
  getLoopMode(guildId) {
    const player = this.audioManager.getPlayer(guildId)
    return player.loopMode
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Get queue info for a guild, formatted for display.
   *
   * @param {string} guildId
   * @returns {Object} { queue, currentTrack, state }
   */
  getQueue(guildId) {
    return this.audioManager.getQueue(guildId)
  }
}

module.exports = QueueService
