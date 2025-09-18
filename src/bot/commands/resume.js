/**
 * Resume Command
 * Resumes the paused audio playback
 */

const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const AudioManager = require("../../audio/manager");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume the paused audio playback"),

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

      // Use audio manager to resume playback
      const result = AudioManager.resumePlayback(interaction.guild.id);

      if (!result.success) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Resume Failed",
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
        "Resumed",
        "▶️ Audio playback has been resumed."
      );

      // Update control buttons to show current state
      const controlButtons = ButtonBuilders.createPlaybackControls({
        isPlaying: result.player.isPlaying,
        hasQueue: result.player.queueLength > 0,
        canGoBack: result.player.hasPrevious,
        canSkip: result.player.hasNext,
        loopMode: result.player.loopMode,
      });

      await interaction.reply({
        embeds: [resumeEmbed],
        components: controlButtons, // Now returns array of ActionRowBuilders
      });

      logger.info("Resume command executed successfully", {
        user: user.username,
      });
    } catch (error) {
      logger.error("Resume command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Resume Failed",
        "Failed to resume audio playback.",
        {
          errorCode: "RESUME_FAILED",
        }
      );

      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  },
};
