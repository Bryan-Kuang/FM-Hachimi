/**
 * Previous Command
 * Goes back to the previous track in the queue
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import * as logger from '../../services/logger_service';

const createPrevCommand = (playbackService: any) => ({
  data: new SlashCommandBuilder()
    .setName('prev')
    .setDescription('播放队列中的上一首'),

  cooldown: 3,

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
      const ok = await playbackService.previous(interaction.guild.id) as boolean;

      await interaction.editReply(ok ? '⏮️ 已返回上一首' : '没有上一首');
      logger.info('Prev command executed', { user: user.username, guild: interaction.guild.name });
    } catch (e: unknown) {
      logger.error('Prev command failed', { user: interaction.user.username, error: (e as Error).message });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'Previous failed' });
        } else {
          await interaction.reply({ content: 'Previous failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createPrevCommand;
