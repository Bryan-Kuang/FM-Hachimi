import { MessageFlags } from 'discord.js';
import config = require('../config/config');

interface CommandLike {
  stage?: string;
  featureName?: string;
  data?: {
    name?: string;
  };
}

interface TestingInteractionLike {
  guildId?: string | null;
  guild?: { id?: string | null } | null;
  replied?: boolean;
  deferred?: boolean;
  reply?: (payload: TestingReplyPayload) => Promise<unknown>;
  followUp?: (payload: TestingReplyPayload) => Promise<unknown>;
}

interface TestingReplyPayload {
  content: string;
  flags: number;
}

export const TEST_GUILD_ID = config.test?.guildId?.trim() || null;

export function isTestGuild(guildId: string | null | undefined): boolean {
  if (!TEST_GUILD_ID) return false;
  return typeof guildId === 'string' && guildId.length > 0 && guildId === TEST_GUILD_ID;
}

export function isTestingCommand(command: CommandLike | null | undefined): boolean {
  return command?.stage === 'testing';
}

export function isTestingCustomId(customId: string | null | undefined): boolean {
  return typeof customId === 'string' && customId.startsWith('testing:');
}

export function featureNameFromCustomId(customId: string): string {
  if (!isTestingCustomId(customId)) return 'Testing feature';
  const feature = customId.split(':')[1]?.trim();
  return feature ? feature.replace(/[-_]/g, ' ') : 'Testing feature';
}

export async function denyTestingFeature(
  interaction: TestingInteractionLike,
  featureName = 'Testing feature',
): Promise<void> {
  const payload: TestingReplyPayload = {
    content: `${featureName} is currently available only in the testing server.`,
    flags: MessageFlags.Ephemeral,
  };

  if ((interaction.replied || interaction.deferred) && interaction.followUp) {
    await interaction.followUp(payload);
    return;
  }

  if (interaction.reply) {
    await interaction.reply(payload);
    return;
  }

  throw new Error('Unable to deny testing feature: interaction has no reply method');
}

export async function assertTestingGuild(
  interaction: TestingInteractionLike,
  featureName = 'Testing feature',
): Promise<boolean> {
  const guildId = interaction.guildId || interaction.guild?.id || null;
  if (isTestGuild(guildId)) return true;

  await denyTestingFeature(interaction, featureName);
  return false;
}
