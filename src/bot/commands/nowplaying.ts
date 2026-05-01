/**
 * Now Playing Command
 * Shows information about the currently playing track
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import EmbedBuilders = require('../../ui/embeds');
import ButtonBuilders = require('../../ui/buttons');
import * as logger from '../../services/logger_service';

const createNowPlayingCommand = (playbackService: any) => ({
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('显示当前正在播放的歌曲信息'),

  cooldown: 3,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    try {
      const user    = interaction.user;
      const guildId = interaction.guild.id;
      const player  = playbackService.getPlayer(guildId);
      const state   = player.getState();
      const currentTrack = state.currentTrack;

      if (!state.isPlaying && !state.isPaused && !currentTrack) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Nothing Playing',
          'There is no track currently playing.',
          { suggestion: 'Use /play to start playing a track.' },
        );
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = EmbedBuilders.createNowPlayingEmbed(currentTrack, {
        currentTime: player.getCurrentTime(),
        // Track stores the requester as `user` (set at queue time); fall back to interaction user
        requestedBy: currentTrack?.requestedBy || currentTrack?.user || user.username,
        isPlaying: state.isPlaying,
        queuePosition: state.currentIndex + 1,
        totalQueue: state.queueLength,
        loopMode: state.loopMode,
      });

      const components = ButtonBuilders.createPlaybackControls({
        isPlaying: state.isPlaying,
        hasQueue: state.queueLength > 0,
        canGoBack: player.canGoBack ? player.canGoBack() : false,
        canSkip: player.canSkip ? player.canSkip() : state.queueLength > 0,
        loopMode: state.loopMode,
      });

      await interaction.reply({ embeds: [embed], components });

      logger.info('NowPlaying command executed', {
        user: user.username,
        guild: interaction.guild.name,
        track: currentTrack?.title,
      });
    } catch (e: unknown) {
      logger.error('NowPlaying command failed', {
        user: interaction.user.username,
        error: (e as Error).message,
      });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'NowPlaying command failed' });
        } else {
          await interaction.reply({ content: 'NowPlaying command failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createNowPlayingCommand;
