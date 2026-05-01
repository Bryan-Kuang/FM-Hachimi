/**
 * Interaction Create Event Handler
 * Handles button interactions for audio controls
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  MessageFlags,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} from 'discord.js';
import EmbedBuilders = require('../../ui/embeds');
import ButtonBuilders = require('../../ui/buttons');
import * as logger from '../../services/logger_service';
import * as Lock from '../../utils/lock';

const createInteractionHandler = (
  playbackService: any,
  queueService: any,
): { name: string; execute: (interaction: any) => Promise<void> } => {
  return {
    name: 'interactionCreate',

    async execute(interaction: any): Promise<void> {
      // Handle button interactions
      if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
      }

      // Handle select menu interactions
      if (interaction.isStringSelectMenu()) {
        await handleSelectMenuInteraction(interaction);
      }
    },
  };

  /**
   * Handle button interactions with immediate defer reply to avoid timeout
   */
  async function handleButtonInteraction(interaction: any): Promise<void> {
    try {
      const customId = interaction.customId as string;
      const user     = interaction.user;

      logger.debug('Button interaction received', {
        customId,
        user:  user.username,
        guild: interaction.guild?.name,
      });

      // Immediately defer to beat Discord's 3-second timeout.
      // Control buttons use deferUpdate() so the original now-playing embed
      // is NOT replaced. All other buttons use deferReply(ephemeral).
      const controlButtons  = ['pause_resume', 'skip', 'prev', 'stop'];
      const isControlButton = controlButtons.includes(customId);

      if (isControlButton) {
        await interaction.deferUpdate();
      } else {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }

      // Check if user is in a voice channel for control buttons.
      // Use followUp (not editReply) so the original embed stays intact.
      if (isControlButton) {
        if (!interaction.member.voice.channel) {
          return await interaction.followUp({
            content: '🔇 Join the voice channel where music is playing first.',
            flags:   MessageFlags.Ephemeral,
          });
        }
      }

      // daily_play_<bvid>: triggered from daily hachimi recommendation cards
      if (customId.startsWith('daily_play_')) {
        if (!interaction.member.voice.channel) {
          return await interaction.editReply({ content: '🔇 请先加入一个语音频道再点击聆听。' });
        }

        const bvid = customId.slice('daily_play_'.length);
        if (!bvid) {
          return await interaction.editReply({ content: '❌ 无效的视频 ID。' });
        }

        const videoUrl = `https://www.bilibili.com/video/${bvid}`;

        playbackService.setUIContext(interaction.guild.id, interaction.channelId);
        const result = await playbackService.playBilibiliVideo(interaction, videoUrl);

        if (!result || !result.success) {
          return await interaction.editReply({
            content: `❌ 无法播放视频：${result?.error || '未知错误'}`,
          });
        }

        await interaction.editReply({ content: '✅ 已加入队列！' });
        playbackService.notifyState(interaction.guild.id);
        return;
      }

      // Route control buttons through PlaybackService
      if (['pause_resume', 'skip', 'prev', 'stop'].includes(customId)) {
        playbackService.setUIContext(interaction.guild.id, interaction.channelId);
        const player = playbackService.getPlayer(interaction.guild.id);
        if (customId === 'pause_resume') {
          if (player.isPlaying) {
            playbackService.pause(interaction.guild.id);
          } else if (player.isPaused) {
            playbackService.resume(interaction.guild.id);
          }
        } else if (customId === 'skip') {
          await playbackService.skip(interaction.guild.id);
        } else if (customId === 'prev') {
          await playbackService.previous(interaction.guild.id);
        } else if (customId === 'stop') {
          await playbackService.stop(interaction.guild.id);
        }
        return;
      }

      // Non-control buttons: delegate to PlaybackService
      const result = await playbackService.handleButtonInteraction(interaction);

      if (!result.success && !result.showMenu) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Action Failed',
          result.error,
          { suggestion: result.suggestion },
        );
        return await interaction.editReply({ embeds: [errorEmbed] });
      }

      // Handle loop button menu display
      if (result.showMenu && customId === 'loop') {
        logger.debug('Showing loop mode selection menu', {
          user:  user.username,
          guild: interaction.guild?.name,
        });

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('loop_select')
          .setPlaceholder('Choose loop mode...')
          .addOptions([
            { label: 'No Loop',     description: 'Play through queue once', value: 'none',  emoji: '➡️' },
            { label: 'Loop Queue',  description: 'Repeat entire queue',     value: 'queue', emoji: '🔁' },
            { label: 'Loop Single', description: 'Repeat current track',    value: 'track', emoji: '🔂' },
          ]);

        const selectRow = new ActionRowBuilder().addComponents(selectMenu);

        return await interaction.editReply({
          content:    '🔁 **Choose Loop Mode:**',
          components: [selectRow],
        });
      }

      // Create response based on button type
      let responseEmbed: any;
      let responseButtons: any;

      switch (customId) {
        case 'queue': {
          const queueInfo = queueService.getQueue(interaction.guild.id);
          responseEmbed   = EmbedBuilders.createQueueEmbed(queueInfo.queue, {
            currentTrack: queueInfo.currentTrack,
            page:         1,
            itemsPerPage: 10,
            totalPages:   Math.ceil(queueInfo.state.queueLength / 10) || 1,
          });
          responseButtons = ButtonBuilders.createQueueControls({
            hasQueue: queueInfo.state.queueLength > 0,
          });
          break;
        }

        case 'queue_clear': {
          responseEmbed   = EmbedBuilders.createSuccessEmbed('Queue Cleared', '🗑️ The queue has been cleared');
          responseButtons = ButtonBuilders.createQueueControls({ hasQueue: result.player.queueLength > 0 });
          break;
        }

        case 'queue_shuffle': {
          responseEmbed   = EmbedBuilders.createSuccessEmbed('Queue Shuffled', '🔀 The queue has been shuffled');
          responseButtons = ButtonBuilders.createQueueControls({ hasQueue: result.player.queueLength > 0 });
          break;
        }

        case 'queue_loop': {
          const loopMode  = result.mode as string;
          const loopEmoji = loopMode === 'none' ? '➡️' : loopMode === 'queue' ? '🔁' : '🔂';
          const loopText  = loopMode === 'none' ? 'disabled' : loopMode === 'queue' ? 'enabled (queue)' : 'enabled (single)';
          responseEmbed   = EmbedBuilders.createSuccessEmbed('Loop Mode Changed', `${loopEmoji} Loop mode ${loopText}`);
          responseButtons = ButtonBuilders.createQueueControls({ hasQueue: result.player.queueLength > 0 });
          break;
        }

        case 'loop': {
          // Handled above in the showMenu logic
          return;
        }

        case 'queue_remove': {
          const queueInfoRemove = queueService.getQueue(interaction.guild.id);
          if (!queueInfoRemove.queue || queueInfoRemove.queue.length === 0) {
            responseEmbed = EmbedBuilders.createErrorEmbed(
              'Queue Empty',
              'There are no tracks in the queue to remove.',
            );
            break;
          }
          const removeMenu = ButtonBuilders.createQueueRemoveMenu({
            queue:        queueInfoRemove.queue,
            currentIndex: queueInfoRemove.state.currentIndex,
          });
          responseEmbed   = EmbedBuilders.createSuccessEmbed(
            'Select Track to Remove',
            'Choose a track from the dropdown menu below to remove it from the queue.',
          );
          responseButtons = [removeMenu];
          break;
        }

        default: {
          responseEmbed = EmbedBuilders.createSuccessEmbed('Action Completed', '✅ Action completed successfully');
          break;
        }
      }

      // Send response
      const response: Record<string, any> = { embeds: [responseEmbed] };
      if (responseButtons) {
        response.components = responseButtons;
      }

      await interaction.editReply(response);

      logger.info('Button interaction handled successfully', {
        customId,
        user:  user.username,
        guild: interaction.guild?.name,
      });
    } catch (error: unknown) {
      logger.error('Button interaction failed', {
        customId: interaction.customId,
        user:     interaction.user.username,
        error:    (error as Error).message,
        stack:    (error as Error).stack,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        'Interaction Failed',
        'An error occurred while processing your request.',
        { errorCode: 'BUTTON_INTERACTION_FAILED' },
      );

      // Control buttons used deferUpdate(), so editReply() would overwrite the
      // now-playing embed. Use followUp() to send the error only to the presser.
      const isCtrlButton = ['pause_resume', 'skip', 'prev', 'stop'].includes(
        interaction.customId as string,
      );

      try {
        if (interaction.replied || interaction.deferred) {
          if (isCtrlButton) {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
          } else {
            await interaction.editReply({ embeds: [errorEmbed] });
          }
        } else {
          await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
      } catch (replyError: unknown) {
        logger.error('Failed to send error response for button interaction', {
          error: (replyError as Error).message,
        });
      }
    }
  }

  /**
   * Handle select menu interactions
   */
  async function handleSelectMenuInteraction(interaction: any): Promise<void> {
    try {
      const customId = interaction.customId as string;
      const user     = interaction.user;

      if (customId === 'queue_remove_select') {
        if (Lock.shouldDebounce(interaction.guild.id, customId, 1000)) {
          await interaction.reply({ content: '操作过于频繁，请稍后重试', flags: MessageFlags.Ephemeral });
          return;
        }
        if (!Lock.acquire(interaction.guild.id, customId)) {
          await interaction.reply({ content: '操作繁忙，请稍后重试', flags: MessageFlags.Ephemeral });
          return;
        }
        const selectedValue = interaction.values[0] as string;

        logger.debug('Queue remove select menu interaction received', {
          selectedValue,
          user:  user.username,
          guild: interaction.guild?.name,
        });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let responseEmbed: any;
        let responseButtons: any;

        if (selectedValue === 'clear_all' || selectedValue === 'remove_all') {
          const cleared = queueService.clearQueue(interaction.guild.id);
          if (!cleared) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              'Clear Queue Failed', 'Failed to clear the queue',
              { suggestion: 'Please try again.' },
            );
            return await interaction.editReply({ embeds: [errorEmbed] });
          }

          responseEmbed   = EmbedBuilders.createSuccessEmbed('Queue Cleared', '🗑️ All tracks have been removed from the queue');
          responseButtons = ButtonBuilders.createQueueControls({ hasQueue: false });
        } else {
          const indexMatch = selectedValue.match(/^remove_(\d+)$/);
          if (!indexMatch) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              'Invalid Selection', 'Invalid track selection format',
              { suggestion: 'Please try selecting a track again.' },
            );
            return await interaction.editReply({ embeds: [errorEmbed] });
          }

          const index = parseInt(indexMatch[1]);
          const ok    = queueService.removeTrack(interaction.guild.id, index);

          if (!ok) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              'Remove Track Failed', 'Failed to remove the track',
              { suggestion: 'Please try again.' },
            );
            return await interaction.editReply({ embeds: [errorEmbed] });
          }

          responseEmbed = EmbedBuilders.createSuccessEmbed('Track Removed', '🗑️ Track has been removed from the queue');

          const queueInfoAfter = queueService.getQueue(interaction.guild.id);
          responseButtons      = ButtonBuilders.createQueueControls({
            hasQueue: queueInfoAfter.queue.length > 0,
          });
        }

        Lock.release(interaction.guild.id, customId);

        // Best-effort: refresh the queue message UI.
        // Wrapped in its own try/catch so a Discord API hiccup (e.g. message
        // already deleted, unknown message, rate limit) cannot clobber the
        // success reply that the user should always see — the track was already
        // removed above regardless of whether this edit succeeds.
        try {
          const queueInfo  = queueService.getQueue(interaction.guild.id);
          const queueEmbed = EmbedBuilders.createQueueEmbed(queueInfo.queue, {
            currentTrack: queueInfo.currentTrack,
            page:         1,
            itemsPerPage: 10,
            totalPages:   Math.ceil((queueInfo.state?.queueLength ?? 0) / 10) || 1,
          });
          const response: Record<string, any> = { embeds: [queueEmbed] };
          if (responseButtons) {
            response.components = responseButtons;
          }
          await interaction.message.edit(response);
        } catch (_editErr: unknown) {
          logger.warn('Failed to refresh queue message after track removal — interaction reply will still succeed', {
            guild: interaction.guild?.name,
          });
        }

        await interaction.editReply({ embeds: [responseEmbed], flags: MessageFlags.Ephemeral });

        logger.info('Track removed via select menu', {
          selectedValue,
          user:  user.username,
          guild: interaction.guild?.name,
        });
      } else if (customId === 'loop_select') {
        if (Lock.shouldDebounce(interaction.guild.id, customId, 1000)) {
          await interaction.reply({ content: '操作过于频繁，请稍后重试', flags: MessageFlags.Ephemeral });
          return;
        }
        if (!Lock.acquire(interaction.guild.id, customId)) {
          await interaction.reply({ content: '操作繁忙，请稍后重试', flags: MessageFlags.Ephemeral });
          return;
        }
        const selectedMode = interaction.values[0] as string;

        logger.debug('Loop select menu interaction received', {
          selectedMode,
          user:  user.username,
          guild: interaction.guild?.name,
        });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = queueService.setLoopMode(interaction.guild.id, selectedMode);

        if (!result.success) {
          const errorEmbed = EmbedBuilders.createErrorEmbed(
            'Loop Mode Failed',
            result.error || 'Failed to change loop mode',
            { suggestion: result.suggestion || 'Please try again.' },
          );
          return await interaction.editReply({ embeds: [errorEmbed] });
        }

        const loopEmoji  = selectedMode === 'none' ? '➡️' : selectedMode === 'queue' ? '🔁' : '🔂';
        const loopText   = selectedMode === 'none' ? 'disabled' : selectedMode === 'queue' ? 'enabled (queue)' : 'enabled (single)';
        const successEmbed = EmbedBuilders.createSuccessEmbed('Loop Mode Changed', `${loopEmoji} Loop mode ${loopText}`);

        await interaction.editReply({ embeds: [successEmbed] });
        Lock.release(interaction.guild.id, customId);
        playbackService.notifyState(interaction.guild.id);

        logger.info('Loop mode changed via select menu', {
          mode:  selectedMode,
          user:  user.username,
          guild: interaction.guild?.name,
        });
      } else if (customId.startsWith('search_select_')) {
        const selectedValue = interaction.values[0] as string;

        logger.debug('Search result select menu interaction received', {
          selectedValue,
          user:  user.username,
          guild: interaction.guild?.name,
        });

        await interaction.deferReply();

        const originalEmbed = interaction.message.embeds[0];
        if (!originalEmbed || !originalEmbed.description) {
          const errorEmbed = EmbedBuilders.createErrorEmbed(
            'Search Results Not Found', 'Could not find the original search results.',
            { suggestion: 'Please perform a new search.' },
          );
          return await interaction.editReply({ embeds: [errorEmbed] });
        }

        const indexMatch = selectedValue.match(/^search_result_(\d+)$/);
        if (!indexMatch) {
          const errorEmbed = EmbedBuilders.createErrorEmbed(
            'Invalid Selection', 'Invalid search result selection format',
            { suggestion: 'Please try selecting a result again.' },
          );
          return await interaction.editReply({ embeds: [errorEmbed] });
        }

        const resultIndex = parseInt(indexMatch[1]);
        const keyword     = customId.replace('search_select_', '').replace(/_/g, ' ');

        try {
          const extractor = playbackService.getExtractor();
          if (!extractor) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              'Extractor Not Available', 'Bilibili extractor is not available.',
              { suggestion: 'Please try again later.' },
            );
            return await interaction.editReply({ embeds: [errorEmbed] });
          }

          const searchResults = await extractor.searchVideos(keyword, 25);

          if (!searchResults.success || !searchResults.results || resultIndex >= searchResults.results.length) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              'Video Not Found', 'The selected video is no longer available.',
              { suggestion: 'Please perform a new search.' },
            );
            return await interaction.editReply({ embeds: [errorEmbed] });
          }

          const selectedVideo = searchResults.results[resultIndex];
          const videoUrl      = selectedVideo.url || `https://www.bilibili.com/video/av${selectedVideo.id}`;

          const addResult = await playbackService.playBilibiliVideo(interaction, videoUrl);

          if (!addResult.success) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              'Failed to Add Video',
              addResult.error || 'Failed to add the selected video to queue.',
              { suggestion: addResult.suggestion || 'Please try again.' },
            );
            return await interaction.editReply({ embeds: [errorEmbed] });
          }

          const successEmbed = EmbedBuilders.createSuccessEmbed(
            'Video Added to Queue',
            `🎵 **${selectedVideo.title}** has been added to the queue`,
          );
          await interaction.editReply({ embeds: [successEmbed] });

          logger.info('Video added to queue from search results', {
            videoTitle: selectedVideo.title,
            videoId:    selectedVideo.id,
            user:       user.username,
            guild:      interaction.guild?.name,
          });
        } catch (innerError: unknown) {
          logger.error('Failed to add video from search results', {
            error: (innerError as Error).message,
            stack: (innerError as Error).stack,
            user:  user.username,
            guild: interaction.guild?.name,
          });

          const errorEmbed = EmbedBuilders.createErrorEmbed(
            'Error Adding Video', 'An error occurred while adding the video to queue.',
            { suggestion: 'Please try again.' },
          );
          await interaction.editReply({ embeds: [errorEmbed] });
        }
      }
    } catch (error: unknown) {
      logger.error('Select menu interaction failed', {
        customId: interaction.customId,
        user:     interaction.user.username,
        guild:    interaction.guild?.name,
        error:    (error as Error).message,
        stack:    (error as Error).stack,
      });

      try {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Interaction Failed', 'An error occurred while processing your selection.',
          { errorCode: 'SELECT_MENU_FAILED' },
        );

        if (interaction.deferred) {
          await interaction.editReply({ embeds: [errorEmbed] });
        } else if (!interaction.replied) {
          await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
      } catch (replyError: unknown) {
        logger.error('Failed to send error response for select menu', {
          error: (replyError as Error).message,
        });
      }
    }
  }
};

export = createInteractionHandler;
