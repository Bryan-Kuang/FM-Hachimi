jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}))

const QueueService = require('../../src/services/queue_service')

test('queueService addTrack returns track', async () => {
  const mockTrack = { title: 'Test Track' }
  const mockPlayer = { addToQueue: () => mockTrack }
  const mockExtractor = { extractAudio: async () => ({ title: 'Test Track' }) }
  const mockAudioManager = { getPlayer: () => mockPlayer }
  const qs = new QueueService({
    audioManager: mockAudioManager,
    extractor: mockExtractor,
  })
  const track = await qs.addTrack('guild-1', 'https://example.com/video', 'user')
  expect(track.title).toBe('Test Track')
})
