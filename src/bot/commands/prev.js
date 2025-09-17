/**
 * Previous Command
 * Goes back to the previous track in the queue
 */

const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("prev")
    .setDescription("Go back to the previous track in the queue"),

  cooldown: 3,

  async execute(interaction) {
    try {
      const member = interaction.member;
      const user = interaction.user;

      // Check if user is in a voice channel
      if (!member.voice.channel) {
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

      // TODO: Check if there's a previous track in queue
      const hasPreviousTrack = false; // This will be replaced with actual queue state

      if (!hasPreviousTrack) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "No Previous Track",
          "There are no previous tracks in the queue to go back to.",
          {
            suggestion: "This is the first track in the queue.",
          }
        );

        return await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      // Go to previous track
      // TODO: Implement actual previous track logic
      logger.info("Going to previous track", {
        user: user.username,
        guild: interaction.guild?.name,
      });

      // Simulate getting previous track info
      const previousTrackInfo = {
        title: "Previous Track Title",
        duration: 210,
        uploader: "Previous Uploader",
        thumbnail: null,
        videoId: "BV0987654321",
      };

      const nowPlayingEmbed = EmbedBuilders.createNowPlayingEmbed(
        previousTrackInfo,
        {
          requestedBy: user.displayName || user.username,
          queuePosition: 1,
          totalQueue: 3,
          loopMode: "queue", // Fix: Add missing loopMode parameter (simulated for now)
        }
      );

      const controlButtons = ButtonBuilders.createPlaybackControls({
        isPlaying: true,
        hasQueue: true,
        canGoBack: false,
        canSkip: true,
      });

      await interaction.reply({
        embeds: [nowPlayingEmbed],
        components: [controlButtons],
      });

      logger.info("Previous command executed successfully", {
        user: user.username,
        wentBackTo: previousTrackInfo.title,
      });
    } catch (error) {
      logger.error("Previous command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Previous Failed",
        "Failed to go back to the previous track.",
        {
          errorCode: "PREV_FAILED",
        }
      );

      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  },
};
