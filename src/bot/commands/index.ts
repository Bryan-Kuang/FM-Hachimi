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
import radio = require('./radio');
import dailyHachimi = require('./daily_hachimi');
import ytfast = require('./ytfast');

interface CommandDefinition {
  data: { name: string; toJSON?: () => unknown };
  execute: (interaction: ChatInputCommandInteraction<'cached'>) => Promise<void>;
  cooldown?: number;
  stage?: 'stable' | 'testing';
  featureName?: string;
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
  radio,
  dailyHachimi,
  ytfast,
];

const TESTING_DESCRIPTION_PREFIX = '[Testing] ';
const DISCORD_DESCRIPTION_LIMIT = 100;

function prefixTestingDescription(description: string, fallback: string): string {
  const base = description.trim() || fallback;
  const prefixed = base.startsWith(TESTING_DESCRIPTION_PREFIX)
    ? base
    : `${TESTING_DESCRIPTION_PREFIX}${base}`;
  if (prefixed.length <= DISCORD_DESCRIPTION_LIMIT) return prefixed;
  return `${prefixed.slice(0, DISCORD_DESCRIPTION_LIMIT - 3)}...`;
}

function withTestingDescription(command: CommandDefinition): CommandDefinition {
  if (command.stage !== 'testing') return command;

  const originalData = command.data;
  const originalToJSON = originalData.toJSON?.bind(originalData);
  const wrappedData = Object.create(originalData) as CommandDefinition['data'];
  wrappedData.name = originalData.name;
  wrappedData.toJSON = () => {
    const json = originalToJSON ? originalToJSON() : { name: originalData.name };
    if (!json || typeof json !== 'object') return json;

    const commandJson = json as Record<string, unknown>;
    const description = typeof commandJson.description === 'string'
      ? commandJson.description
      : command.featureName || originalData.name;

    return {
      ...commandJson,
      description: prefixTestingDescription(description, command.featureName || originalData.name),
    };
  };

  return {
    ...command,
    data: wrappedData,
  };
}

function createCommands(playerService: unknown, dailyHachimiService?: unknown): CommandDefinition[] {
  return commandFactories
    .map((factory) => factory(playerService, playerService, dailyHachimiService))
    .map(withTestingDescription);
}

function getStableCommandsFrom(commands: CommandDefinition[]): CommandDefinition[] {
  return commands.filter((command) => command.stage !== 'testing');
}

function getTestingCommandsFrom(commands: CommandDefinition[]): CommandDefinition[] {
  return commands
    .filter((command) => command.stage === 'testing')
    .map(withTestingDescription);
}

function getGlobalCommands(playerService: unknown, dailyHachimiService?: unknown): CommandDefinition[] {
  return getStableCommandsFrom(createCommands(playerService, dailyHachimiService));
}

function getTestingCommands(playerService: unknown, dailyHachimiService?: unknown): CommandDefinition[] {
  return getTestingCommandsFrom(createCommands(playerService, dailyHachimiService));
}

function getGuildCommandsForTestServer(playerService: unknown, dailyHachimiService?: unknown): CommandDefinition[] {
  return getTestingCommands(playerService, dailyHachimiService);
}

export = {
  commandFactories,
  createCommands,
  getGlobalCommands,
  getTestingCommands,
  getGuildCommandsForTestServer,
  getStableCommandsFrom,
  getTestingCommandsFrom,
};
