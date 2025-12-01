const HistoryStore = require('../../src/utils/history_store')

describe('HistoryStore LRU behavior', () => {
  test('adds and evicts oldest when over limit', () => {
    const hs = require('../../src/utils/history_store')
    const guild = 'g1'
    // use small limit
    hs.limit = 3
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
    const hs = require('../../src/utils/history_store')
    const guild = 'g2'
    hs.limit = 50
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

