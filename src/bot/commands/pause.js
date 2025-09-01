/**
 * Pause Command
 * Pauses the currently playing audio
 */

const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const AudioManager = require("../../audio/manager");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause the currently playing audio"),

  cooldown: 2,

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

      // Use audio manager to pause playback
      const result = AudioManager.pausePlayback(interaction.guild.id);

      if (!result.success) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Pause Failed",
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

      const successEmbed = EmbedBuilders.createSuccessEmbed(
        "Paused",
        "⏸️ Audio playback has been paused."
      );

      // Update control buttons to show current state
      const controlButtons = ButtonBuilders.createPlaybackControls({
        isPlaying: result.player.isPlaying,
        hasQueue: result.player.queueLength > 0,
        canGoBack: result.player.hasPrevious,
        canSkip: result.player.hasNext,
      });

      await interaction.reply({
        embeds: [successEmbed],
        components: [controlButtons],
      });

      logger.info("Pause command executed successfully", {
        user: user.username,
      });
    } catch (error) {
      logger.error("Pause command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Pause Failed",
        "Failed to pause audio playback.",
        {
          errorCode: "PAUSE_FAILED",
        }
      );

      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  },
};
