/**
 * Button Interaction Handler
 * Processes all button click interactions: playback controls, queue actions,
 * daily hachimi play buttons, and loop mode selection triggers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  MessageFlags,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} from 'discord.js';
import EmbedBuilders = require('../../../ui/embeds');
import ButtonBuilders = require('../../../ui/buttons');
import SearchResultsView = require('../../../ui/search_results_view');
import SearchSessionStore = require('../../../search/search_session_store');
import { createInteractionStageReporter } from '../../../playback/stage_feedback';
import {
  RADIO_ONLY_STOP_MESSAGE,
  RADIO_BREAK_MESSAGE,
  isRadioBlockedButton,
} from '../../../playback/radio_controls';
import * as logger from '../../../services/logger_service';
import AnnoyingService = require('../../../services/annoying_service');
import * as Lock from '../../../utils/lock';

const RADIO_SKIP_DEBOUNCE_MS = 5000;

/**
 * Create a button interaction handler bound to the given player service.
 */
function createButtonHandler(playerService: any) {
  return async function handleButtonInteraction(interaction: any): Promise<void> {
    try {
      const customId = interaction.customId as string;
      const user     = interaction.user;

      logger.debug('Button interaction received', {
        customId,
        user:  user.username,
        guild: interaction.guild?.name,
      });

      // Search pagination edits the search results message in place, so it
      // needs deferUpdate() instead of the generic deferReply(ephemeral) below.
      if (customId.startsWith('search_page_')) {
        return await handleSearchPage(interaction, customId);
      }

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

      const radioMode = isRadioMode(interaction, playerService);

      if (isRadioBlockedButton(customId) && radioMode) {
        return await denyRadioControl(interaction, isControlButton);
      }

      // The periodic radio "take a break" video is non-skippable (Stop still works).
      if (customId === 'skip' && radioMode && isRadioOnBreak(interaction, playerService)) {
        return await interaction.followUp({
          content: RADIO_BREAK_MESSAGE,
          flags: MessageFlags.Ephemeral,
        });
      }

      // While annoying mode is armed, only the exempt user may stop the bot.
      if (
        customId === 'stop' &&
        playerService.getAnnoyingService?.()?.isProtectedFrom?.(interaction.guild?.id, user)
      ) {
        return await interaction.followUp({
          content: AnnoyingService.STOP_BLOCKED_MESSAGE,
          flags: MessageFlags.Ephemeral,
        });
      }

      // Check if user is in a voice channel for control buttons.
      // Use followUp (not editReply) so the original embed stays intact.
      if (isControlButton) {
        if (!interaction.member.voice.channel) {
          return await interaction.followUp({
            content: '\u{1F507} Join the voice channel where music is playing first.',
            flags:   MessageFlags.Ephemeral,
          });
        }
      }

      if (customId === 'skip' && radioMode && await isRadioSkipDebounced(interaction)) {
        return;
      }

      // daily_play_<bvid>: triggered from daily hachimi recommendation cards
      if (customId.startsWith('daily_play_')) {
        return await handleDailyPlay(interaction, customId, playerService);
      }

      // Route control buttons through PlayerService
      if (isControlButton) {
        return await handleControlButton(interaction, customId, playerService);
      }

      // Queue-mutating buttons require voice channel presence
      const queueMutatingButtons = ['queue_clear', 'queue_shuffle', 'queue_remove', 'loop', 'loop_select'];
      if (queueMutatingButtons.includes(customId)) {
        if (!interaction.member.voice.channel) {
          return await interaction.editReply({
            content: '\u{1F507} Join the voice channel where music is playing first.',
            flags:   MessageFlags.Ephemeral,
          });
        }
      }

      // Non-control buttons: delegate to PlayerService
      const result = await playerService.handleButtonInteraction(interaction);

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
        return await showLoopMenu(interaction, user);
      }

      // Create response based on button type
      const { embed, buttons } = buildButtonResponse(customId, result, interaction, playerService);

      const response: Record<string, any> = { embeds: [embed] };
      if (buttons) {
        response.components = buttons;
      }

      await interaction.editReply(response);

      logger.info('Button interaction handled successfully', {
        customId,
        user:  user.username,
        guild: interaction.guild?.name,
      });
    } catch (error: unknown) {
      await handleButtonError(interaction, error as Error);
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * search_page_<token>_<prev|next>: flip a page of the paginated search
 * results message in place. Errors are handled here (not in the generic
 * handler) so the search results message is never overwritten with an
 * error embed.
 */
async function handleSearchPage(interaction: any, customId: string): Promise<void> {
  try {
    await interaction.deferUpdate();

    const match = customId.match(/^search_page_([0-9a-f]+)_(prev|next)$/);
    if (!match) return;

    const [, token, direction] = match;
    const session = SearchSessionStore.get(token);
    if (!session) {
      await interaction.followUp({
        content: '搜索已过期，请重新搜索。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const totalPages = SearchResultsView.totalPagesFor(session);
    const nextPage = session.currentPage + (direction === 'next' ? 1 : -1);
    session.currentPage = Math.min(Math.max(nextPage, 1), totalPages);

    await interaction.editReply(
      SearchResultsView.buildSearchResultsMessage(token, session),
    );
  } catch (error: unknown) {
    logger.error('Search page button failed', {
      customId,
      user:  interaction.user?.username,
      error: (error as Error).message,
    });
    try {
      await interaction.followUp({
        content: '翻页失败，请重新搜索。',
        flags: MessageFlags.Ephemeral,
      });
    } catch { /* best effort */ }
  }
}

async function handleDailyPlay(interaction: any, customId: string, playerService: any): Promise<void> {
  if (!interaction.member.voice.channel) {
    return await interaction.editReply({ content: '\u{1F507} 请先加入一个语音频道再点击聆听。' });
  }

  const bvid = customId.slice('daily_play_'.length);
  if (!bvid) {
    return await interaction.editReply({ content: '[✗] 无效的视频 ID。' });
  }

  const videoUrl = `https://www.bilibili.com/video/${bvid}`;

  // In radio mode the rotation owns the queue, so a normal play request would
  // be discarded on the next advance. Interject the recommendation into the
  // rotation instead: it plays now, and the radio resumes when it ends.
  const radio = playerService.getRadioService?.();
  if (radio?.isEnabled(interaction.guild.id)) {
    return await handleDailyPlayDuringRadio(interaction, videoUrl, playerService, radio);
  }

  playerService.setUIContext(interaction.guild.id, interaction.channelId);
  const stageReporter = createInteractionStageReporter(interaction, 'Bilibili');
  const result = await playerService.playBilibiliVideo(interaction, videoUrl, {
    onStage: stageReporter,
  });
  await stageReporter.finish();

  if (!result || !result.success) {
    return await interaction.editReply({
      content: `[✗] 无法播放视频：${result?.error || '未知错误'}`,
    });
  }

  await interaction.editReply({ content: '[✓] 已加入队列！' });
  playerService.notifyState(interaction.guild.id);
}

async function handleDailyPlayDuringRadio(
  interaction: any,
  videoUrl: string,
  playerService: any,
  radio: any,
): Promise<void> {
  const player = playerService.getPlayer(interaction.guild.id);
  const botChannelId = player?.voiceConnection?.joinConfig?.channelId;
  if (botChannelId && interaction.member.voice.channel.id !== botChannelId) {
    return await interaction.editReply({ content: '\u{1F507} 请先加入电台所在的语音频道再点击聆听。' });
  }

  await interaction.editReply({ content: '📻 电台模式运行中，正在为你插播这首推荐…' });

  playerService.setUIContext(interaction.guild.id, interaction.channelId);
  const result = await radio.playNow(
    interaction.guild.id,
    videoUrl,
    `<@${interaction.user.id}>`,
  );

  if (!result.success) {
    return await interaction.editReply({
      content: `[✗] 无法播放视频：${result.error || '未知错误'}`,
    });
  }

  await interaction.editReply({ content: '[✓] 正在插播今日推荐，播放结束后自动回到电台模式。' });
}

function isRadioMode(interaction: any, playerService: any): boolean {
  const guildId = interaction.guild?.id;
  if (!guildId || typeof playerService.getPlayer !== 'function') return false;

  try {
    return Boolean(playerService.getPlayer(guildId)?.radioMode);
  } catch {
    return false;
  }
}

function isRadioOnBreak(interaction: any, playerService: any): boolean {
  const guildId = interaction.guild?.id;
  if (!guildId) return false;

  try {
    return Boolean(playerService.getRadioService?.()?.isOnBreak(guildId));
  } catch {
    return false;
  }
}

async function denyRadioControl(interaction: any, isControlButton: boolean): Promise<void> {
  if (isControlButton) {
    await interaction.followUp({
      content: RADIO_ONLY_STOP_MESSAGE,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.editReply({ content: RADIO_ONLY_STOP_MESSAGE });
}

async function isRadioSkipDebounced(interaction: any): Promise<boolean> {
  const guildId = interaction.guild?.id;
  if (!guildId) return false;

  if (!Lock.shouldDebounce(guildId, 'radio_skip', RADIO_SKIP_DEBOUNCE_MS)) {
    return false;
  }

  await interaction.followUp({
    content: 'Please wait 5 seconds before skipping to the next radio video.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function handleControlButton(interaction: any, customId: string, playerService: any): Promise<void> {
  playerService.setUIContext(interaction.guild.id, interaction.channelId);
  const player = playerService.getPlayer(interaction.guild.id);

  if (customId === 'pause_resume') {
    if (player.isPlaying) {
      playerService.pause(interaction.guild.id);
    } else if (player.isPaused) {
      playerService.resume(interaction.guild.id);
    }
  } else if (customId === 'skip') {
    await playerService.skip(interaction.guild.id);
  } else if (customId === 'prev') {
    await playerService.previous(interaction.guild.id);
  } else if (customId === 'stop') {
    await playerService.stop(interaction.guild.id);
  }
}

async function showLoopMenu(interaction: any, user: any): Promise<void> {
  logger.debug('Showing loop mode selection menu', {
    user:  user.username,
    guild: interaction.guild?.name,
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('loop_select')
    .setPlaceholder('Choose loop mode...')
    .addOptions([
      { label: 'No Loop',     description: 'Play through queue once', value: 'none',  emoji: '➡️' },
      { label: 'Loop Queue',  description: 'Repeat entire queue',     value: 'queue', emoji: '\u{1F501}' },
      { label: 'Loop Single', description: 'Repeat current track',    value: 'track', emoji: '\u{1F502}' },
    ]);

  const selectRow = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.editReply({
    content:    '\u{1F501} **Choose Loop Mode:**',
    components: [selectRow],
  });
}

function buildButtonResponse(
  customId: string,
  result: any,
  interaction: any,
  playerService: any,
): { embed: any; buttons: any } {
  let embed: any;
  let buttons: any;

  switch (customId) {
    case 'queue': {
      const queueInfo = playerService.getQueue(interaction.guild.id);
      embed   = EmbedBuilders.createQueueEmbed(queueInfo.queue, {
        currentTrack: queueInfo.currentTrack,
        page:         1,
        itemsPerPage: 10,
        totalPages:   Math.ceil(queueInfo.state.queueLength / 10) || 1,
      });
      buttons = ButtonBuilders.createQueueControls({
        hasQueue: queueInfo.state.queueLength > 0,
      });
      break;
    }

    case 'queue_clear': {
      embed   = EmbedBuilders.createSuccessEmbed('Queue Cleared', '\u{1F5D1}️ The queue has been cleared');
      buttons = ButtonBuilders.createQueueControls({ hasQueue: result.player.queueLength > 0 });
      break;
    }

    case 'queue_shuffle': {
      embed   = EmbedBuilders.createSuccessEmbed('Queue Shuffled', '\u{1F500} The queue has been shuffled');
      buttons = ButtonBuilders.createQueueControls({ hasQueue: result.player.queueLength > 0 });
      break;
    }

    case 'queue_loop': {
      const loopMode  = result.mode as string;
      const loopEmoji = loopMode === 'none' ? '➡️' : loopMode === 'queue' ? '\u{1F501}' : '\u{1F502}';
      const loopText  = loopMode === 'none' ? 'disabled' : loopMode === 'queue' ? 'enabled (queue)' : 'enabled (single)';
      embed   = EmbedBuilders.createSuccessEmbed('Loop Mode Changed', `${loopEmoji} Loop mode ${loopText}`);
      buttons = ButtonBuilders.createQueueControls({ hasQueue: result.player.queueLength > 0 });
      break;
    }

    case 'loop': {
      // Handled above in the showMenu logic — should not reach here
      embed = EmbedBuilders.createSuccessEmbed('Action Completed', 'Action completed successfully');
      break;
    }

    case 'queue_remove': {
      const queueInfoRemove = playerService.getQueue(interaction.guild.id);
      if (!queueInfoRemove.queue || queueInfoRemove.queue.length === 0) {
        embed = EmbedBuilders.createErrorEmbed(
          'Queue Empty',
          'There are no tracks in the queue to remove.',
        );
        break;
      }
      const removeMenu = ButtonBuilders.createQueueRemoveMenu({
        queue:        queueInfoRemove.queue,
        currentIndex: queueInfoRemove.state.currentIndex,
      });
      embed   = EmbedBuilders.createSuccessEmbed(
        'Select Track to Remove',
        'Choose a track from the dropdown menu below to remove it from the queue.',
      );
      buttons = [removeMenu];
      break;
    }

    default: {
      embed = EmbedBuilders.createSuccessEmbed('Action Completed', 'Action completed successfully');
      break;
    }
  }

  return { embed, buttons };
}

async function handleButtonError(interaction: any, error: Error): Promise<void> {
  logger.error('Button interaction failed', {
    customId: interaction.customId,
    user:     interaction.user.username,
    error:    error.message,
    stack:    error.stack,
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

export = createButtonHandler;
