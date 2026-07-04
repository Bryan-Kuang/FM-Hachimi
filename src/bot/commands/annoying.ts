/**
 * Annoying Command
 * Toggles 反谋害模式: while on, anyone who disconnects the bot (or drags it to
 * another channel) watches it come right back with its playback reconstructed
 * — except the configured exempt user. Running /annoying again turns it off.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import EmbedBuilders = require('../../ui/embeds');
import * as logger from '../../services/logger_service';

const createAnnoyingCommand = (playbackService: any) => {
  const command = {
    data: new SlashCommandBuilder()
      .setName('annoying')
      .setDescription('烦人模式 · 谁踢基米基米就回来，播放原样复原（再次 /annoying 关闭）'),

    cooldown: 5,

    async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
      const annoying = playbackService.getAnnoyingService?.();
      if (!annoying) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Annoying Mode Unavailable',
          'Annoying mode is not available right now.',
          { suggestion: 'Please try again later or contact the bot administrator.' },
        );
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      const enabled = annoying.toggle(interaction.guild.id);

      logger.info('Annoying mode toggled', {
        guild: interaction.guild.id,
        enabled,
        user: interaction.user.username,
      });

      const embed = enabled
        ? EmbedBuilders.createSuccessEmbed(
            '烦人模式已开启 😼',
            '现在谁把基米踢出语音，基米都会满血复活跑回来继续唱～\n再次 /annoying 关闭。',
          )
        : EmbedBuilders.createSuccessEmbed(
            '烦人模式已关闭 😿',
            '基米不再赖着不走了。',
          );

      // Public on purpose — the whole channel should know the rules changed.
      await interaction.reply({ embeds: [embed] });
    },
  };

  return command;
};

export = createAnnoyingCommand;
