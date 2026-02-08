/**
 * Resume Command
 * Resumes the paused audio playback
 */

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const PlayerControl = require("../../control/player_control");
const InterfaceUpdater = require("../../ui/interface_updater");
const logger = require("../../services/logger_service");

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
        return await interaction.reply({ content: "Voice channel required", flags: MessageFlags.Ephemeral })
      }

      await interaction.reply({ content: "执行中...", flags: MessageFlags.Ephemeral })
      InterfaceUpdater.setPlaybackContext(interaction.guild.id, interaction.channelId)
      const ok = PlayerControl.resume(interaction.guild.id)

      if (!ok) {
        return await interaction.editReply("恢复失败")
      }

      await interaction.editReply("▶️ 已恢复")

      logger.info("Resume command executed successfully", {
        user: user.username,
      });
    } catch (error) {
      logger.error("Resume command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply("恢复失败")
      } else {
        await interaction.reply({ content: "恢复失败", flags: MessageFlags.Ephemeral })
      }
    }
  },
};
