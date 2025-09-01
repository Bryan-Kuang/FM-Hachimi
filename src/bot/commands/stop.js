/**
 * Stop Command
 * Stops playback, clears queue, and leaves voice channel
 */

const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilders = require("../../ui/embeds");
const AudioManager = require("../../audio/manager");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback, clear queue, and leave voice channel"),

  cooldown: 3, // 3 seconds cooldown

  async execute(interaction) {
    try {
      const user = interaction.user;
      const member = interaction.member;

      // Check if user is in a voice channel
      if (!member.voice.channel) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Voice Channel Required",
          "You need to be in a voice channel to stop playback!",
          {
            suggestion: "Join the voice channel where music is playing.",
          }
        );

        return await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      // Get audio player for this guild
      const player = AudioManager.getPlayer(interaction.guild.id);

      // Check if there's anything playing
      if (!player.isPlaying && !player.isPaused && player.queue.length === 0) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Nothing to Stop",
          "There's nothing currently playing or in the queue.",
          {
            suggestion: "Use `/play` to start playing music first.",
          }
        );

        return await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      // Stop playback
      const stopped = await player.stop();

      if (!stopped) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Stop Failed",
          "Failed to stop playback. Please try again.",
          {
            suggestion: "Check if the bot has proper permissions.",
          }
        );

        return await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      // Create success embed
      const successEmbed = EmbedBuilders.createSuccessEmbed(
        "⏹️ Playback Stopped",
        "Music stopped, queue cleared, and left voice channel."
      );

      await interaction.reply({
        embeds: [successEmbed],
      });

      logger.info("Stop command executed successfully", {
        user: user.username,
        guild: interaction.guild.name,
      });
    } catch (error) {
      logger.error("Stop command failed", {
        user: interaction.user.username,
        guild: interaction.guild?.name,
        error: error.message,
        stack: error.stack,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Stop Failed",
        "An error occurred while stopping playback.",
        {
          suggestion:
            "Please try again. If the problem persists, restart the bot.",
        }
      );

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({
            embeds: [errorEmbed],
          });
        } else {
          await interaction.reply({
            embeds: [errorEmbed],
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

