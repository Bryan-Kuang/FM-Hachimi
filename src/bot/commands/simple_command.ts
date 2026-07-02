/**
 * Simple Command Factory
 * Shared envelope for one-shot player commands (pause/resume/skip/prev):
 * voice-channel check → optional guard → ephemeral "执行中..." → setUIContext
 * → service call → editReply with a plain string (test contract) → logged,
 * replied/deferred-aware error fallback.
 *
 * Not for commands with a different reply flow (e.g. stop pre-checks player
 * state and replies once) — keep those hand-written.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import * as logger from '../../services/logger_service';

interface SimpleCommandSpec {
  name: string;
  description: string;
  cooldown: number;
  /** Log/label prefix, e.g. 'Pause' → "Pause command executed" / "Pause failed". */
  label: string;
  /** Runs after the voice check; return a message to reply ephemeral and stop. */
  guard?: (playbackService: any, interaction: ChatInputCommandInteraction<'cached'>) => string | null;
  /** The player operation; its boolean picks successMsg vs failMsg. */
  action: (playbackService: any, guildId: string) => boolean | Promise<boolean>;
  successMsg: string;
  failMsg: string;
  /** Error-path reply; defaults to "<label> failed". */
  errorMsg?: string;
}

const createSimpleCommand = (spec: SimpleCommandSpec) => (playbackService: any) => ({
  data: new SlashCommandBuilder()
    .setName(spec.name)
    .setDescription(spec.description),

  cooldown: spec.cooldown,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    try {
      const member = interaction.member;
      const user   = interaction.user;

      if (!member.voice.channel) {
        await interaction.reply({ content: 'Voice channel required', flags: MessageFlags.Ephemeral });
        return;
      }

      const blocked = spec.guard?.(playbackService, interaction);
      if (blocked) {
        await interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({ content: '执行中...', flags: MessageFlags.Ephemeral });
      playbackService.setUIContext(interaction.guild.id, interaction.channelId);
      const ok = await spec.action(playbackService, interaction.guild.id);

      // editReply with plain string (test contract)
      await interaction.editReply(ok ? spec.successMsg : spec.failMsg);
      logger.info(`${spec.label} command executed`, { user: user.username, guild: interaction.guild.name });
    } catch (e: unknown) {
      logger.error(`${spec.label} command failed`, { user: interaction.user.username, error: (e as Error).message });
      const errorMsg = spec.errorMsg ?? `${spec.label} failed`;
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: errorMsg });
        } else {
          await interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createSimpleCommand;
