/**
 * Play Command
 * Plays audio from a Bilibili video URL
 */

const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const UrlValidator = require("../../utils/validator");
const AudioManager = require("../../audio/manager");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play audio from a Bilibili video")
    .addStringOption((option) =>
      option
        .setName("url")
        .setDescription("Bilibili video URL")
        .setRequired(true)
    ),

  cooldown: 5, // 5 seconds cooldown

  async execute(interaction) {
    try {
      const url = interaction.options.getString("url");
      const user = interaction.user;
      const member = interaction.member;

      // Check if user is in a voice channel
      if (!member.voice.channel) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Voice Channel Required",
          "You need to be in a voice channel to play music!",
          {
            suggestion: "Join a voice channel and try again.",
          }
        );

        return await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      // Validate Bilibili URL
      if (!UrlValidator.isValidBilibiliUrl(url)) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Invalid URL",
          "Please provide a valid Bilibili video URL.",
          {
            suggestion:
              "Supported formats: bilibili.com/video/BV*, bilibili.com/video/av*, b23.tv/*, m.bilibili.com/video/*",
          }
        );

        return await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      // Show loading message
      const loadingEmbed = EmbedBuilders.createLoadingEmbed(
        "Extracting audio from Bilibili video..."
      );

      await interaction.reply({
        embeds: [loadingEmbed],
      });

      // Use audio manager to play the video
      const result = await AudioManager.playBilibiliVideo(interaction, url);

      if (!result.success) {
        throw new Error(result.error);
      }

      // Create success embed with video information
      const playingEmbed = EmbedBuilders.createNowPlayingEmbed(result.track, {
        requestedBy: user.displayName || user.username,
        queuePosition: result.player.currentIndex + 1,
        totalQueue: result.player.queueLength,
      });

      // Create control buttons based on current state
      const controlButtons = ButtonBuilders.createPlaybackControls({
        isPlaying: result.player.isPlaying,
        hasQueue: result.player.queueLength > 0,
        canGoBack: result.player.hasPrevious,
        canSkip: result.player.hasNext,
      });

      // Update the message with success
      await interaction.editReply({
        embeds: [playingEmbed],
        components: [controlButtons],
      });

      logger.info("Play command completed successfully", {
        url,
        title: result.track.title,
        user: user.username,
        queueLength: result.player.queueLength,
      });
    } catch (error) {
      logger.error("Play command failed", {
        url: interaction.options.getString("url"),
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Playback Failed",
        "Failed to extract or play audio from the provided URL.",
        {
          suggestion:
            "Please check the URL and try again. If the problem persists, the video might be private or region-locked.",
          errorCode: "EXTRACTION_FAILED",
        }
      );

      const retryButton = ButtonBuilders.createRetryButton("retry_play");

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({
            embeds: [errorEmbed],
            components: [retryButton],
          });
        } else {
          await interaction.reply({
            embeds: [errorEmbed],
            components: [retryButton],
            ephemeral: true,
          });
        }
      } catch (replyError) {
        logger.error("Failed to send error response", {
          error: replyError.message,
        });
      }
    }
  },
};
