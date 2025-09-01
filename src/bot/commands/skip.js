/**
 * Skip Command
 * Skips to the next track in the queue
 */

const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip to the next track in the queue"),

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

      // TODO: Check if there's a next track in queue
      const hasNextTrack = false; // This will be replaced with actual queue state

      if (!hasNextTrack) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "No Next Track",
          "There are no more tracks in the queue to skip to.",
          {
            suggestion:
              "Add more tracks using `/play` or restart the current track.",
          }
        );

        return await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      // Skip to next track
      // TODO: Implement actual skip logic
      logger.info("Skipping to next track", {
        user: user.username,
        guild: interaction.guild?.name,
      });

      // Simulate getting next track info
      const nextTrackInfo = {
        title: "Next Track Title",
        duration: 180,
        uploader: "Next Uploader",
        thumbnail: null,
        videoId: "BV1234567890",
      };

      const nowPlayingEmbed = EmbedBuilders.createNowPlayingEmbed(
        nextTrackInfo,
        {
          requestedBy: user.displayName || user.username,
          queuePosition: 2,
          totalQueue: 3,
        }
      );

      const controlButtons = ButtonBuilders.createPlaybackControls({
        isPlaying: true,
        hasQueue: true,
        canGoBack: true,
        canSkip: true,
      });

      await interaction.reply({
        embeds: [nowPlayingEmbed],
        components: [controlButtons],
      });

      logger.info("Skip command executed successfully", {
        user: user.username,
        skippedTo: nextTrackInfo.title,
      });
    } catch (error) {
      logger.error("Skip command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Skip Failed",
        "Failed to skip to the next track.",
        {
          errorCode: "SKIP_FAILED",
        }
      );

      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  },
};
