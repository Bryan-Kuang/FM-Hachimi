/**
 * Play Command
 * Plays audio from a Bilibili video URL
 */

const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const UrlValidator = require("../../utils/validator");
const AudioManager = require("../../audio/manager");
const Formatters = require("../../utils/formatters");
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

      // Check if bot is in a voice channel and if it's different from user's
      const botVoiceChannel = interaction.guild.members.me?.voice?.channel;
      if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Wrong Voice Channel",
          `Bot is already playing in <#${botVoiceChannel.id}>!`,
          {
            suggestion:
              "Join the same voice channel as the bot or use `/stop` to stop current playback.",
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

      // 🔧 修复：使用deferReply避免Discord超时
      await interaction.deferReply();

      // Use audio manager to play the video
      const result = await AudioManager.playBilibiliVideo(interaction, url);

      if (!result.success) {
        // Create detailed error embed
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Playback Failed",
          result.error,
          {
            suggestion: result.suggestion,
            errorCode: "PLAYBACK_FAILED",
          }
        );

        // If we have track info and should keep connection, show partial success
        if (result.keepConnection && result.track) {
          // Create a "partial success" embed showing the track was added but playback failed
          const partialEmbed = EmbedBuilders.createErrorEmbed(
            "Track Added but Playback Failed",
            `Added "${result.track.title}" to queue, but playback failed.`,
            {
              suggestion: result.suggestion,
            }
          );

          // Add track info
          partialEmbed.addFields(
            {
              name: "🎵 Track Info",
              value: `**Title:** ${
                result.track.title
              }\n**Duration:** ${Formatters.formatTime(
                result.track.duration
              )}\n**Uploader:** ${result.track.uploader}`,
              inline: false,
            },
            {
              name: "🔧 Bot Status",
              value: `Connected to voice channel\nQueue length: ${result.player.queueLength}`,
              inline: true,
            }
          );

          const retryButton =
            ButtonBuilders.createRetryButton("retry_playback");

          await interaction.editReply({
            embeds: [partialEmbed],
            components: [retryButton],
          });

          return;
        }

        // Complete failure
        const retryButton = ButtonBuilders.createRetryButton("retry_play");

        await interaction.editReply({
          embeds: [errorEmbed],
          components: [retryButton],
        });

        return;
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
        loopMode: result.player.loopMode,
      });

      // Update the message with success
      const reply = await interaction.editReply({
        embeds: [playingEmbed],
        components: [controlButtons], // Wrap single ActionRowBuilder in array
      });

      // Start progress tracking for real-time updates
      const ProgressTracker = require("../../audio/progress-tracker");
      ProgressTracker.startTracking(interaction.guild.id, reply);

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
