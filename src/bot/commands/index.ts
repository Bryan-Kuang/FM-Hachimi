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
import radio = require('./radio');
import annoying = require('./annoying');
import dailyHachimi = require('./daily_hachimi');
import status = require('./status');

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
  radio,
  annoying,
  dailyHachimi,
  status,
];

/* eslint-disable @typescript-eslint/no-explicit-any */
function ensureDMPermission(command: CommandDefinition): CommandDefinition {
  const originalData = command.data as any;
  if (typeof originalData.setDMPermission !== 'function') return command;

  originalData.setDMPermission(false);
  return command;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function createCommands(
  playerService: unknown,
  dailyHachimiService?: unknown,
): CommandDefinition[] {
  return commandFactories
    .map((factory) => factory(playerService, playerService, dailyHachimiService))
    .map(ensureDMPermission);
}

export = { commandFactories, createCommands };
