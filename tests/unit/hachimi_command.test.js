jest.mock('discord.js', () => ({
  SlashCommandBuilder: function () {
    return {
      setName: function () { return this },
      setDescription: function () { return this },
    }
  },
}))

jest.mock('../../src/ui/embeds', () => ({
  createSuccessEmbed: () => ({
    addFields: function () { return this },
  }),
  createErrorEmbed: () => ({
    addFields: function () { return this },
  }),
  createLoadingEmbed: () => ({
    addFields: function () { return this },
  }),
  createNowPlayingEmbed: () => ({
    addFields: function () { return this },
  }),
}))

const hachimi = require('../../src/bot/commands/hachimi')

describe('hachimi command integration with PlayerControl', () => {
  test('searchAndAddHachimiVideos uses PlayerControl.play when idle', async () => {
    const mockInteraction = {
      guild: { id: 'test-guild', name: 'Test Guild' },
      channelId: 'test-channel',
      member: { voice: { channel: { id: 'vc-1', name: 'Voice 1', guild: { id: 'test-guild', voiceAdapterCreator: {} } } } },
      replied: true,
      deferred: true,
      editReply: jest.fn().mockResolvedValue({}),
    }

    const audioManager = {
      getExtractor: () => ({ dummy: true }),
      getPlayer: () => ({
        voiceConnection: null,
        joinVoiceChannel: jest.fn().mockResolvedValue(true),
        clearQueue: jest.fn(),
        isPlaying: false,
        isPaused: false,
        currentTrack: null,
      }),
    }

    const bilibiliApi = require('../../src/utils/bilibiliApi')
    jest.spyOn(bilibiliApi, 'searchHachimiVideos').mockResolvedValue([
      { url: 'https://www.bilibili.com/video/BV1xx1' },
      { url: 'https://www.bilibili.com/video/BV2xx2' },
    ])

    const PlaylistManager = require('../../src/playlist/playlist_manager')
    jest.spyOn(PlaylistManager, 'add').mockResolvedValue({ title: 'Mock Track' })

    const PlayerControl = require('../../src/control/player_control')
    const playSpy = jest.spyOn(PlayerControl, 'play').mockResolvedValue(true)

    await hachimi.searchAndAddHachimiVideos(mockInteraction, audioManager, 'Tester')

    expect(playSpy).toHaveBeenCalledWith('test-guild')
  })
})
