/**
 * Skip Command
 * Skips to the next track in the queue
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import * as logger from '../../services/logger_service';
import { RADIO_BREAK_MESSAGE } from '../../playback/radio_controls';

const createSkipCommand = (playbackService: any) => ({
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('跳过当前歌曲，播放下一首'),

  cooldown: 3,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    try {
      const member = interaction.member;
      const user   = interaction.user;

      if (!member.voice.channel) {
        await interaction.reply({ content: 'Voice channel required', flags: MessageFlags.Ephemeral });
        return;
      }

      // The periodic radio "take a break" video is non-skippable.
      if (playbackService.getRadioService?.()?.isOnBreak(interaction.guild.id)) {
        await interaction.reply({ content: RADIO_BREAK_MESSAGE, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({ content: '执行中...', flags: MessageFlags.Ephemeral });
      playbackService.setUIContext(interaction.guild.id, interaction.channelId);
      const ok = await playbackService.skip(interaction.guild.id) as boolean;

      await interaction.editReply(ok ? '>> 已跳过' : '没有下一首');
      logger.info('Skip command executed', { user: user.username, guild: interaction.guild.name });
    } catch (e: unknown) {
      logger.error('Skip command failed', { user: interaction.user.username, error: (e as Error).message });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'Skip failed' });
        } else {
          await interaction.reply({ content: 'Skip failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createSkipCommand;
