/**
 * Skip Command
 * Skips to the next track in the queue
 */

const { SlashCommandBuilder } = require("discord.js");
const PlayerControl = require("../../control/player_control");
const InterfaceUpdater = require("../../ui/interface_updater");
const logger = require("../../services/logger_service");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip to the next track in the queue"),

  cooldown: 3,

  async execute(interaction) {
    try {
      const member = interaction.member;
      const user = interaction.user;

      // Check if user is in a voice channel
      if (!member.voice.channel) {
        return await interaction.reply({ content: "Voice channel required", ephemeral: true })
      }

      await interaction.reply({ content: "执行中...", ephemeral: true })
      InterfaceUpdater.setPlaybackContext(interaction.guild.id, interaction.channelId)
      const ok = await PlayerControl.next(interaction.guild.id)
      if (!ok) {
        return await interaction.editReply("没有下一首")
      }
      await interaction.editReply("⏭️ 已跳过")

      logger.info("Skip command executed successfully", {
        user: user.username
      });
    } catch (error) {
      logger.error("Skip command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply("Skip failed")
      } else {
        await interaction.reply({ content: "Skip failed", ephemeral: true })
      }
    }
  },
};
