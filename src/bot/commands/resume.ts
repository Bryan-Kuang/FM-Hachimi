/**
 * Resume Command
 * Resumes the paused audio playback
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import * as logger from '../../services/logger_service';

const createResumeCommand = (playbackService: any) => ({
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('继续播放已暂停的音乐'),

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
      const ok = playbackService.resume(interaction.guild.id) as boolean;

      await interaction.editReply(ok ? '▶️ 已恢复' : '恢复失败');
      logger.info('Resume command executed', { user: user.username, guild: interaction.guild.name });
    } catch (e: unknown) {
      logger.error('Resume command failed', { user: interaction.user.username, error: (e as Error).message });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'Resume failed' });
        } else {
          await interaction.reply({ content: 'Resume failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createResumeCommand;
