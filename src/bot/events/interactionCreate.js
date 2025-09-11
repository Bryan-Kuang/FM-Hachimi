/**
 * Interaction Create Event Handler
 * Handles button interactions for audio controls
 */

const AudioManager = require("../../audio/manager");
const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const logger = require("../../utils/logger");

module.exports = {
  name: "interactionCreate",

  async execute(interaction) {
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
 * Handle button interactions
 * @param {ButtonInteraction} interaction - Discord button interaction
 */
async function handleButtonInteraction(interaction) {
  try {
    const customId = interaction.customId;
    const user = interaction.user;

    logger.debug("Button interaction received", {
      customId,
      user: user.username,
      guild: interaction.guild?.name,
    });

    // Check if user is in a voice channel for control buttons
    const controlButtons = ["pause_resume", "skip", "prev", "stop"];
    if (controlButtons.includes(customId)) {
      if (!interaction.member.voice.channel) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Voice Channel Required",
          "You need to be in a voice channel to control playback!",
          {
            suggestion: "Join the voice channel where music is playing.",
          }
        );

        return await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }
    }

    // Handle button interaction with audio manager
    const result = await AudioManager.handleButtonInteraction(interaction);

    if (!result.success && !result.showMenu) {
      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Action Failed",
        result.error,
        {
          suggestion: result.suggestion,
        }
      );

      return await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }

    // Handle loop button menu display
    if (result.showMenu && customId === "loop") {
      logger.debug("Showing loop mode selection menu", {
        user: user.username,
        guild: interaction.guild?.name,
      });

      const {
        StringSelectMenuBuilder,
        ActionRowBuilder,
      } = require("discord.js");

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("loop_select")
        .setPlaceholder("Choose loop mode...")
        .addOptions([
          {
            label: "No Loop",
            description: "Play through queue once",
            value: "none",
            emoji: "➡️",
          },
          {
            label: "Loop Queue",
            description: "Repeat entire queue",
            value: "queue",
            emoji: "🔁",
          },
          {
            label: "Loop Single",
            description: "Repeat current track",
            value: "track",
            emoji: "🔂",
          },
        ]);

      const selectRow = new ActionRowBuilder().addComponents(selectMenu);

      return await interaction.reply({
        content: "🔁 **Choose Loop Mode:**",
        components: [selectRow],
        ephemeral: true,
      });
    }

    // Create response based on button type
    let responseEmbed;
    let responseButtons;

    switch (customId) {
      case "pause_resume": {
        const isPlaying = result.player.isPlaying;
        responseEmbed = EmbedBuilders.createSuccessEmbed(
          isPlaying ? "Resumed" : "Paused",
          isPlaying ? "▶️ Audio playback resumed" : "⏸️ Audio playback paused"
        );

        responseButtons = ButtonBuilders.createPlaybackControls({
          isPlaying: result.player.isPlaying,
          hasQueue: result.player.queueLength > 0,
          canGoBack: result.player.hasPrevious,
          canSkip: result.player.hasNext,
          loopMode: result.player.loopMode,
        });
        break;
      }

      case "skip": {
        if (result.newTrack) {
          responseEmbed = EmbedBuilders.createNowPlayingEmbed(result.newTrack, {
            requestedBy: result.newTrack.requestedBy,
            queuePosition: result.player.currentIndex + 1,
            totalQueue: result.player.queueLength,
          });
        } else {
          responseEmbed = EmbedBuilders.createSuccessEmbed(
            "Skipped",
            "⏭️ Skipped to next track"
          );
        }

        responseButtons = ButtonBuilders.createPlaybackControls({
          isPlaying: result.player.isPlaying,
          hasQueue: result.player.queueLength > 0,
          canGoBack: result.player.hasPrevious,
          canSkip: result.player.hasNext,
          loopMode: result.player.loopMode,
        });
        break;
      }

      case "prev": {
        if (result.newTrack) {
          responseEmbed = EmbedBuilders.createNowPlayingEmbed(result.newTrack, {
            requestedBy: result.newTrack.requestedBy,
            queuePosition: result.player.currentIndex + 1,
            totalQueue: result.player.queueLength,
          });
        } else {
          responseEmbed = EmbedBuilders.createSuccessEmbed(
            "Previous",
            "⏮️ Went back to previous track"
          );
        }

        responseButtons = ButtonBuilders.createPlaybackControls({
          isPlaying: result.player.isPlaying,
          hasQueue: result.player.queueLength > 0,
          canGoBack: result.player.hasPrevious,
          canSkip: result.player.hasNext,
          loopMode: result.player.loopMode,
        });
        break;
      }

      case "queue": {
        const queueInfo = AudioManager.getQueue(interaction.guild.id);
        responseEmbed = EmbedBuilders.createQueueEmbed(
          queueInfo.queue,
          queueInfo.state.currentIndex
        );

        responseButtons = ButtonBuilders.createQueueControls({
          hasQueue: queueInfo.state.queueLength > 0,
          queueLength: queueInfo.state.queueLength,
          queue: queueInfo.queue,
          currentIndex: queueInfo.state.currentIndex,
        });
        break;
      }

      case "queue_clear": {
        responseEmbed = EmbedBuilders.createSuccessEmbed(
          "Queue Cleared",
          "🗑️ The queue has been cleared"
        );

        const queueInfo = AudioManager.getQueue(interaction.guild.id);
        responseButtons = ButtonBuilders.createQueueControls({
          hasQueue: result.player.queueLength > 0,
          queueLength: result.player.queueLength,
          queue: queueInfo.queue,
          currentIndex: queueInfo.state.currentIndex,
        });
        break;
      }

      case "queue_shuffle": {
        responseEmbed = EmbedBuilders.createSuccessEmbed(
          "Queue Shuffled",
          "🔀 The queue has been shuffled"
        );

        const queueInfoShuffle = AudioManager.getQueue(interaction.guild.id);
        responseButtons = ButtonBuilders.createQueueControls({
          hasQueue: result.player.queueLength > 0,
          queueLength: result.player.queueLength,
          queue: queueInfoShuffle.queue,
          currentIndex: queueInfoShuffle.state.currentIndex,
        });
        break;
      }

      case "queue_loop": {
        const loopMode = result.mode;
        const loopEmoji =
          loopMode === "none" ? "➡️" : loopMode === "queue" ? "🔁" : "🔂";
        const loopText =
          loopMode === "none"
            ? "disabled"
            : loopMode === "queue"
            ? "enabled (queue)"
            : "enabled (track)";

        responseEmbed = EmbedBuilders.createSuccessEmbed(
          "Loop Mode Changed",
          `${loopEmoji} Loop mode ${loopText}`
        );

        const queueInfoLoop = AudioManager.getQueue(interaction.guild.id);
        responseButtons = ButtonBuilders.createQueueControls({
          hasQueue: result.player.queueLength > 0,
          queueLength: result.player.queueLength,
          queue: queueInfoLoop.queue,
          currentIndex: queueInfoLoop.state.currentIndex,
        });
        break;
      }

      case "stop": {
        responseEmbed = EmbedBuilders.createSuccessEmbed(
          "⏹️ Playback Stopped",
          "Music stopped, queue cleared, and left voice channel."
        );
        break;
      }

      case "loop": {
        // This is handled above in the showMenu logic
        return;
      }

      case "queue_remove": {
        const queueInfo = AudioManager.getQueue(interaction.guild.id);
        
        if (!queueInfo.queue || queueInfo.queue.length === 0) {
          responseEmbed = EmbedBuilders.createErrorEmbed(
            "Queue Empty",
            "There are no tracks in the queue to remove."
          );
          break;
        }

        // Create and send select menu
        const selectMenu = ButtonBuilders.createQueueRemoveMenu({
          queue: queueInfo.queue,
          currentIndex: queueInfo.state.currentIndex,
        });

        responseEmbed = EmbedBuilders.createSuccessEmbed(
          "Select Track to Remove",
          "Choose a track from the dropdown menu below to remove it from the queue."
        );

        responseButtons = [selectMenu];
        break;
      }

      default: {
        responseEmbed = EmbedBuilders.createSuccessEmbed(
          "Action Completed",
          "✅ Action completed successfully"
        );
        break;
      }
    }

    // Send response
    const response = {
      embeds: [responseEmbed],
    };

    if (responseButtons) {
      response.components = responseButtons;
    }

    await interaction.reply(response);

    logger.info("Button interaction handled successfully", {
      customId,
      user: user.username,
      guild: interaction.guild?.name,
    });
  } catch (error) {
    logger.error("Button interaction failed", {
      customId: interaction.customId,
      user: interaction.user.username,
      error: error.message,
      stack: error.stack,
    });

    const errorEmbed = EmbedBuilders.createErrorEmbed(
      "Interaction Failed",
      "An error occurred while processing your request.",
      {
        errorCode: "BUTTON_INTERACTION_FAILED",
      }
    );

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }
    } catch (replyError) {
      logger.error("Failed to send error response for button interaction", {
        error: replyError.message,
      });
    }
  }
}

/**
 * Handle select menu interactions
 * @param {StringSelectMenuInteraction} interaction - Discord select menu interaction
 */
async function handleSelectMenuInteraction(interaction) {
  try {
    const customId = interaction.customId;
    const user = interaction.user;

    if (customId === "queue_remove_select") {
      const selectedValue = interaction.values[0];

      logger.debug("Queue remove select menu interaction received", {
        selectedValue,
        user: user.username,
        guild: interaction.guild?.name,
      });

      // Defer the reply immediately to avoid timeout
      await interaction.deferReply();

      let result;
      let responseEmbed;
      let responseButtons;

      if (selectedValue === "clear_all" || selectedValue === "remove_all") {
        // Clear all tracks from queue
        result = AudioManager.clearQueue(interaction.guild.id);
        
        if (!result.success) {
          const errorEmbed = EmbedBuilders.createErrorEmbed(
            "Clear Queue Failed",
            result.error || "Failed to clear the queue",
            {
              suggestion: result.suggestion || "Please try again.",
            }
          );

          return await interaction.editReply({
            embeds: [errorEmbed],
          });
        }

        responseEmbed = EmbedBuilders.createSuccessEmbed(
          "Queue Cleared",
          "🗑️ All tracks have been removed from the queue"
        );

        responseButtons = ButtonBuilders.createQueueControls({
          hasQueue: false,
          queueLength: 0,
          queue: [],
          currentIndex: -1,
        });
      } else {
        // Remove specific track by index
        // Extract index from "remove_X" format
        const indexMatch = selectedValue.match(/^remove_(\d+)$/);
        if (!indexMatch) {
          const errorEmbed = EmbedBuilders.createErrorEmbed(
            "Invalid Selection",
            "Invalid track selection format",
            {
              suggestion: "Please try selecting a track again.",
            }
          );

          return await interaction.editReply({
            embeds: [errorEmbed],
          });
        }
        
        const index = parseInt(indexMatch[1]);
        result = AudioManager.removeFromQueue(interaction.guild.id, index);
        
        if (!result.success) {
          const errorEmbed = EmbedBuilders.createErrorEmbed(
            "Remove Track Failed",
            result.error || "Failed to remove the track",
            {
              suggestion: result.suggestion || "Please try again.",
            }
          );

          return await interaction.editReply({
            embeds: [errorEmbed],
          });
        }

        responseEmbed = EmbedBuilders.createSuccessEmbed(
          "Track Removed",
          `🗑️ Track has been removed from the queue`
        );

        const queueInfo = AudioManager.getQueue(interaction.guild.id);
        responseButtons = ButtonBuilders.createQueueControls({
          hasQueue: queueInfo.queue.length > 0,
          queueLength: queueInfo.queue.length,
          queue: queueInfo.queue,
          currentIndex: queueInfo.state.currentIndex,
        });
      }

      // Update the original message with new queue info
      const queueInfo = AudioManager.getQueue(interaction.guild.id);
      const queueEmbed = EmbedBuilders.createQueueEmbed(
        queueInfo.queue,
        queueInfo.state.currentIndex
      );

      const response = {
        embeds: [queueEmbed],
      };

      if (responseButtons) {
        response.components = responseButtons;
      }

      // Update the original queue message
      await interaction.message.edit(response);

      // Send confirmation as ephemeral reply
      await interaction.editReply({
        embeds: [responseEmbed],
        ephemeral: true,
      });

      logger.info("Track removed via select menu", {
        selectedValue,
        user: user.username,
        guild: interaction.guild?.name,
      });
    } else if (customId === "loop_select") {
      const selectedMode = interaction.values[0];

      logger.debug("Loop select menu interaction received", {
        selectedMode,
        user: user.username,
        guild: interaction.guild?.name,
      });

      // Defer the reply immediately to avoid timeout
      await interaction.deferReply({ ephemeral: true });

      // Handle loop mode change with audio manager
      const result = AudioManager.setLoopMode(
        interaction.guild.id,
        selectedMode
      );

      if (!result.success) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Loop Mode Failed",
          result.error || "Failed to change loop mode",
          {
            suggestion: result.suggestion || "Please try again.",
          }
        );

        return await interaction.editReply({
          embeds: [errorEmbed],
        });
      }

      const loopEmoji =
        selectedMode === "none" ? "➡️" : selectedMode === "queue" ? "🔁" : "🔂";
      const loopText =
        selectedMode === "none"
          ? "disabled"
          : selectedMode === "queue"
          ? "enabled (queue)"
          : "enabled (track)";

      const successEmbed = EmbedBuilders.createSuccessEmbed(
        "Loop Mode Changed",
        `${loopEmoji} Loop mode ${loopText}`
      );

      await interaction.editReply({
        embeds: [successEmbed],
      });

      logger.info("Loop mode changed via select menu", {
        mode: selectedMode,
        user: user.username,
        guild: interaction.guild?.name,
      });
    }
  } catch (error) {
    logger.error("Select menu interaction failed", {
      customId: interaction.customId,
      user: interaction.user.username,
      guild: interaction.guild?.name,
      error: error.message,
      stack: error.stack,
    });

    // Try to respond with error if possible
    try {
      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Interaction Failed",
        "An error occurred while processing your selection.",
        {
          errorCode: "SELECT_MENU_FAILED",
        }
      );

      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed],
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }
    } catch (replyError) {
      logger.error("Failed to send error response for select menu", {
        error: replyError.message,
      });
    }
  }
}
