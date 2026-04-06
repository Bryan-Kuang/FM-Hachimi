jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}))

const PlaybackService = require('../../src/services/playback_service')

test('playbackService addTrack emits message', async () => {
  const mockTrack = { title: 'Test Track' }
  const mockPlayer = { addToQueue: () => mockTrack }
  const mockExtractor = { extractAudio: async () => ({ title: 'Test Track' }) }
  const mockAudioManager = { getPlayer: () => mockPlayer }
  const ps = new PlaybackService({
    audioManager: mockAudioManager,
    interfaceUpdater: {},
    progressTracker: {},
    extractor: mockExtractor,
  })
  let received = null
  ps.on('playlist_message', (m) => { received = m })
  const track = await ps.addTrack('guild-1', 'https://example.com/video', 'user')
  expect(track.title).toBe('Test Track')
  expect(received).toBeTruthy()
  expect(received.text).toMatch(/Added/)
})
