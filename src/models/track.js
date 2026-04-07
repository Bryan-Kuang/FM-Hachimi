/**
 * Track
 * Represents a single audio track in the queue.
 * Encapsulates all track metadata and playback state,
 * replacing the plain object that was assembled in AudioPlayer.addToQueue().
 */

const config = require('../config/config')

class Track {
  /**
   * @param {Object} data - Raw video data from BilibiliExtractor
   *   (url, normalizedUrl, audioUrl, originalUrl, title, duration,
   *    bvid, author, thumbnail, extractedAt, …)
   * @param {string} requestedBy - Display name of the requesting Discord user
   */
  constructor(data, requestedBy) {
    // Spread all extractor fields so existing consumers that access
    // track.title / track.audioUrl / track.normalizedUrl etc. keep working.
    Object.assign(this, data)

    // Queue-time fields
    this.requestedBy = requestedBy || null
    this.addedAt     = new Date()
    this.id          = Date.now() + Math.random()
    this.retryCount  = 0
  }

  // ---------------------------------------------------------------------------
  // CDN expiry
  // ---------------------------------------------------------------------------

  /**
   * Returns true when the cached audio URL is older than the configured
   * refresh threshold (default: 20 min).  Only meaningful when the track
   * has an extractedAt timestamp AND a normalizedUrl to re-extract from.
   *
   * @returns {boolean}
   */
  isExpired() {
    if (!this.extractedAt) return false
    const age = Date.now() - new Date(this.extractedAt).getTime()
    return age > config.audio.urlRefreshThreshold
  }

  // ---------------------------------------------------------------------------
  // Retry management
  // ---------------------------------------------------------------------------

  /**
   * Increment the retry counter.  Called before each playback retry attempt.
   */
  incrementRetry() {
    this.retryCount = (this.retryCount || 0) + 1
  }

  /**
   * Reset the retry counter to zero.
   * Used when entering track-loop mode so loop repetitions don't count
   * as failures.
   */
  resetRetry() {
    this.retryCount = 0
  }
}

module.exports = Track
