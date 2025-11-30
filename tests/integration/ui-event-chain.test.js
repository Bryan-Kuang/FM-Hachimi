jest.mock('../../src/ui/embeds', () => ({ createNowPlayingEmbed: () => ({}) }))
jest.mock('../../src/ui/buttons', () => ({ createPlaybackControls: () => [] }))
const InterfaceUpdater = require('../../src/ui/interface_updater')
const PlayerControl = require('../../src/control/player_control')

test('event-driven UI: first send then edit on subsequent updates', async () => {
  const sent1 = { id: 'msg-1' }
  const channel = {
    messages: { edit: jest.fn() },
    send: jest.fn().mockResolvedValue(sent1)
  }
  const client = { channels: { cache: new Map([['ch-1', channel]]), fetch: jest.fn().mockResolvedValue(channel) } }
  InterfaceUpdater.setClient(client)
  InterfaceUpdater.setPlaybackContext('guild-1', 'ch-1')
  const state1 = { isPlaying: true, isPaused: false, currentTrack: { title: 'A' }, currentIndex: 0, queueLength: 1, hasNext: true, hasPrevious: false, loopMode: 'none' }
  const state2 = { isPlaying: true, isPaused: false, currentTrack: { title: 'B' }, currentIndex: 1, queueLength: 2, hasNext: false, hasPrevious: true, loopMode: 'queue' }

  // Bind and emit events
  PlayerControl.onStateChanged(async ({ guildId, state }) => { await InterfaceUpdater.handleUpdate(guildId, state) })
  PlayerControl.emitState('guild-1', state1, state1.currentTrack)
  await Promise.resolve()
  expect(channel.send).toHaveBeenCalledTimes(1)

  // Subsequent update should edit
  InterfaceUpdater.setPlaybackContext('guild-1', 'ch-1', 'msg-1')
  PlayerControl.emitState('guild-1', state2, state2.currentTrack)
  await Promise.resolve()
  expect(channel.messages.edit).toHaveBeenCalledTimes(1)
})

test('concurrent updates resolve to latest state', async () => {
  const channel = {
    messages: { edit: jest.fn() },
    send: jest.fn().mockResolvedValue({ id: 'msg-2' })
  }
  const client = { channels: { cache: new Map([['ch-2', channel]]), fetch: jest.fn().mockResolvedValue(channel) } }
  InterfaceUpdater.setClient(client)
  InterfaceUpdater.setPlaybackContext('guild-2', 'ch-2')
  const sA = { isPlaying: true, isPaused: false, currentTrack: { title: 'A' }, currentIndex: 0, queueLength: 1, hasNext: true, hasPrevious: false, loopMode: 'none' }
  const sB = { isPlaying: true, isPaused: false, currentTrack: { title: 'B' }, currentIndex: 1, queueLength: 2, hasNext: false, hasPrevious: true, loopMode: 'queue' }

  PlayerControl.onStateChanged(async ({ guildId, state }) => { await InterfaceUpdater.handleUpdate(guildId, state) })
  PlayerControl.emitState('guild-2', sA, sA.currentTrack)
  PlayerControl.emitState('guild-2', sB, sB.currentTrack)
  await Promise.resolve()
  expect(channel.send).toHaveBeenCalled()
})

