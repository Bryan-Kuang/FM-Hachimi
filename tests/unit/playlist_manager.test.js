const PlaylistManager = require('../../src/playlist_manager')

test('playlist_manager add emits text message', async () => {
  const mockTrack = { title: 'Test Track' }
  const mockPlayer = { addToQueue: () => mockTrack, removeFromQueue: () => true }
  const mockExtractor = { extractAudio: async () => ({ title: 'Test Track' }) }
  const mockAudioManager = { getPlayer: () => mockPlayer, getExtractor: () => mockExtractor }
  PlaylistManager.initialize(mockAudioManager)
  let received = null
  PlaylistManager.onMessage((m) => { received = m })
  const track = await PlaylistManager.add('guild-1', 'https://example.com/video', 'user')
  expect(track.title).toBe('Test Track')
  expect(received).toBeTruthy()
  expect(received.text).toMatch(/Added/)
})

