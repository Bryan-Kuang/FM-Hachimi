/**
 * Discord Button Builders
 * Creates interactive button components for bot controls
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");

class ButtonBuilders {
  /**
   * Create playback control buttons
   * @param {Object} state - Current playback state
   * @returns {ActionRowBuilder} - Discord action row with buttons
   */
  static createPlaybackControls(state = {}) {
    const {
      isPlaying = false,
      hasQueue = false,
      canGoBack = false,
      canSkip = false,
      loopMode = "none",
    } = state;

    // First row: prev, play/pause, next, stop
    const row1 = new ActionRowBuilder();

    // Previous button
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId("prev")
        .setLabel("⏮️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canGoBack)
    );

    // Play/Pause button
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId("pause_resume")
        .setLabel(isPlaying ? "⏸️" : "▶️")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!hasQueue)
    );

    // Next button (same as skip)
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId("skip")
        .setLabel("⏭️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canSkip)
    );

    // Stop button
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId("stop")
        .setLabel("⏹️")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasQueue)
    );

    // Second row: loop button
    const row2 = new ActionRowBuilder();

    const loopEmoji =
      loopMode === "none" ? "➡️" : loopMode === "queue" ? "🔁" : "🔂";
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId("loop")
        .setLabel(`${loopEmoji} Loop`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasQueue)
    );

    return [row1, row2];
  }

  /**
   * Create queue management buttons
   * @param {Object} options - Queue options
   * @returns {Array<ActionRowBuilder>} - Array of Discord action rows with buttons
   */
  static createQueueControls(options = {}) {
    const { hasQueue = false, queueLength = 0 } = options;

    const controlRow = new ActionRowBuilder();

    // Shuffle queue button
    controlRow.addComponents(
      new ButtonBuilder()
        .setCustomId("queue_shuffle")
        .setLabel("🔀 Shuffle")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(queueLength < 2)
    );

    // Loop toggle button
    controlRow.addComponents(
      new ButtonBuilder()
        .setCustomId("queue_loop")
        .setLabel("🔁 Loop")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasQueue)
    );

    // Remove track button (opens select menu)
    controlRow.addComponents(
      new ButtonBuilder()
        .setCustomId("queue_remove")
        .setLabel("🗑️ Remove")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasQueue)
    );

    return [controlRow];
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
   * Create confirmation buttons
   * @param {string} confirmId - Custom ID for confirm button
   * @param {string} cancelId - Custom ID for cancel button
   * @returns {ActionRowBuilder} - Discord action row with buttons
   */
  static createConfirmationButtons(confirmId = "confirm", cancelId = "cancel") {
    const row = new ActionRowBuilder();

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel("✅ Yes")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel("❌ No")
        .setStyle(ButtonStyle.Danger)
    );

    return row;
  }

  /**
   * Create help/info buttons
   * @returns {ActionRowBuilder} - Discord action row with buttons
   */
  static createHelpButtons() {
    const row = new ActionRowBuilder();

    row.addComponents(
      new ButtonBuilder()
        .setCustomId("help")
        .setLabel("❓ Help")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("info")
        .setLabel("ℹ️ Info")
        .setStyle(ButtonStyle.Secondary)
    );

    return row;
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
  static createVolumeControls(currentVolume = 50) {
    const row = new ActionRowBuilder();

    row.addComponents(
      new ButtonBuilder()
        .setCustomId("volume_down")
        .setLabel("🔉")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentVolume <= 0),
      new ButtonBuilder()
        .setCustomId("volume_up")
        .setLabel("🔊")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentVolume >= 100),
      new ButtonBuilder()
        .setCustomId("volume_mute")
        .setLabel(currentVolume === 0 ? "🔇" : "🔇")
        .setStyle(
          currentVolume === 0 ? ButtonStyle.Danger : ButtonStyle.Secondary
        )
    );

    return row;
  }

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
  static getButtonHandler(customId) {
    const handlers = {
      prev: require("../bot/commands/prev"),
      pause_resume: async (interaction) => {
        // Determine if currently playing to choose pause or resume
        // This would be implemented with the audio player state
        const isPlaying = true; // Placeholder

        if (isPlaying) {
          return require("../bot/commands/pause").execute(interaction);
        } else {
          return require("../bot/commands/resume").execute(interaction);
        }
      },
      skip: require("../bot/commands/skip"),
      queue: require("../bot/commands/queue"),
      queue_clear: async (interaction) => {
        // Implement queue clear functionality
        await interaction.reply({
          content: "🗑️ Queue cleared!",
          ephemeral: true,
        });
      },
      queue_shuffle: async (interaction) => {
        // Implement queue shuffle functionality
        await interaction.reply({
          content: "🔀 Queue shuffled!",
          ephemeral: true,
        });
      },
      queue_loop: async (interaction) => {
        // Implement loop toggle functionality
        await interaction.reply({
          content: "🔁 Loop toggled!",
          ephemeral: true,
        });
      },
    };

    return handlers[customId] || null;
  }
}

module.exports = ButtonBuilders;
