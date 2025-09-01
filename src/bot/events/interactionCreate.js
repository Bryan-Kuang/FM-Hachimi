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

    // Check if user is in a voice channel for control buttons
    const controlButtons = ["pause_resume", "skip", "prev"];
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

    if (!result.success) {
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
        });
        break;
      }

      case "queue_clear": {
        responseEmbed = EmbedBuilders.createSuccessEmbed(
          "Queue Cleared",
          "🗑️ The queue has been cleared"
        );

        responseButtons = ButtonBuilders.createQueueControls({
          hasQueue: result.player.queueLength > 0,
          queueLength: result.player.queueLength,
        });
        break;
      }

      case "queue_shuffle": {
        responseEmbed = EmbedBuilders.createSuccessEmbed(
          "Queue Shuffled",
          "🔀 The queue has been shuffled"
        );

        responseButtons = ButtonBuilders.createQueueControls({
          hasQueue: result.player.queueLength > 0,
          queueLength: result.player.queueLength,
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

        responseButtons = ButtonBuilders.createQueueControls({
          hasQueue: result.player.queueLength > 0,
          queueLength: result.player.queueLength,
        });
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
      response.components = [responseButtons];
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
