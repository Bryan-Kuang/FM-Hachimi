jest.mock('discord.js', () => jest.requireActual('discord.js'));
jest.mock('../../src/services/logger_service', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const registry = require('../../src/bot/commands');
test('registers only the supported commands and disables direct-message use', () => {
  const commands = registry.createCommands(null, null).map(command => command.data.toJSON());
  expect(commands.map(command => command.name)).toEqual([
    'play', 'pause', 'resume', 'skip', 'prev', 'stop', 'queue', 'nowplaying', 'help',
    'radio', 'annoying', 'daily-hachimi', 'status',
  ]);
  expect(commands.every(command => command.dm_permission === false)).toBe(true);
});
