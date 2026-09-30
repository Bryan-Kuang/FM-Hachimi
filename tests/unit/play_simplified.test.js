jest.mock('discord.js', () => jest.requireActual('discord.js'));
jest.mock('../../src/services/logger_service', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/bilibili/api', () => ({ searchVideos: jest.fn().mockResolvedValue([]) }));
jest.mock('../../src/playback/playback_coordinator', () => ({ playUrl: jest.fn().mockResolvedValue({ success: true, track: { title: 'Selected video' } }) }));

const createPlay = require('../../src/bot/commands/play');
const api = require('../../src/bilibili/api');
const coordinator = require('../../src/playback/playback_coordinator');
const sessions = require('../../src/search/search_session_store');

function interaction(query) {
  return {
    options: { getString: name => name === 'query' ? query : null },
    member: { voice: { channel: { id: 'voice' } } },
    guild: { id: 'guild', members: { me: { voice: { channel: null } } } },
    user: { id: 'user', username: 'Listener' }, channelId: 'text',
    reply: jest.fn().mockResolvedValue(), deferReply: jest.fn().mockResolvedValue(),
    editReply: jest.fn().mockResolvedValue(), deferred: true,
  };
}

describe('simplified playback entry point', () => {
  let youtube, service;
  beforeEach(() => {
    jest.clearAllMocks();
    api.searchVideos.mockResolvedValue([{ bvid: 'BV1xx411c7BF', title: 'Bili song', duration: 120 }]);
    youtube = { searchVideos: jest.fn().mockResolvedValue({ success: true, results: [{ id: 'dQw4w9WgXcQ', title: 'YouTube song', duration: 120 }] }) };
    service = { getYouTubeExtractor: () => youtube, prewarmBilibiliUrls: jest.fn(), prewarmYouTubeUrls: jest.fn() };
  });

  test('offers only the required query with no platform or attachment option', () => {
    const options = createPlay(service).data.toJSON().options;
    expect(options.map(option => option.name)).toEqual(['query']);
    expect(options[0].required).toBe(true);
  });

  test('always searches both platforms and displays playable entries together', async () => {
    const i = interaction('song');
    const create = jest.spyOn(sessions, 'create');
    await createPlay(service).execute(i);
    expect(create).toHaveBeenCalled();
    const session = create.mock.calls.at(-1)[0];
    expect(session.mode).toBe('mixed');
    expect(session.entries.map(entry => [entry.platform, entry.title])).toEqual([
      ['bilibili', 'Bili song'], ['youtube', 'YouTube song'],
    ]);
    expect(api.searchVideos).toHaveBeenCalled();
    expect(youtube.searchVideos).toHaveBeenCalled();
    expect(i.editReply.mock.calls.at(-1)[0].components.length).toBeGreaterThan(0);
    create.mockRestore();
  });

  test.each([
    'https://www.youtube.com/playlist?list=PL123',
    'youtube.com/playlist?list=PL123',
    'https://space.bilibili.com/123/favlist?fid=456',
    'space.bilibili.com/123/lists/456',
    'https://cdn.discordapp.com/attachments/123/456/song.mp3',
    'cdn.discordapp.com/attachments/123/456/song.mp3',
    'media.discordapp.net/attachments/123/456/song.mp3',
  ])('rejects unsupported input without searching or playing: %s', async query => {
    const i = interaction(query);
    await createPlay(service).execute(i);
    expect(i.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('不支持') }));
    expect(api.searchVideos).not.toHaveBeenCalled();
    expect(youtube.searchVideos).not.toHaveBeenCalled();
    expect(coordinator.playUrl).not.toHaveBeenCalled();
  });

  test.each([
    ['https://www.bilibili.com/video/BV1xx411c7BF?p=2', 'bilibili', 'https://www.bilibili.com/video/BV1xx411c7BF?p=2'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123', 'youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ])('plays one video using its URL platform: %s', async (query, platform, normalized) => {
    await createPlay(service).execute(interaction(query));
    expect(coordinator.playUrl).toHaveBeenCalledWith(platform, expect.objectContaining({ url: normalized }));
    expect(api.searchVideos).not.toHaveBeenCalled();
    expect(youtube.searchVideos).not.toHaveBeenCalled();
  });

  test('reports no results when both platforms return nothing', async () => {
    api.searchVideos.mockResolvedValue([]);
    youtube.searchVideos.mockResolvedValue({ success: true, results: [] });
    const i = interaction('song');
    await createPlay(service).execute(i);
    expect(i.editReply).toHaveBeenCalledWith({ content: 'No results found for "song"' });
    expect(api.searchVideos).toHaveBeenCalled();
    expect(youtube.searchVideos).toHaveBeenCalled();
  });

  test('does not register removed commands', () => {
    const commands = require('../../src/bot/commands').createCommands(null);
    expect(commands.map(c => c.data.name)).toEqual(['play', 'pause', 'resume', 'skip', 'prev', 'stop', 'queue', 'nowplaying', 'help', 'radio', 'annoying', 'daily-hachimi', 'status']);
  });
});
