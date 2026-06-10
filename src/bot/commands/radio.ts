/**
 * Radio Command
 * Endless playback of random 哈基米 (Hachimi) tracks. Running /radio again
 * (or /stop) turns it off.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import EmbedBuilders = require('../../ui/embeds');
import * as logger from '../../services/logger_service';
import commandQueue = require('../../utils/command_queue');

const createRadioCommand = (playbackService: any) => {
  const command = {
    data: new SlashCommandBuilder()
      .setName('radio')
      .setDescription('电台模式 · 无限随机播放哈基米歌曲（再次 /radio 或 /stop 关闭）'),

    cooldown: 10,

    async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
      const member = interaction.member;

      if (!member.voice.channel) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Voice Channel Required',
          'You need to be in a voice channel to start the radio!',
          { suggestion: 'Join a voice channel and try again.' },
        );
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      const botVoiceChannel = interaction.guild.members.me?.voice?.channel;
      if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Different Voice Channel',
          "I'm already playing music in a different voice channel!",
          { suggestion: `Join ${botVoiceChannel.name} or wait for the current session to end.` },
        );
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      const radio = playbackService.getRadioService?.();
      if (!radio) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Radio Unavailable',
          'Radio mode is not available right now.',
          { suggestion: 'Please try again later or contact the bot administrator.' },
        );
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      // Defer before entering the queue to beat Discord's 3s timeout.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        await commandQueue.run(interaction.guild.id, 'radio', async () => {
          // Toggle off if already running.
          if (radio.isEnabled(interaction.guild.id)) {
            await radio.stop(interaction.guild.id);
            playbackService.notifyState(interaction.guild.id);
            await interaction.editReply({
              content: 'Radio mode stopped. The current track will keep playing — use /stop to halt it.',
            });
            return;
          }

          const loadingEmbed = EmbedBuilders.createLoadingEmbed(
            'Starting Hachimi radio…',
          );
          await interaction.editReply({ embeds: [loadingEmbed] });

          const result = await radio.start(
            interaction.guild.id,
            member.voice.channel,
            interaction.channelId,
          );

          if (!result.success) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              'Radio Failed To Start',
              result.error || 'Could not start radio mode.',
              { suggestion: 'Please try again in a moment.' },
            );
            await interaction.editReply({ embeds: [errorEmbed] });
            return;
          }

          const successEmbed = EmbedBuilders.createSuccessEmbed(
            'Radio Mode On',
            'Now streaming an endless mix of random Hachimi tracks. Run /radio again or /stop to end it.',
          );
          await interaction.editReply({ embeds: [successEmbed] });
        });
      } catch (e: unknown) {
        const err = e as Error;
        logger.error('Error in radio command', {
          error: err.message,
          stack: err.stack,
          guild: interaction.guild?.id,
          user: interaction.user?.username,
        });

        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Radio Feature Error',
          'Failed to start radio mode. Please try again later.',
          { suggestion: 'If the problem persists, contact the bot administrator.' },
        );
        await interaction.editReply({ embeds: [errorEmbed] });
      }
    },
  };

  return command;
};

export = createRadioCommand;
