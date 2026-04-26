/**
 * Pause Command
 * Pauses the currently playing audio
 */

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const logger = require("../../services/logger_service");

module.exports = function createPauseCommand(playbackService) {
  return {
    data: new SlashCommandBuilder()
      .setName("pause")
      .setDescription("暂停当前播放"),

    cooldown: 2,

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
        playbackService.setUIContext(
          interaction.guild.id,
          interaction.channelId
        );
        const ok = playbackService.pause(interaction.guild.id);

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
          await interaction.reply({ content: "暂停失败", flags: MessageFlags.Ephemeral })
        }
      }
    },
  };
};
