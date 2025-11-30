const PlayerControl = require('../../src/player_control')

test('player_control emits state on notifyState', () => {
  const mockPlayer = { getState: () => ({ isPlaying: false, isPaused: false, currentTrack: null, currentIndex: -1, queueLength: 0, hasNext: false, hasPrevious: false, loopMode: 'none' }) }
  const mockAudioManager = { getPlayer: () => mockPlayer }
  PlayerControl.initialize(mockAudioManager)
  let received = null
  PlayerControl.onStateChanged((p) => { received = p })
  PlayerControl.notifyState('guild-1')
  expect(received).toBeTruthy()
  expect(received.guildId).toBe('guild-1')
  expect(received.state.isPlaying).toBe(false)
})

