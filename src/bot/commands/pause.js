/**
 * Pause Command
 * Pauses the currently playing audio
 */

const { SlashCommandBuilder } = require("discord.js");
const PlayerControl = require("../../control/player_control");
const InterfaceUpdater = require("../../ui/interface_updater");
const logger = require("../../services/logger_service");

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

      await interaction.reply({ content: "执行中...", ephemeral: true })
      InterfaceUpdater.setPlaybackContext(
        interaction.guild.id,
        interaction.channelId
      );
      const ok = PlayerControl.pause(interaction.guild.id);

      if (!ok) {
        return await interaction.editReply("暂停失败");
      }

      await interaction.editReply("⏸️ 已暂停");

      logger.info("Pause command executed successfully", {
        user: user.username,
      });
    } catch (error) {
      logger.error("Pause command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply("暂停失败")
      } else {
        await interaction.reply({ content: "暂停失败", ephemeral: true })
      }
    }
  },
};
