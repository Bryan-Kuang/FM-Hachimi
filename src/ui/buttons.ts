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

interface VolumeControlsOptions {
  currentVolume?: number;
  isMuted?: boolean;
  canAdjustVolume?: boolean;
}

interface HelpButtonsOptions {
  showCommands?: boolean;
  showInfo?: boolean;
  showSupport?: boolean;
}

interface ConfirmationButtonsOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  confirmEmoji?: string;
  cancelEmoji?: string;
  confirmId?: string;
  cancelId?: string;
}

interface QueueRemoveMenuOptions {
  queue?: { title: string; uploader?: string }[];
  currentIndex?: number;
}

interface UpdateButtonStatesOptions {
  isPlaying?: boolean;
  hasQueue?: boolean;
  canGoBack?: boolean;
  canSkip?: boolean;
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
      .setDisabled(!canSkip);

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
   * Create volume control buttons.
   */
  static createVolumeControls(options: VolumeControlsOptions = {}): ActionRowBuilder<ButtonBuilder> {
    const {
      currentVolume = 50,
      isMuted = false,
      canAdjustVolume = true,
    } = options;

    const row = new ActionRowBuilder<ButtonBuilder>();

    const volumeDownButton = new ButtonBuilder()
      .setCustomId('volume_down')
      .setLabel('🔉')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canAdjustVolume || currentVolume <= 0);

    const muteButton = new ButtonBuilder()
      .setCustomId('mute_toggle')
      .setLabel(isMuted ? '🔇 Unmute' : '🔇 Mute')
      .setStyle(isMuted ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(!canAdjustVolume);

    const volumeUpButton = new ButtonBuilder()
      .setCustomId('volume_up')
      .setLabel('🔊')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canAdjustVolume || currentVolume >= 100);

    const volumeDisplayButton = new ButtonBuilder()
      .setCustomId('volume_display')
      .setLabel(`Volume: ${currentVolume}%`)
      .setEmoji('🎚️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    row.addComponents(volumeDownButton, muteButton, volumeDisplayButton, volumeUpButton);

    return row;
  }

  /**
   * Create help and info buttons.
   */
  static createHelpButtons(options: HelpButtonsOptions = {}): ActionRowBuilder<ButtonBuilder> {
    const {
      showCommands = true,
      showInfo = true,
      showSupport = true,
    } = options;

    const row = new ActionRowBuilder<ButtonBuilder>();

    if (showCommands) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('help_commands')
          .setLabel('Commands')
          .setEmoji('📝')
          .setStyle(ButtonStyle.Primary),
      );
    }

    if (showInfo) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('bot_info')
          .setLabel('Bot Info')
          .setEmoji('ℹ️')
          .setStyle(ButtonStyle.Secondary),
      );
    }

    if (showSupport) {
      row.addComponents(
        new ButtonBuilder()
          .setURL('https://github.com/your-repo/bilibili-player')
          .setLabel('Support')
          .setEmoji('💬')
          .setStyle(ButtonStyle.Link),
      );
    }

    return row;
  }

  /**
   * Create confirmation buttons.
   */
  static createConfirmationButtons(options: ConfirmationButtonsOptions = {}): ActionRowBuilder<ButtonBuilder> {
    const {
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
      confirmEmoji = '✅',
      cancelEmoji = '❌',
      confirmId = 'confirm',
      cancelId = 'cancel',
    } = options;

    const row = new ActionRowBuilder<ButtonBuilder>();

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel(confirmLabel)
        .setEmoji(confirmEmoji)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel(cancelLabel)
        .setEmoji(cancelEmoji)
        .setStyle(ButtonStyle.Danger),
    );

    return row;
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

  /**
   * Create a retry button.
   */
  static createRetryButton(customId = 'retry'): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(customId)
        .setLabel('🔄 Retry')
        .setStyle(ButtonStyle.Primary),
    );
    return row;
  }

  /**
   * Create disabled buttons (for expired interactions).
   */
  static createDisabledButtons(
    buttonLabels: string[] = ['⏮️', '⏸️', '⏭️', '📋'],
  ): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();
    buttonLabels.forEach((label, index) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`disabled_${index}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );
    });
    return row;
  }

  /**
   * Update button states based on current conditions.
   */
  static updateButtonStates(
    existingRow: ActionRowBuilder<ButtonBuilder>,
    newState: UpdateButtonStatesOptions = {},
  ): ActionRowBuilder<ButtonBuilder> {
    const {
      isPlaying = false,
      hasQueue = false,
      canGoBack = false,
      canSkip = false,
    } = newState;

    const newRow = new ActionRowBuilder<ButtonBuilder>();

    existingRow.components.forEach((button) => {
      const newButton = ButtonBuilder.from(button.toJSON());
      // discord.js ButtonBuilder.data is Partial<APIButtonComponent> — access via cast
      const cid = (button.data as { custom_id?: string }).custom_id;

      switch (cid) {
        case 'prev':
          newButton.setDisabled(!canGoBack);
          break;
        case 'pause_resume':
          newButton.setLabel(isPlaying ? '⏸️' : '▶️').setDisabled(!hasQueue);
          break;
        case 'skip':
          newButton.setDisabled(!canSkip);
          break;
        default:
          break;
      }

      newRow.addComponents(newButton);
    });

    return newRow;
  }

  /**
   * Create a search results selection menu.
   */
  static createSearchResultsMenu(
    results: { title: string; uploader?: string; duration?: string | number }[],
    keyword: string,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const safeKeyword = keyword || 'search';
    const safeResults = Array.isArray(results) ? results : [];

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`search_select_${safeKeyword.replace(/\s+/g, '_')}`)
      .setPlaceholder('Choose a video to add to queue...')
      .setMinValues(1)
      .setMaxValues(1);

    safeResults.slice(0, 25).forEach((result, index) => {
      const title = result.title.length > 90 ? result.title.substring(0, 90) + '...' : result.title;
      const uploader = result.uploader || 'Unknown';
      const duration = result.duration || 'Unknown';
      selectMenu.addOptions({
        label: `${index + 1}. ${title}`,
        description: `${uploader} | ${duration}`,
        value: `search_result_${index}`,
      });
    });

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
  }

  /**
   * Create a dual-platform search results selection menu.
   * Values are prefixed with platform: "bili_0", "yt_0", etc.
   */
  static createDualSearchMenu(
    biliResults: { title: string; uploader?: string; duration?: string | number }[],
    ytResults: { title: string; uploader?: string; duration?: string | number }[],
    keyword: string,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const safeKeyword = (keyword || 'search').replace(/\s+/g, '_');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`play_search_${safeKeyword}`)
      .setPlaceholder('Choose a video to play...')
      .setMinValues(1)
      .setMaxValues(1);

    biliResults.slice(0, 10).forEach((result, index) => {
      const title = result.title.length > 80 ? result.title.substring(0, 80) + '...' : result.title;
      const uploader = result.uploader || 'Unknown';
      selectMenu.addOptions({
        label: `B${index + 1}. ${title}`,
        description: `Bilibili | ${uploader}`,
        value: `bili_${index}`,
        emoji: '📺',
      });
    });

    ytResults.slice(0, 10).forEach((result, index) => {
      const title = result.title.length > 80 ? result.title.substring(0, 80) + '...' : result.title;
      const uploader = result.uploader || 'Unknown';
      selectMenu.addOptions({
        label: `Y${index + 1}. ${title}`,
        description: `YouTube | ${uploader}`,
        value: `yt_${index}`,
        emoji: '▶️',
      });
    });

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
  }
}

export = ButtonBuilders;
