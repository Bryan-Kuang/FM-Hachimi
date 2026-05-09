jest.mock('discord.js', () => ({
  SlashCommandBuilder: function () {
    return {
      setName: function () { return this },
      setDescription: function () { return this },
    }
  },
  MessageFlags: { Ephemeral: 64 },
}))

jest.mock('../../src/ui/embeds', () => ({
  createSuccessEmbed: () => ({
    addFields: function () { return this },
    setFooter: function () { return this },
  }),
  createErrorEmbed: () => ({
    addFields: function () { return this },
    setFooter: function () { return this },
  }),
  createLoadingEmbed: () => ({
    addFields: function () { return this },
    setFooter: function () { return this },
  }),
  createNowPlayingEmbed: () => ({
    addFields: function () { return this },
    setFooter: function () { return this },
  }),
}))

jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}))

jest.mock('../../src/utils/command_queue', () => ({
  getQueue: () => ({ isFull: () => false, count: 0 }),
  run: async (guildId, name, fn) => await fn(),
}))

describe('hachimi command integration with PlaybackService', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    const bilibiliApi = require('../../src/bilibili/api')
    delete bilibiliApi.recordHachimiHistory
  })

  test('searchAndAddHachimiVideos uses playbackService.play when idle', async () => {
    const mockPlaybackService = {
      setUIContext: jest.fn(),
      getExtractor: () => ({ dummy: true }),
      getPlayer: () => ({
        voiceConnection: null,
        joinVoiceChannel: jest.fn().mockResolvedValue(true),
        clearQueue: jest.fn(),
        isPlaying: false,
        isPaused: false,
        currentTrack: null,
        stop: jest.fn(),
      }),
      addTrack: jest.fn().mockResolvedValue({ title: 'Mock Track' }),
      play: jest.fn().mockResolvedValue(true),
      notifyState: jest.fn(),
      _notifyState: jest.fn(),
    }

    const mockQueueService = {
      getExtractor: () => ({ dummy: true }),
      addTrack: jest.fn().mockResolvedValue({ title: 'Mock Track' }),
    }

    const createHachimiCommand = require('../../src/bot/commands/hachimi')
    const hachimi = createHachimiCommand(mockPlaybackService, mockQueueService)

    const mockInteraction = {
      guild: { id: 'test-guild', name: 'Test Guild' },
      channelId: 'test-channel',
      member: { voice: { channel: { id: 'vc-1', name: 'Voice 1', guild: { id: 'test-guild', voiceAdapterCreator: {} } } } },
      replied: true,
      deferred: true,
      editReply: jest.fn().mockResolvedValue({}),
    }

    const bilibiliApi = require('../../src/bilibili/api')
    jest.spyOn(bilibiliApi, 'searchHachimiVideos').mockResolvedValue({
      results: [
        { url: 'https://www.bilibili.com/video/BV1xx1' },
        { url: 'https://www.bilibili.com/video/BV2xx2' },
      ],
    })

    await hachimi.searchAndAddHachimiVideos(mockInteraction, 'Tester')

    expect(mockPlaybackService.play).toHaveBeenCalledWith('test-guild')
  })

  test('searchAndAddHachimiVideos records in-memory history only for queued videos', async () => {
    const player = {
      voiceConnection: null,
      joinVoiceChannel: jest.fn().mockResolvedValue(true),
      clearQueue: jest.fn(),
      isPlaying: false,
      isPaused: false,
      currentTrack: null,
      stop: jest.fn(),
    }
    const mockPlaybackService = {
      getPlayer: () => player,
      play: jest.fn().mockResolvedValue(true),
      notifyState: jest.fn(),
    }

    const mockQueueService = {
      getExtractor: () => ({ dummy: true }),
      addTrack: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ title: 'Queued Track' }),
    }

    const createHachimiCommand = require('../../src/bot/commands/hachimi')
    const hachimi = createHachimiCommand(mockPlaybackService, mockQueueService)

    const mockInteraction = {
      guild: { id: 'test-guild', name: 'Test Guild' },
      channelId: 'test-channel',
      member: { voice: { channel: { id: 'vc-1', name: 'Voice 1', guild: { id: 'test-guild', voiceAdapterCreator: {} } } } },
      user: { id: 'user-1' },
      replied: true,
      deferred: true,
      editReply: jest.fn().mockResolvedValue({}),
    }

    const bilibiliApi = require('../../src/bilibili/api')
    bilibiliApi.recordHachimiHistory = jest.fn()
    jest.spyOn(bilibiliApi, 'searchHachimiVideos').mockResolvedValue({
      results: [
        { bvid: 'BVfailed', url: 'https://www.bilibili.com/video/BVfailed' },
        { bvid: 'BVqueued', url: 'https://www.bilibili.com/video/BVqueued' },
      ],
    })

    await hachimi.searchAndAddHachimiVideos(mockInteraction, 'Tester')

    expect(bilibiliApi.recordHachimiHistory).toHaveBeenCalledTimes(1)
    expect(bilibiliApi.recordHachimiHistory).toHaveBeenCalledWith('test-guild', 'BVqueued')
    expect(bilibiliApi.recordHachimiHistory).not.toHaveBeenCalledWith('test-guild', 'BVfailed')
  })
})
