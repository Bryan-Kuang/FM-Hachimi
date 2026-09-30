jest.mock('discord.js', () => jest.requireActual('discord.js'));
jest.mock('../../src/services/logger_service', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/playback/playback_coordinator', () => ({ playUrl: jest.fn() }));
const createHandler = require('../../src/bot/events/handlers/select_menu_handler');
const coordinator = require('../../src/playback/playback_coordinator');

test.each(['search_select_old_keyword', 'play_search_old_keyword'])('old menu %s expires without replaying or repeating search', async customId => {
  const interaction = {
    customId, values: ['bili:BV1xx411c7BF'], user: { id: 'user', username: 'Listener' },
    guild: { id: 'guild' }, reply: jest.fn().mockResolvedValue(),
    deferReply: jest.fn().mockResolvedValue(), editReply: jest.fn().mockResolvedValue(),
  };
  await createHandler({})(interaction);
  expect(interaction.reply).toHaveBeenCalledWith({ content: '搜索已过期，请使用 /play 重新搜索。', flags: 64 });
  expect(coordinator.playUrl).not.toHaveBeenCalled();
});
