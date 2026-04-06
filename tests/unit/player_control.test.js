jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}))

const PlaybackService = require('../../src/services/playback_service')

test('playbackService emits state on notifyState', () => {
  const mockPlayer = {
    getState: () => ({
      isPlaying: false,
      isPaused: false,
      currentTrack: null,
      currentIndex: -1,
      queueLength: 0,
      hasNext: false,
      hasPrevious: false,
      loopMode: 'none',
    }),
  }
  const mockAudioManager = { getPlayer: () => mockPlayer }
  const playbackService = new PlaybackService({
    audioManager: mockAudioManager,
    interfaceUpdater: {},
    progressTracker: {},
    extractor: {},
  })
  let received = null
  playbackService.onStateChanged((p) => { received = p })
  playbackService.notifyState('guild-1')
  expect(received).toBeTruthy()
  expect(received.guildId).toBe('guild-1')
  expect(received.state.isPlaying).toBe(false)
})
