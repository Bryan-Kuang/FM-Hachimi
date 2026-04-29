/**
 * Discord Button Builders
 * Creates interactive button components for bot controls
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");

class ButtonBuilders {
  /**
   * Create modern playback control buttons with enhanced visual design
   * @param {Object} options - Button configuration options
   * @returns {Array<ActionRowBuilder>} - Array of Discord action rows with buttons
   */
  static createPlaybackControls(options = {}) {
    const {
      isPlaying = false,
      canSkip = true,
      canGoBack = false,
      hasQueue = false,
      loopMode = "none",
      _volume = 50,
      _isShuffled = false,
    } = options;

    const row1 = new ActionRowBuilder();
    const row2 = new ActionRowBuilder();

    // Uniform button color: every non-loop control uses Secondary (gray).
    // Per the 2026-04-28 redesign, state is conveyed through label/emoji
    // changes (▶️ Play vs ⏸️ Pause) rather than color. Loop is the lone
    // exception — its color encodes the loop mode (the embed body no
    // longer carries any loop indicator), so Off=Secondary, On=Success.
    const previousButton = new ButtonBuilder()
      .setCustomId("prev")
      .setLabel("Previous")
      .setEmoji("⏮️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canGoBack);

    const playPauseButton = new ButtonBuilder()
      .setCustomId("pause_resume")
      .setLabel(isPlaying ? "Pause" : "Play")
      .setEmoji(isPlaying ? "⏸️" : "▶️")
      .setStyle(ButtonStyle.Secondary);

    const stopButton = new ButtonBuilder()
      .setCustomId("stop")
      .setLabel("Stop")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Secondary);

    const skipButton = new ButtonBuilder()
      .setCustomId("skip")
      .setLabel("Skip")
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canSkip);

    // Loop button: color IS the state indicator now (no embed-body
    // duplicate). Off → Secondary (gray), Single/Queue → Success (green).
    const loopEmojis = {
      none: "🔁",
      track: "🔂",
      queue: "🔁",
    };
    const loopButton = new ButtonBuilder()
      .setCustomId("loop")
      .setLabel(`Loop: ${loopMode === "none" ? "Off" : loopMode === "track" ? "Single" : "Queue"}`)
      .setEmoji(loopEmojis[loopMode])
      .setStyle(loopMode === "none" ? ButtonStyle.Secondary : ButtonStyle.Success);

    // Queue button kept (per user spec) but flattened to Secondary too.
    const queueButton = new ButtonBuilder()
      .setCustomId("queue")
      .setLabel("Queue")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasQueue);

    // First row: main playback controls
    row1.addComponents(previousButton, playPauseButton, stopButton, skipButton, loopButton);
    
    // Second row: queue management
    row2.addComponents(queueButton);

    return [row1, row2];
  }

  /**
   * Create modern queue control buttons with enhanced visual design
   * @param {Object} options - Button configuration options
   * @returns {ActionRowBuilder} - Discord action row with buttons
   */
  static createQueueControls(options = {}) {
    const {
      hasQueue = false,
      _canShuffle = false,
      _isShuffled = false,
      _canClear = false,
      currentPage = 1,
      totalPages = 1,
    } = options;

    const row = new ActionRowBuilder();

    // Remove from queue button with warning style
    const removeButton = new ButtonBuilder()
      .setCustomId("queue_remove")
      .setLabel("Remove")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasQueue);

    // Previous page button
    const prevPageButton = new ButtonBuilder()
      .setCustomId("queue_prev_page")
      .setLabel("◀️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1 || totalPages <= 1);

    // Next page button
    const nextPageButton = new ButtonBuilder()
      .setCustomId("queue_next_page")
      .setLabel("▶️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages || totalPages <= 1);

    row.addComponents(removeButton, prevPageButton, nextPageButton);

    return [row]; // Return array of ActionRowBuilders
  }

  /**
   * Create modern volume control buttons with enhanced visual design
   * @param {Object} options - Button configuration options
   * @returns {ActionRowBuilder} - Discord action row with buttons
   */
  static createVolumeControls(options = {}) {
    const {
      currentVolume = 50,
      isMuted = false,
      canAdjustVolume = true,
    } = options;

    const row = new ActionRowBuilder();

    // Volume down button
    const volumeDownButton = new ButtonBuilder()
      .setCustomId("volume_down")
      .setLabel("🔉")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canAdjustVolume || currentVolume <= 0);

    // Mute/Unmute button with dynamic styling
    const muteButton = new ButtonBuilder()
      .setCustomId("mute_toggle")
      .setLabel(isMuted ? "🔇 Unmute" : "🔇 Mute")
      .setStyle(isMuted ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(!canAdjustVolume);

    // Volume up button
    const volumeUpButton = new ButtonBuilder()
      .setCustomId("volume_up")
      .setLabel("🔊")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canAdjustVolume || currentVolume >= 100);

    // Volume display (non-interactive)
    const volumeDisplayButton = new ButtonBuilder()
      .setCustomId("volume_display")
      .setLabel(`Volume: ${currentVolume}%`)
      .setEmoji("🎚️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    row.addComponents(volumeDownButton, muteButton, volumeDisplayButton, volumeUpButton);

    return row;
  }

  /**
   * Create modern help and info buttons with enhanced visual design
   * @param {Object} options - Button configuration options
   * @returns {ActionRowBuilder} - Discord action row with buttons
   */
  static createHelpButtons(options = {}) {
    const {
      showCommands = true,
      showInfo = true,
      showSupport = true,
    } = options;

    const row = new ActionRowBuilder();

    if (showCommands) {
      // Commands help button
      const commandsButton = new ButtonBuilder()
        .setCustomId("help_commands")
        .setLabel("Commands")
        .setEmoji("📝")
        .setStyle(ButtonStyle.Primary);

      row.addComponents(commandsButton);
    }

    if (showInfo) {
      // Bot info button
      const infoButton = new ButtonBuilder()
        .setCustomId("bot_info")
        .setLabel("Bot Info")
        .setEmoji("ℹ️")
        .setStyle(ButtonStyle.Secondary);

      row.addComponents(infoButton);
    }

    if (showSupport) {
      // Support button (link style)
      const supportButton = new ButtonBuilder()
        .setURL("https://github.com/your-repo/bilibili-player")
        .setLabel("Support")
        .setEmoji("💬")
        .setStyle(ButtonStyle.Link);

      row.addComponents(supportButton);
    }

    return row;
  }

  /**
   * Create modern confirmation buttons with enhanced visual design
   * @param {Object} options - Button configuration options
   * @returns {ActionRowBuilder} - Discord action row with buttons
   */
  static createConfirmationButtons(options = {}) {
    const {
      confirmLabel = "Confirm",
      cancelLabel = "Cancel",
      confirmEmoji = "✅",
      cancelEmoji = "❌",
      confirmId = "confirm",
      cancelId = "cancel",
    } = options;

    const row = new ActionRowBuilder();

    // Confirm button with success style
    const confirmButton = new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel(confirmLabel)
      .setEmoji(confirmEmoji)
      .setStyle(ButtonStyle.Success);

    // Cancel button with danger style
    const cancelButton = new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel(cancelLabel)
      .setEmoji(cancelEmoji)
      .setStyle(ButtonStyle.Danger);

    row.addComponents(confirmButton, cancelButton);

    return row;
  }

  /**
   * Create queue remove select menu
   * @param {Object} options - Queue options
   * @returns {ActionRowBuilder} - Discord action row with select menu
   */
  static createQueueRemoveMenu(options = {}) {
    const { queue = [], currentIndex = -1 } = options;

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("queue_remove_select")
      .setPlaceholder("Select a track to remove...")
      .setMinValues(1)
      .setMaxValues(1);

    // Add "Remove All" option
    selectMenu.addOptions({
      label: "🗑️ Remove All Tracks",
      description: "Clear the entire queue",
      value: "remove_all",
      emoji: "🗑️"
    });

    // Add individual tracks (excluding currently playing track)
    queue.forEach((item, index) => {
      if (index === currentIndex) return; // Skip currently playing track
      
      const trackTitle = item.title.length > 80 ? item.title.substring(0, 80) + "..." : item.title;
      const trackDescription = item.uploader ? `by ${item.uploader}` : "Unknown uploader";
      
      selectMenu.addOptions({
        label: `${index + 1}. ${trackTitle}`,
        description: trackDescription.length > 100 ? trackDescription.substring(0, 100) + "..." : trackDescription,
        value: `remove_${index}`,
        emoji: "🎵"
      });
    });

    return new ActionRowBuilder().addComponents(selectMenu);
  }

  /**
   * Create retry button
   * @param {string} customId - Custom ID for retry button
   * @returns {ActionRowBuilder} - Discord action row with retry button
   */
  static createRetryButton(customId = "retry") {
    const row = new ActionRowBuilder();

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(customId)
        .setLabel("🔄 Retry")
        .setStyle(ButtonStyle.Primary)
    );

    return row;
  }

  /**
   * Create volume control buttons
   * @param {number} currentVolume - Current volume (0-100)
   * @returns {ActionRowBuilder} - Discord action row with volume buttons
   */
  // Duplicate createVolumeControls removed; use the options-based version above.

  /**
   * Create disabled buttons (for expired interactions)
   * @param {Array} buttonLabels - Array of button labels to disable
   * @returns {ActionRowBuilder} - Discord action row with disabled buttons
   */
  static createDisabledButtons(buttonLabels = ["⏮️", "⏸️", "⏭️", "📋"]) {
    const row = new ActionRowBuilder();

    buttonLabels.forEach((label, index) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`disabled_${index}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
    });

    return row;
  }

  /**
   * Update button states based on current conditions
   * @param {ActionRowBuilder} existingRow - Existing button row
   * @param {Object} newState - New state to apply
   * @returns {ActionRowBuilder} - Updated button row
   */
  static updateButtonStates(existingRow, newState = {}) {
    const {
      isPlaying = false,
      hasQueue = false,
      canGoBack = false,
      canSkip = false,
    } = newState;

    const newRow = new ActionRowBuilder();

    existingRow.components.forEach((button) => {
      const newButton = ButtonBuilder.from(button);

      switch (button.customId) {
        case "prev":
          newButton.setDisabled(!canGoBack);
          break;
        case "pause_resume":
          newButton.setLabel(isPlaying ? "⏸️" : "▶️").setDisabled(!hasQueue);
          break;
        case "skip":
          newButton.setDisabled(!canSkip);
          break;
        default:
          // Keep other buttons as they are
          break;
      }

      newRow.addComponents(newButton);
    });

    return newRow;
  }

  /**
   * Get button interaction handler
   * @param {string} customId - Button custom ID
   * @returns {Function|null} - Handler function or null
   */
  // Removed legacy getButtonHandler; interaction routing handled centrally in interactionCreate

  /**
   * Create search results selection menu
   * @param {Array} results - Search results array
   * @param {string} keyword - Search keyword for custom ID
   * @returns {ActionRowBuilder} - Discord action row with select menu
   */
  static createSearchResultsMenu(results, keyword) {
    const safeKeyword = keyword || 'search';
    const safeResults = Array.isArray(results) ? results : [];
    
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`search_select_${safeKeyword.replace(/\s+/g, '_')}`)
      .setPlaceholder('Choose a video to add to queue...')
      .setMinValues(1)
      .setMaxValues(1);

    // Add up to 25 options (Discord limit)
    safeResults.slice(0, 25).forEach((result, index) => {
      const title = result.title.length > 90 ? result.title.substring(0, 90) + "..." : result.title;
      const uploader = result.uploader || "Unknown";
      const duration = result.duration || "Unknown";
      
      selectMenu.addOptions({
        label: `${index + 1}. ${title}`,
        description: `${uploader} | ${duration}`,
        value: `search_result_${index}`,
      });
    });

    return new ActionRowBuilder().addComponents(selectMenu);
  }
}

module.exports = ButtonBuilders;
