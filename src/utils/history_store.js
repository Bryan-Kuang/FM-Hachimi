class HistoryStore {
  constructor(limit = 50) {
    this.limit = limit
    this.guildHistory = new Map()
  }

  ensure(guildId) {
    if (!this.guildHistory.has(guildId)) {
      this.guildHistory.set(guildId, new Set())
    }
    return this.guildHistory.get(guildId)
  }

  has(guildId, bvid) {
    const set = this.ensure(guildId)
    return set.has(bvid)
  }

  add(guildId, bvid) {
    const set = this.ensure(guildId)
    // move to tail (newest)
    if (set.has(bvid)) set.delete(bvid)
    set.add(bvid)
    // evict oldest if over limit
    while (set.size > this.limit) {
      const oldest = set.values().next().value
      set.delete(oldest)
    }
  }

  filter(guildId, candidates) {
    const set = this.ensure(guildId)
    return (Array.isArray(candidates) ? candidates : []).filter(v => !set.has(v.bvid))
  }
}

module.exports = new HistoryStore()

