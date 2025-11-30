/**
 * Pause Command
 * Pauses the currently playing audio
 */

const { SlashCommandBuilder } = require("discord.js");
const PlayerControl = require("../../player_control");
const InterfaceUpdater = require("../../ui/interface_updater");
const logger = require("../../logger_service");

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
        return await interaction.reply({
          content: "Voice channel required",
          ephemeral: true,
        });
      }

      InterfaceUpdater.setPlaybackContext(
        interaction.guild.id,
        interaction.channelId
      );
      const ok = PlayerControl.pause(interaction.guild.id);

      if (!ok) {
        return await interaction.reply({
          content: "Pause failed",
          ephemeral: true,
        });
      }

      await interaction.reply({ content: "⏸️ Paused", ephemeral: true });

      logger.info("Pause command executed successfully", {
        user: user.username,
      });
    } catch (error) {
      logger.error("Pause command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      await interaction.reply({ content: "Pause failed", ephemeral: true });
    }
  },
};
