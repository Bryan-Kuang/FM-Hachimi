/**
 * Play Command
 * Plays audio from a Bilibili video URL or keyword search
 */

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const UrlValidator = require("../../bilibili/validator");
const logger = require("../../services/logger_service");

module.exports = function createPlayCommand(playbackService) {
  return {
    data: new SlashCommandBuilder()
      .setName("play")
      .setDescription("Play audio from a Bilibili video URL or keyword")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("Bilibili video URL or search keyword")
          .setRequired(true)
      ),

    cooldown: 5, // 5 seconds cooldown

    async execute(interaction) {
      try {
        const query = interaction.options.getString("query") || interaction.options.getString("url");
        const user = interaction.user;
        const member = interaction.member;

        // Check if user is in a voice channel
        if (!member.voice.channel) {
          return await interaction.reply({
            content: "Voice channel required",
            flags: MessageFlags.Ephemeral,
          });
        }

        // Check if bot is in a voice channel and if it's different from user's
        const botVoiceChannel = interaction.guild.members.me?.voice?.channel;
        if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
          return await interaction.reply({
            content: `Bot is already playing in <#${botVoiceChannel.id}>`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // Defer reply immediately to prevent timeout
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Determine if input is a URL or keyword
        let url;
        if (UrlValidator.isValidBilibiliUrl(query)) {
          url = query;
        } else {
          // Keyword search — pick the first result
          await interaction.editReply({ content: `🔍 搜索 "${query}"...` });

          const bilibiliApi = require("../../bilibili/api");
          const results = await bilibiliApi.searchVideos(query, 1, 5);

          if (!results || results.length === 0) {
            return await interaction.editReply({
              content: `未找到 "${query}" 相关视频`,
            });
          }

          url = results[0].url;
          logger.info("Keyword search resolved to URL", {
            keyword: query,
            resolvedUrl: url,
            title: results[0].title,
          });
        }

        const player = playbackService.getPlayer(interaction.guild.id);
        const joined = await player.joinVoiceChannel(member.voice.channel);
        if (!joined) {
          return await interaction.editReply({
            content: "Failed to join voice",
          });
        }
        const track = await playbackService.addTrack(
          interaction.guild.id,
          url,
          user.displayName || user.username
        );
        if (!track) {
          return await interaction.editReply({
            content: "Add failed",
          });
        }
        playbackService.setUIContext(
          interaction.guild.id,
          interaction.channelId
        );
        if (!player.isPlaying && !player.isPaused) {
          await playbackService.play(interaction.guild.id);
        }
        await interaction.editReply({
          content: `🎵 已添加: ${track.title || url}`,
        });
        logger.info("Play command completed", {
          query,
          url,
          title: track.title,
          user: user.username,
        });
      } catch (error) {
        logger.error("Play command failed", {
          query: interaction.options.getString("query"),
          user: interaction.user.username,
          error: error.message,
          stack: error.stack,
        });

        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: "Play failed" });
          } else {
            await interaction.reply({ content: "Play failed", flags: MessageFlags.Ephemeral });
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
