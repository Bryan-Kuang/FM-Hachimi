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

test('interface_updater starts progress tracking while playback is buffering', async () => {
  const sent = { id: 'msg-1' }
  const channel = {
    messages: { edit: jest.fn() },
    send: jest.fn().mockResolvedValue(sent)
  }
  const client = { channels: { cache: new Map([['ch-1', channel]]), fetch: jest.fn().mockResolvedValue(channel) } }

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

  const bufferingState = {
    isPlaying: false,
    isPaused: false,
    currentTrack: { title: 'buffering track' },
    currentIndex: 0,
    queueLength: 1,
    hasNext: false,
    hasPrevious: false,
    loopMode: 'queue'
  }

  await updater.handleUpdate('guild-1', bufferingState)

  expect(mockProgressTracker.startTracking).toHaveBeenCalledWith(
    'guild-1',
    sent,
    expect.any(Function)
  )
  expect(mockProgressTracker.stopTracking).not.toHaveBeenCalled()
})

test('interface_updater does not send a replacement play card when radio card edit fails', async () => {
  const channel = {
    messages: { edit: jest.fn().mockRejectedValue(new Error('message edit failed')) },
    send: jest.fn()
  }
  const client = { channels: { cache: new Map([['ch-1', channel]]), fetch: jest.fn().mockResolvedValue(channel) } }

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
  updater.setPlaybackContext('guild-1', 'ch-1', 'msg-1')

  const radioState = {
    isPlaying: true,
    isPaused: false,
    currentTrack: { title: 'radio track' },
    currentIndex: 0,
    queueLength: 1,
    hasNext: false,
    hasPrevious: false,
    loopMode: 'none',
    radioMode: true
  }

  await updater.handleUpdate('guild-1', radioState)

  expect(channel.send).not.toHaveBeenCalled()
  expect(sessions['guild-1'].uiContext).toEqual({ channelId: 'ch-1', messageId: 'msg-1' })
  expect(mockProgressTracker.stopTracking).toHaveBeenCalledWith('guild-1')
})

describe('one now-playing card per guild', () => {
  const fs = require('fs')
  const os = require('os')
  const path = require('path')

  function makeUpdater(options) {
    let nextId = 0
    const channel = {
      messages: { edit: jest.fn().mockResolvedValue({ id: 'edited' }), delete: jest.fn().mockResolvedValue(undefined) },
      send: jest.fn(() => new Promise((resolve) => setTimeout(() => resolve({ id: `msg-${++nextId}` }), 5))),
    }
    const client = { channels: { cache: new Map([['ch-1', channel]]), fetch: jest.fn().mockResolvedValue(channel) } }
    const sessions = {}
    const sessionManager = {
      get(guildId) {
        if (!sessions[guildId]) sessions[guildId] = { uiContext: null, uiSeq: 0 }
        return sessions[guildId]
      },
    }
    const state = { isPlaying: true, isPaused: false, currentTrack: { title: 't' }, currentIndex: 0, queueLength: 1, hasNext: false, hasPrevious: false, loopMode: 'none', radioMode: true }
    const audioManager = {
      getPlayer: () => ({
        getCurrentTime: () => 0,
        getState: () => state,
        isPlaying: true,
        currentTrack: state.currentTrack,
      }),
    }
    const updater = new InterfaceUpdater(sessionManager, { startTracking: jest.fn(), stopTracking: jest.fn() }, audioManager, options)
    updater.setClient(client)
    return { updater, channel, sessions, state }
  }

  test('overlapping updates with no live card send only one card', async () => {
    const { updater, channel, state } = makeUpdater()
    updater.setPlaybackContext('g1', 'ch-1')

    await Promise.all([updater.handleUpdate('g1', state), updater.handleUpdate('g1', state)])

    expect(channel.send).toHaveBeenCalledTimes(1)
  })

  test('a fresh card deletes the card left over from before a restart', async () => {
    const file = path.join(os.tmpdir(), `cards-${Date.now()}.json`)
    fs.writeFileSync(file, JSON.stringify({ g1: { channelId: 'ch-1', messageId: 'old-card' } }))
    try {
      const { updater, channel, state } = makeUpdater({ cardStateFile: file })
      updater.setPlaybackContext('g1', 'ch-1')

      await updater.handleUpdate('g1', state)

      expect(channel.messages.delete).toHaveBeenCalledWith('old-card')
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ g1: { channelId: 'ch-1', messageId: 'msg-1' } })
    } finally {
      fs.rmSync(file, { force: true })
    }
  })
})
