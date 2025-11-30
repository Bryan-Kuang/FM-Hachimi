/**
 * Resume Command
 * Resumes the paused audio playback
 */

const { SlashCommandBuilder } = require("discord.js");
const PlayerControl = require("../../player_control");
const InterfaceUpdater = require("../../ui/interface_updater");
const logger = require("../../logger_service");

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
        return await interaction.reply({ content: "Voice channel required", ephemeral: true })
      }

      InterfaceUpdater.setPlaybackContext(interaction.guild.id, interaction.channelId)
      const ok = PlayerControl.resume(interaction.guild.id)

      if (!ok) {
        return await interaction.reply({ content: "Resume failed", ephemeral: true })
      }

      await interaction.reply({ content: "▶️ Resumed", ephemeral: true })

      logger.info("Resume command executed successfully", {
        user: user.username,
      });
    } catch (error) {
      logger.error("Resume command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      await interaction.reply({ content: "Resume failed", ephemeral: true })
    }
  },
};
