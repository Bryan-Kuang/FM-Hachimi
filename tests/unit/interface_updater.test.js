jest.mock('../../src/ui/embeds', () => ({ createNowPlayingEmbed: () => ({}) }))
jest.mock('../../src/ui/buttons', () => ({ createPlaybackControls: () => [] }))
const InterfaceUpdater = require('../../src/ui/interface_updater')
const PlayerControl = require('../../src/player_control')

test('interface_updater sends message when no lastMessageId', async () => {
  const sent = { id: 'msg-1' }
  const channel = {
    messages: { edit: jest.fn() },
    send: jest.fn().mockResolvedValue(sent)
  }
  const client = { channels: { cache: new Map([['ch-1', channel]]), fetch: jest.fn().mockResolvedValue(channel) } }
  InterfaceUpdater.setClient(client)
  InterfaceUpdater.setPlaybackContext('guild-1', 'ch-1')
  const state = { isPlaying: true, isPaused: false, currentTrack: { title: 't' }, currentIndex: 0, queueLength: 1, hasNext: false, hasPrevious: false, loopMode: 'none' }
  await InterfaceUpdater.handleUpdate('guild-1', state)
  expect(channel.send).toHaveBeenCalled()
})
