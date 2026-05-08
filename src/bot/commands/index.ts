import type { ChatInputCommandInteraction } from 'discord.js';
import play = require('./play');
import pause = require('./pause');
import resume = require('./resume');
import skip = require('./skip');
import prev = require('./prev');
import stop = require('./stop');
import queue = require('./queue');
import nowplaying = require('./nowplaying');
import help = require('./help');
import search = require('./search');
import hachimi = require('./hachimi');
import dailyHachimi = require('./daily_hachimi');

interface CommandDefinition {
  data: { name: string; toJSON?: () => unknown };
  execute: (interaction: ChatInputCommandInteraction<'cached'>) => Promise<void>;
  cooldown?: number;
}

type CommandFactory = (
  playerService: unknown,
  queueService: unknown,
  dailyHachimiService?: unknown,
) => CommandDefinition;

const commandFactories: CommandFactory[] = [
  play,
  pause,
  resume,
  skip,
  prev,
  stop,
  queue,
  nowplaying,
  help,
  search,
  hachimi,
  dailyHachimi,
];

function createCommands(playerService: unknown, dailyHachimiService?: unknown): CommandDefinition[] {
  return commandFactories.map((factory) => factory(playerService, playerService, dailyHachimiService));
}

export = {
  commandFactories,
  createCommands,
};
