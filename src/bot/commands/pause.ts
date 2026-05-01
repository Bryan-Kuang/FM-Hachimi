/**
 * Pause Command
 * Pauses the currently playing audio
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import * as logger from '../../services/logger_service';

const createPauseCommand = (playbackService: any) => ({
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('暂停当前播放'),

  cooldown: 2,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    try {
      const member = interaction.member;
      const user   = interaction.user;

      if (!member.voice.channel) {
        await interaction.reply({ content: 'Voice channel required', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({ content: '执行中...', flags: MessageFlags.Ephemeral });
      playbackService.setUIContext(interaction.guild.id, interaction.channelId);
      const ok = playbackService.pause(interaction.guild.id) as boolean;

      // editReply with plain string (test contract)
      await interaction.editReply(ok ? '⏸️ 已暂停' : '暂停失败');
      logger.info('Pause command executed', { user: user.username, guild: interaction.guild.name });
    } catch (e: unknown) {
      logger.error('Pause command failed', { user: interaction.user.username, error: (e as Error).message });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'Pause failed' });
        } else {
          await interaction.reply({ content: 'Pause failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createPauseCommand;
