const locks = new Map()
const lastTimes = new Map()

function keyOf(guildId, action) {
  return `${guildId}:${action}`
}

function acquire(guildId, action) {
  const k = keyOf(guildId, action)
  if (locks.get(k)) return false
  locks.set(k, true)
  return true
}

function release(guildId, action) {
  const k = keyOf(guildId, action)
  locks.delete(k)
}

function shouldDebounce(guildId, action, ms) {
  const k = keyOf(guildId, action)
  const now = Date.now()
  const last = lastTimes.get(k) || 0
  if (now - last < ms) return true
  lastTimes.set(k, now)
  // Clean up expired entries to prevent unbounded Map growth
  if (lastTimes.size > 100) {
    for (const [key, time] of lastTimes) {
      if (now - time > 60000) lastTimes.delete(key)
    }
  }
  return false
}

module.exports = { acquire, release, shouldDebounce }

