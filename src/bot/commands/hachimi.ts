/**
 * Hachimi Command
 * Automatically plays Bilibili videos with "哈基米" tag that meet specific criteria
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import EmbedBuilders = require('../../ui/embeds');
import * as logger from '../../services/logger_service';
import commandQueue = require('../../utils/command_queue');

// Maximum number of videos to add in a single batch (recommended: 1-10)
const MAX_VIDEO_BATCH_SIZE = 5;

const createHachimiCommand = (playbackService: any, queueService: any) => {
  const command = {
    data: new SlashCommandBuilder()
      .setName('hachimi')
      .setDescription(`自动播放 ${MAX_VIDEO_BATCH_SIZE} 首符合质量标准的哈基米视频`),

    cooldown: 30,

    async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
      const user   = interaction.user;
      const member = interaction.member;

      if (!member.voice.channel) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Voice Channel Required',
          'You need to be in a voice channel to use Hachimi feature!',
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

      // Defer before entering queue to beat Discord's 3s timeout
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const queue = commandQueue.getQueue(interaction.guild.id, 'hachimi');

        if (queue.count > 0) {
          await interaction.editReply({ content: '⚠️ 哈基米正在运行中，请等待完成后再试。' });
          return;
        }

        await commandQueue.run(interaction.guild.id, 'hachimi', async () => {
          const controller = new AbortController();
          const { signal }  = controller;
          playbackService._setHachimiController(interaction.guild.id, controller);

          try {
            playbackService.setUIContext(interaction.guild.id, interaction.channelId);
            const loadingEmbed = EmbedBuilders.createLoadingEmbed(
              '🔍 Searching for Hachimi videos that meet quality criteria...',
            );
            await interaction.editReply({ embeds: [loadingEmbed] });
            await command.searchAndAddHachimiVideos(interaction, user.username, signal);
          } finally {
            playbackService._clearHachimiController(interaction.guild.id);
          }
        });
      } catch (e: unknown) {
        const err = e as Error;
        logger.error('Error in hachimi command', {
          error: err.message,
          stack: err.stack,
          guild: interaction.guild?.id,
          user: user.username,
        });

        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Hachimi Feature Error',
          'Failed to search for Hachimi videos. Please try again later.',
          { suggestion: 'If the problem persists, contact the bot administrator.' },
        );
        await interaction.editReply({ embeds: [errorEmbed] });
      }
    },

    async searchAndAddHachimiVideos(
      interaction: ChatInputCommandInteraction<'cached'>,
      username: string,
      signal: AbortSignal,
    ): Promise<void> {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const bilibiliApi = require('../../bilibili/api') as any;

        const safeBatchSize = Math.min(Math.max(1, MAX_VIDEO_BATCH_SIZE), 20);
        if (MAX_VIDEO_BATCH_SIZE > 20) {
          logger.warn(
            `Configured MAX_VIDEO_BATCH_SIZE (${MAX_VIDEO_BATCH_SIZE}) exceeds safety limit of 20. Capped to ${safeBatchSize}.`,
          );
        }

        const { results: qualifiedVideos, failReason, error: searchError } =
          await bilibiliApi.searchHachimiVideos(safeBatchSize, interaction.guild.id) as {
            results: any[];
            failReason: string;
            error: string | null;
          };

        if (signal?.aborted) return;

        const extractor = queueService.getExtractor();
        if (!extractor) {
          const errorEmbed = EmbedBuilders.createErrorEmbed(
            'Extractor Not Ready',
            'Audio extractor is not initialized. Please wait a moment and try again.',
            { suggestion: 'Restart the bot or try again later.' },
          );
          await interaction.editReply({ embeds: [errorEmbed] });
          return;
        }

        if (qualifiedVideos.length === 0) {
          let title: string, description: string, suggestion: string;
          if (failReason === 'search_failed') {
            title       = 'Search Failed';
            description = 'Could not retrieve videos from Bilibili. The API may be temporarily unavailable or blocked.';
            suggestion  = 'This is likely a network issue or API rate limit. Please try again in a few minutes.';
          } else if (failReason === 'exception') {
            title       = 'Internal Error';
            description = `An unexpected error occurred: ${searchError || 'unknown error'}`;
            suggestion  = 'Please try again. If the problem persists, contact the bot administrator.';
          } else {
            title       = 'No Qualified Videos Found';
            description = 'No Hachimi videos currently meet the quality criteria.';
            suggestion  = 'Quality criteria: Like Rate > 5% OR Views > 10,000';
          }
          const noResultsEmbed = EmbedBuilders.createErrorEmbed(title, description, { suggestion });
          await interaction.editReply({ embeds: [noResultsEmbed] });
          return;
        }

        const player = playbackService.getPlayer(interaction.guild.id);

        if (player.isPlaying || player.isPaused) {
          await player.stop();
        }

        if (
          !player.voiceConnection ||
          player.voiceConnection.joinConfig.channelId !== interaction.member.voice.channel!.id
        ) {
          const joinSuccess = await player.joinVoiceChannel(interaction.member.voice.channel) as boolean;
          if (!joinSuccess) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              'Voice Channel Error',
              'Failed to join voice channel.',
              { suggestion: 'Make sure the bot has permission to join and speak in the voice channel.' },
            );
            await interaction.editReply({ embeds: [errorEmbed] });
            return;
          }
        }

        player.clearQueue();

        let addedCount = 0;
        const failedVideos: string[] = [];
        let nowPlayingSent = false;

        for (const video of qualifiedVideos) {
          if (signal?.aborted) break;
          try {
            await queueService.addTrack(
              interaction.guild.id,
              video.url,
              `<@${interaction.user.id}>`,
            );
            addedCount++;

            if (addedCount === 1 && !player.isPlaying && !player.isPaused) {
              try {
                await playbackService.play(interaction.guild.id);
                nowPlayingSent = true;
              } catch (err: unknown) {
                logger.warn('Failed to start playback on first Hachimi track', {
                  error: (err as Error).message,
                });
              }
            }
          } catch (e: unknown) {
            logger.warn('Failed to add Hachimi video to queue', {
              title: video.title,
              bvid: video.bvid,
              error: (e as Error).message,
            });
            failedVideos.push(video.title as string);
          }
        }

        try {
          playbackService.notifyState(interaction.guild.id);
        } catch (e: unknown) {
          logger.warn('Notify state after hachimi add failed', { error: (e as Error).message });
        }

        const successEmbed = EmbedBuilders.createSuccessEmbed(
          '🎵 Hachimi Playlist Ready!',
          `Successfully added ${addedCount} qualified Hachimi videos to the queue.`,
        );

        successEmbed.addFields(
          {
            name: '📊 Quality Criteria Applied',
            value: '• 仅鬼畜区 / 音乐区\n• Like Rate > 5%\n• OR Views > 10,000',
            inline: false,
          },
          {
            name: '🎯 Results',
            value: `✅ Added: ${addedCount} videos\n${
              failedVideos.length > 0 ? `❌ Failed: ${failedVideos.length} videos` : ''
            }`,
            inline: true,
          },
        );

        if (failedVideos.length > 0 && failedVideos.length <= 3) {
          successEmbed.addFields({ name: '⚠️ Failed Videos', value: failedVideos.join('\n'), inline: false });
        }

        if (addedCount > 0 && qualifiedVideos.length < safeBatchSize) {
          successEmbed.setFooter({
            text: '(候选池已耗尽，随机回溯历史记录)',
            iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.png',
          });
        }

        const capNote =
          typeof MAX_VIDEO_BATCH_SIZE === 'number' && MAX_VIDEO_BATCH_SIZE > safeBatchSize
            ? `（已按批量上限 ${safeBatchSize} 截断）`
            : '';

        await interaction.editReply({
          content: `Added ${addedCount} videos${
            failedVideos.length > 0 ? `, failed ${failedVideos.length}` : ''
          } ${capNote}`.trim(),
        });

        if (!player.isPlaying && !player.isPaused && !nowPlayingSent) {
          await playbackService.play(interaction.guild.id);
        }

        if (player.currentTrack && !nowPlayingSent) {
          try {
            playbackService.notifyState(interaction.guild.id);
          } catch (e: unknown) {
            logger.warn('Notify state failed after nowPlaying check', { error: (e as Error).message });
          }
        }

        logger.info('Hachimi playlist created successfully', {
          guild: interaction.guild.id,
          user: username,
          addedCount,
          failedCount: failedVideos.length,
        });
      } catch (e: unknown) {
        const err = e as Error;
        logger.error('Error searching Hachimi videos', { error: err.message, stack: err.stack });
        throw err;
      }
    },
  };

  return command;
};

export = createHachimiCommand;
