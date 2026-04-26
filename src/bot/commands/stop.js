/**
 * Stop Command
 * Stops playback, clears queue, and leaves voice channel
 */

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const logger = require("../../services/logger_service");

module.exports = function createStopCommand(playbackService) {
  return {
    data: new SlashCommandBuilder()
      .setName("stop")
      .setDescription("停止播放，清空队列并退出语音频道"),

    cooldown: 3, // 3 seconds cooldown

    async execute(interaction) {
      try {
        const user = interaction.user;
        const member = interaction.member;

        // Check if user is in a voice channel
        if (!member.voice.channel) {
          return await interaction.reply({
            content: "Voice channel required",
            flags: MessageFlags.Ephemeral,
          });
        }

        // Get audio player for this guild
        playbackService.setUIContext(
          interaction.guild.id,
          interaction.channelId
        );
        const player = playbackService.getPlayer(interaction.guild.id);

        // Check if there's anything playing or if the bot is connected
        if (
          !player.voiceConnection &&
          !player.isPlaying &&
          !player.isPaused &&
          player.queue.length === 0
        ) {
          return await interaction.reply({
            content: "Nothing to stop",
            flags: MessageFlags.Ephemeral,
          });
        }

        const stopped = await playbackService.stop(interaction.guild.id);

        if (!stopped) {
          return await interaction.reply({
            content: "Stop failed",
            flags: MessageFlags.Ephemeral,
          });
        }

        await interaction.reply({ content: "⏹️ Stopped", flags: MessageFlags.Ephemeral });

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
            await interaction.reply({ content: "Stop failed", flags: MessageFlags.Ephemeral });
          }
        } catch (replyError) {
          logger.error("Failed to send error response", {
            error: replyError.message,
          });
        }
      }
    },
  };
};
