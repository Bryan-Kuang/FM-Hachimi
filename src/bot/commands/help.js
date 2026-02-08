/**
 * Help Command - Display all available commands
 * Shows a list of all bot commands with descriptions
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const logger = require("../../services/logger_service");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("显示所有可用的命令"),

  async execute(interaction) {
    try {
      logger.info("Help command executed", {
        user: interaction.user.username,
        guild: interaction.guild?.name,
      });

      // Create help embed
      const helpEmbed = new EmbedBuilder()
        .setColor(0x00d4ff)
        .setTitle("🎵 Bilibili音乐机器人 - 命令帮助")
        .setDescription("以下是所有可用的命令：")
        .addFields(
          {
            name: "🎵 播放命令",
            value: "`/play <URL>` - 播放Bilibili视频音频\n`/pause` - 暂停当前播放\n`/resume` - 恢复播放\n`/stop` - 停止播放并清空队列",
            inline: false,
          },
          {
            name: "⏭️ 控制命令",
            value: "`/skip` - 跳过当前歌曲\n`/prev` - 播放上一首歌曲",
            inline: false,
          },
          {
            name: "📋 队列命令",
            value: "`/queue` - 查看当前播放队列\n`/nowplaying` - 查看当前播放的歌曲信息",
            inline: false,
          },
          {
            name: "ℹ️ 其他命令",
            value: "`/help` - 显示此帮助信息",
            inline: false,
          }
        )
        .setFooter({
          text: "💡 提示：使用按钮控制播放更方便！",
        })
        .setTimestamp();

      await interaction.reply({
        embeds: [helpEmbed],
        flags: MessageFlags.Ephemeral, // 只有命令执行者能看到
      });

      logger.info("Help command completed successfully", {
        user: interaction.user.username,
      });
    } catch (error) {
      logger.error("Help command failed", {
        error: error.message,
        stack: error.stack,
        user: interaction.user.username,
      });

      const errorMessage = "显示帮助信息时出现错误，请稍后重试。";

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: `❌ ${errorMessage}`,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: `❌ ${errorMessage}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};
