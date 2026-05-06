jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}))

const PlayerService = require('../../src/services/player_service')

test('playerService emits state on notifyState', () => {
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
  const playerService = new PlayerService({
    audioManager: mockAudioManager,
    interfaceUpdater: { setPlaybackContext: jest.fn(), clearContext: jest.fn(), hasContext: jest.fn() },
    progressTracker: {},
    extractor: {},
  })
  let received = null
  playerService.onStateChanged((p) => { received = p })
  playerService.notifyState('guild-1')
  expect(received).toBeTruthy()
  expect(received.guildId).toBe('guild-1')
  expect(received.state.isPlaying).toBe(false)
})
