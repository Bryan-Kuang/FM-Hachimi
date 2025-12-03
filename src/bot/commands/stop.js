/**
 * Stop Command
 * Stops playback, clears queue, and leaves voice channel
 */

const { SlashCommandBuilder } = require("discord.js");
const PlayerControl = require("../../control/player_control");
const InterfaceUpdater = require("../../ui/interface_updater");
const logger = require("../../services/logger_service");

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
        return await interaction.reply({
          content: "Voice channel required",
          ephemeral: true,
        });
      }

      // Get audio player for this guild
      InterfaceUpdater.setPlaybackContext(
        interaction.guild.id,
        interaction.channelId
      );
      const player = require("../../audio/manager").getPlayer(
        interaction.guild.id
      );

      // Check if there's anything playing or if the bot is connected
      if (
        !player.voiceConnection &&
        !player.isPlaying &&
        !player.isPaused &&
        player.queue.length === 0
      ) {
        return await interaction.reply({
          content: "Nothing to stop",
          ephemeral: true,
        });
      }

      const stopped = await PlayerControl.stop(interaction.guild.id);

      if (!stopped) {
        return await interaction.reply({
          content: "Stop failed",
          ephemeral: true,
        });
      }

      await interaction.reply({ content: "⏹️ Stopped", ephemeral: true });

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

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: "Stop failed" });
        } else {
          await interaction.reply({ content: "Stop failed", ephemeral: true });
        }
      } catch (replyError) {
        logger.error("Failed to send error response", {
          error: replyError.message,
        });
      }
    }
  },
};
