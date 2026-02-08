/**
 * Previous Command
 * Goes back to the previous track in the queue
 */

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const PlayerControl = require("../../control/player_control");
const InterfaceUpdater = require("../../ui/interface_updater");
const logger = require("../../services/logger_service");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("prev")
    .setDescription("Go back to the previous track in the queue"),

  cooldown: 3,

  async execute(interaction) {
    try {
      const member = interaction.member;
      const user = interaction.user;

      // Check if user is in a voice channel
      if (!member.voice.channel) {
        return await interaction.reply({
          content: "Voice channel required",
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.reply({ content: "执行中...", flags: MessageFlags.Ephemeral })
      InterfaceUpdater.setPlaybackContext(
        interaction.guild.id,
        interaction.channelId
      );
      const ok = await PlayerControl.prev(interaction.guild.id);
      if (!ok) {
        return await interaction.editReply("没有上一首");
      }
      await interaction.editReply("⏮️ 已返回上一首");

      logger.info("Previous command executed successfully", {
        user: user.username,
      });
    } catch (error) {
      logger.error("Previous command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply("上一首失败");
      } else {
        await interaction.reply({ content: "上一首失败", flags: MessageFlags.Ephemeral });
      }
    }
  },
};
