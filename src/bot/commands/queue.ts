/**
 * Queue Command
 * Displays the current music queue
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import EmbedBuilders = require('../../ui/embeds');
import ButtonBuilders = require('../../ui/buttons');
import * as logger from '../../services/logger_service';

const createQueueCommand = (_playbackService: any, queueService: any) => ({
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('显示当前播放队列'),

  cooldown: 3,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    try {
      const user      = interaction.user;
      const queueInfo = queueService.getQueue(interaction.guild.id);

      const itemsPerPage = 10;
      const totalPages   = Math.max(1, Math.ceil((queueInfo.queue?.length ?? 0) / itemsPerPage));

      const queueEmbed = EmbedBuilders.createQueueEmbed(
        queueInfo.queue ?? [],
        {
          currentTrack: queueInfo.currentTrack,
          page: 1,
          itemsPerPage,
          totalPages,
        },
      );

      const components = ButtonBuilders.createQueueControls({
        hasQueue: (queueInfo.queue?.length ?? 0) > 0,
        currentPage: 1,
        totalPages,
      });

      await interaction.reply({ embeds: [queueEmbed], components });

      logger.info('Queue command executed', {
        user: user.username,
        guild: interaction.guild.name,
        queueLength: queueInfo.queue?.length,
      });
    } catch (e: unknown) {
      logger.error('Queue command failed', {
        user: interaction.user.username,
        error: (e as Error).message,
      });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'Queue command failed' });
        } else {
          await interaction.reply({ content: 'Queue command failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createQueueCommand;
