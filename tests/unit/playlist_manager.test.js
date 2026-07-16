jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}))

const PlayerService = require('../../src/services/player_service')

test('playerService addTrack returns track', async () => {
  const mockTrack = { title: 'Test Track' }
  const mockPlayer = { addToQueue: () => mockTrack }
  const mockExtractor = { extractAudio: async () => ({ title: 'Test Track' }) }
  const mockAudioManager = { getPlayer: () => mockPlayer }
  const ps = new PlayerService({
    audioManager: mockAudioManager,
    interfaceUpdater: { setPlaybackContext: jest.fn(), clearContext: jest.fn(), hasContext: jest.fn() },
    progressTracker: {},
    extractor: mockExtractor,
  })
  const track = await ps.addTrack('guild-1', 'https://example.com/video', 'user')
  expect(track.title).toBe('Test Track')
})

// ─── playTrackAt (Task 2.2 — bulk-enqueue seam) ───────────────────

describe('playerService.playTrackAt', () => {
  function buildService(playerOverrides = {}) {
    const mockPlayer = {
      playTrack: jest.fn().mockResolvedValue(true),
      getState: jest.fn().mockReturnValue({ currentTrack: { title: 'Jumped Track' } }),
      ...playerOverrides,
    }
    const mockAudioManager = { getPlayer: jest.fn().mockReturnValue(mockPlayer) }
    const ps = new PlayerService({
      audioManager: mockAudioManager,
      interfaceUpdater: { setPlaybackContext: jest.fn(), clearContext: jest.fn(), hasContext: jest.fn() },
      progressTracker: {},
      extractor: {},
    })
    return { ps, mockPlayer, mockAudioManager }
  }

  test('delegates to player.playTrack(index)', async () => {
    const { ps, mockPlayer } = buildService()

    const result = await ps.playTrackAt('guild-1', 3)

    expect(mockPlayer.playTrack).toHaveBeenCalledWith(3)
    expect(result).toBe(true)
  })

  test('emits player_state_changed after playing', async () => {
    const { ps } = buildService()
    const handler = jest.fn()
    ps.onStateChanged(handler)

    await ps.playTrackAt('guild-1', 0)

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      guildId: 'guild-1',
      track: { title: 'Jumped Track' },
    }))
  })

  test('returns false and swallows errors from the player', async () => {
    const { ps } = buildService({
      playTrack: jest.fn().mockRejectedValue(new Error('boom')),
    })

    const result = await ps.playTrackAt('guild-1', 0)

    expect(result).toBe(false)
  })

  test('returns false when playTrack resolves false (invalid index)', async () => {
    const { ps, mockPlayer } = buildService({
      playTrack: jest.fn().mockResolvedValue(false),
    })

    const result = await ps.playTrackAt('guild-1', 99)

    expect(mockPlayer.playTrack).toHaveBeenCalledWith(99)
    expect(result).toBe(false)
  })
})
