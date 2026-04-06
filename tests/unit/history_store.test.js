const HistoryStore = require('../../src/utils/history_store')
const GuildSession = require('../../src/session/guild_session')

// Create a mock sessionManager that produces real GuildSession objects
function createMockSessionManager() {
  const sessions = {}
  return {
    get(guildId) {
      if (!sessions[guildId]) sessions[guildId] = new GuildSession(guildId)
      return sessions[guildId]
    },
    _sessions: sessions,
  }
}

describe('HistoryStore via SessionManager', () => {
  test('adds and evicts oldest when over limit', () => {
    const sm = createMockSessionManager()
    const hs = new HistoryStore(sm)
    const guild = 'g1'
    // Set a small limit on the underlying session
    sm.get(guild).historyLimit = 3
    hs.add(guild, 'a')
    hs.add(guild, 'b')
    hs.add(guild, 'c')
    expect(hs.has(guild, 'a')).toBe(true)
    // add d -> evict a
    hs.add(guild, 'd')
    expect(hs.has(guild, 'a')).toBe(false)
    expect(hs.has(guild, 'b')).toBe(true)
    expect(hs.has(guild, 'c')).toBe(true)
    expect(hs.has(guild, 'd')).toBe(true)
  })

  test('filter removes items present in history', () => {
    const sm = createMockSessionManager()
    const hs = new HistoryStore(sm)
    const guild = 'g2'
    hs.add(guild, 'x')
    hs.add(guild, 'y')
    const candidates = [
      { bvid: 'x', title: 'X' },
      { bvid: 'y', title: 'Y' },
      { bvid: 'z', title: 'Z' },
    ]
    const filtered = hs.filter(guild, candidates)
    const ids = filtered.map(v => v.bvid)
    expect(ids).toContain('z')
    expect(ids).not.toContain('x')
    expect(ids).not.toContain('y')
  })
})
