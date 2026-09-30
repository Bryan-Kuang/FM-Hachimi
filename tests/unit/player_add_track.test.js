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
