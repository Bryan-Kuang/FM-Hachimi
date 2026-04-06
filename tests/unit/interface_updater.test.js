jest.mock('../../src/ui/embeds', () => ({ createNowPlayingEmbed: () => ({}) }))
jest.mock('../../src/ui/buttons', () => ({ createPlaybackControls: () => [] }))
jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}))

const InterfaceUpdater = require('../../src/ui/interface_updater')

test('interface_updater sends message when no lastMessageId', async () => {
  const sent = { id: 'msg-1' }
  const channel = {
    messages: { edit: jest.fn() },
    send: jest.fn().mockResolvedValue(sent)
  }
  const client = { channels: { cache: new Map([['ch-1', channel]]), fetch: jest.fn().mockResolvedValue(channel) } }

  // Create mock sessionManager
  const sessions = {}
  const mockSessionManager = {
    get(guildId) {
      if (!sessions[guildId]) sessions[guildId] = { uiContext: null, uiSeq: 0 }
      return sessions[guildId]
    }
  }
  const mockProgressTracker = { startTracking: jest.fn(), stopTracking: jest.fn() }
  const mockAudioManager = { getPlayer: () => ({ getCurrentTime: () => 0 }) }

  const updater = new InterfaceUpdater(mockSessionManager, mockProgressTracker, mockAudioManager)
  updater.setClient(client)
  updater.setPlaybackContext('guild-1', 'ch-1')
  const state = { isPlaying: true, isPaused: false, currentTrack: { title: 't' }, currentIndex: 0, queueLength: 1, hasNext: false, hasPrevious: false, loopMode: 'none' }
  await updater.handleUpdate('guild-1', state)
  expect(channel.send).toHaveBeenCalled()
})
