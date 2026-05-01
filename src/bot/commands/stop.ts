/**
 * Stop Command
 * Stops playback, clears queue, and leaves voice channel
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import * as logger from '../../services/logger_service';

const createStopCommand = (playbackService: any) => ({
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('停止播放，清空队列并退出语音频道'),

  cooldown: 3,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    try {
      const user   = interaction.user;
      const member = interaction.member;

      if (!member.voice.channel) {
        await interaction.reply({
          content: 'Voice channel required',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      playbackService.setUIContext(interaction.guild.id, interaction.channelId);

      const player = playbackService.getPlayer(interaction.guild.id);

      // Nothing to stop if bot is neither playing, paused, nor connected
      if (!player.isPlaying && !player.isPaused && !player.voiceConnection) {
        await interaction.reply({
          content: 'Nothing to stop',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const ok = await playbackService.stop(interaction.guild.id) as boolean;

      await interaction.reply({
        content: ok ? '⏹️ Stopped' : 'Stop failed',
        flags: MessageFlags.Ephemeral,
      });

      logger.info('Stop command executed', { user: user.username, guild: interaction.guild.name });
    } catch (e: unknown) {
      logger.error('Stop command failed', {
        user: interaction.user.username,
        error: (e as Error).message,
      });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'Stop failed' });
        } else {
          await interaction.reply({ content: 'Stop failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createStopCommand;
