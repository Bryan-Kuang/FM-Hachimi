jest.mock('../../src/ui/embeds', () => ({ createNowPlayingEmbed: () => ({}) }))
jest.mock('../../src/ui/buttons', () => ({ createPlaybackControls: () => [] }))
jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}))

const InterfaceUpdater = require('../../src/ui/interface_updater')
const PlayerService = require('../../src/services/player_service')

function createTestSetup() {
  const sessions = {}
  const mockSessionManager = {
    get(guildId) {
      if (!sessions[guildId]) sessions[guildId] = { uiContext: null, uiSeq: 0 }
      return sessions[guildId]
    }
  }
  const mockProgressTracker = { startTracking: jest.fn(), stopTracking: jest.fn() }
  const mockPlayer = { getCurrentTime: () => 0, getState: () => ({ isPlaying: false }) }
  const mockAudioManager = { getPlayer: () => mockPlayer }

  const updater = new InterfaceUpdater(mockSessionManager, mockProgressTracker, mockAudioManager)
  const playerService = new PlayerService({
    audioManager: mockAudioManager,
    interfaceUpdater: updater,
    progressTracker: mockProgressTracker,
    extractor: {},
  })

  return { updater, playerService, mockSessionManager }
}

test('event-driven UI: first send then edit on subsequent updates', async () => {
  const { updater, playerService } = createTestSetup()
  const sent1 = { id: 'msg-1' }
  const channel = {
    messages: { edit: jest.fn().mockResolvedValue(sent1) },
    send: jest.fn().mockResolvedValue(sent1)
  }
  const client = { channels: { cache: new Map([['ch-1', channel]]), fetch: jest.fn().mockResolvedValue(channel) } }
  updater.setClient(client)
  updater.setPlaybackContext('guild-1', 'ch-1')
  const state1 = { isPlaying: true, isPaused: false, currentTrack: { title: 'A' }, currentIndex: 0, queueLength: 1, hasNext: true, hasPrevious: false, loopMode: 'none' }
  const state2 = { isPlaying: true, isPaused: false, currentTrack: { title: 'B' }, currentIndex: 1, queueLength: 2, hasNext: false, hasPrevious: true, loopMode: 'queue' }

  // Bind and emit events
  updater.bind(playerService)
  playerService._emitState('guild-1', state1, state1.currentTrack)
  await new Promise(r => setTimeout(r, 10))
  expect(channel.send).toHaveBeenCalledTimes(1)

  // Subsequent update should edit
  updater.setPlaybackContext('guild-1', 'ch-1', 'msg-1')
  playerService._emitState('guild-1', state2, state2.currentTrack)
  await new Promise(r => setTimeout(r, 10))
  expect(channel.messages.edit).toHaveBeenCalledTimes(1)
})

test('concurrent updates resolve to latest state', async () => {
  const { updater, playerService } = createTestSetup()
  const channel = {
    messages: { edit: jest.fn() },
    send: jest.fn().mockResolvedValue({ id: 'msg-2' })
  }
  const client = { channels: { cache: new Map([['ch-2', channel]]), fetch: jest.fn().mockResolvedValue(channel) } }
  updater.setClient(client)
  updater.setPlaybackContext('guild-2', 'ch-2')
  const sA = { isPlaying: true, isPaused: false, currentTrack: { title: 'A' }, currentIndex: 0, queueLength: 1, hasNext: true, hasPrevious: false, loopMode: 'none' }
  const sB = { isPlaying: true, isPaused: false, currentTrack: { title: 'B' }, currentIndex: 1, queueLength: 2, hasNext: false, hasPrevious: true, loopMode: 'queue' }

  updater.bind(playerService)
  playerService._emitState('guild-2', sA, sA.currentTrack)
  playerService._emitState('guild-2', sB, sB.currentTrack)
  await new Promise(r => setTimeout(r, 10))
  expect(channel.send).toHaveBeenCalled()
})
