/**
 * Discord Button Builders
 * Creates interactive button components for bot controls
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';

interface PlaybackControlsOptions {
  isPlaying?: boolean;
  canSkip?: boolean;
  canGoBack?: boolean;
  hasQueue?: boolean;
  loopMode?: string;
  radioMode?: boolean;
  _volume?: number;
  _isShuffled?: boolean;
}

interface QueueControlsOptions {
  hasQueue?: boolean;
  _canShuffle?: boolean;
  _isShuffled?: boolean;
  _canClear?: boolean;
  currentPage?: number;
  totalPages?: number;
}

interface QueueRemoveMenuOptions {
  queue?: { title: string; uploader?: string }[];
  currentIndex?: number;
}

class ButtonBuilders {
  /**
   * Create modern playback control buttons.
   */
  static createPlaybackControls(options: PlaybackControlsOptions = {}): ActionRowBuilder<ButtonBuilder>[] {
    const {
      isPlaying = false,
      canSkip = true,
      canGoBack = false,
      hasQueue = false,
      loopMode = 'none',
      radioMode = false,
    } = options;

    const row1 = new ActionRowBuilder<ButtonBuilder>();
    const row2 = new ActionRowBuilder<ButtonBuilder>();

    // Uniform button color: state conveyed through label/emoji changes.
    // Loop is the exception — color encodes loop mode.
    const previousButton = new ButtonBuilder()
      .setCustomId('prev')
      .setLabel('Previous')
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canGoBack);

    const playPauseButton = new ButtonBuilder()
      .setCustomId('pause_resume')
      .setLabel(isPlaying ? 'Pause' : 'Play')
      .setEmoji(isPlaying ? '⏸️' : '▶️')
      .setStyle(ButtonStyle.Secondary);

    const stopButton = new ButtonBuilder()
      .setCustomId('stop')
      .setLabel('Stop')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Secondary);

    const skipButton = new ButtonBuilder()
      .setCustomId('skip')
      .setLabel('Skip')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(radioMode ? false : !canSkip);

    if (radioMode) {
      row1.addComponents(stopButton, skipButton);
      return [row1];
    }

    const loopEmojis: Record<string, string> = {
      none: '🔁',
      track: '🔂',
      queue: '🔁',
    };
    const loopButton = new ButtonBuilder()
      .setCustomId('loop')
      .setLabel(`Loop: ${loopMode === 'none' ? 'Off' : loopMode === 'track' ? 'Single' : 'Queue'}`)
      .setEmoji(loopEmojis[loopMode] ?? '🔁')
      .setStyle(loopMode === 'none' ? ButtonStyle.Secondary : ButtonStyle.Success);

    const queueButton = new ButtonBuilder()
      .setCustomId('queue')
      .setLabel('Queue')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasQueue);

    row1.addComponents(previousButton, playPauseButton, stopButton, skipButton, loopButton);
    row2.addComponents(queueButton);

    return [row1, row2];
  }

  /**
   * Create queue control buttons.
   */
  static createQueueControls(options: QueueControlsOptions = {}): ActionRowBuilder<ButtonBuilder>[] {
    const {
      hasQueue = false,
      currentPage = 1,
      totalPages = 1,
    } = options;

    const row = new ActionRowBuilder<ButtonBuilder>();

    const removeButton = new ButtonBuilder()
      .setCustomId('queue_remove')
      .setLabel('Remove')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasQueue);

    const prevPageButton = new ButtonBuilder()
      .setCustomId('queue_prev_page')
      .setLabel('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1 || totalPages <= 1);

    const nextPageButton = new ButtonBuilder()
      .setCustomId('queue_next_page')
      .setLabel('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages || totalPages <= 1);

    row.addComponents(removeButton, prevPageButton, nextPageButton);

    return [row];
  }

  /**
   * Create a queue remove select menu.
   */
  static createQueueRemoveMenu(options: QueueRemoveMenuOptions = {}): ActionRowBuilder<StringSelectMenuBuilder> {
    const { queue = [], currentIndex = -1 } = options;

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('queue_remove_select')
      .setPlaceholder('Select a track to remove...')
      .setMinValues(1)
      .setMaxValues(1);

    selectMenu.addOptions({
      label: '🗑️ Remove All Tracks',
      description: 'Clear the entire queue',
      value: 'remove_all',
      emoji: '🗑️',
    });

    queue.forEach((item, index) => {
      if (index === currentIndex) return;
      const trackTitle = item.title.length > 80 ? item.title.substring(0, 80) + '...' : item.title;
      const trackDescription = item.uploader ? `by ${item.uploader}` : 'Unknown uploader';
      selectMenu.addOptions({
        label: `${index + 1}. ${trackTitle}`,
        description: trackDescription.length > 100
          ? trackDescription.substring(0, 100) + '...'
          : trackDescription,
        value: `remove_${index}`,
        emoji: '🎵',
      });
    });

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
  }

}

export = ButtonBuilders;
