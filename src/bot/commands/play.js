/**
 * Play Command
 * Plays audio from a Bilibili video URL
 */

const { SlashCommandBuilder } = require("discord.js");
const UrlValidator = require("../../utils/validator");
const AudioManager = require("../../audio/manager");
const PlaylistManager = require("../../playlist_manager");
const PlayerControl = require("../../player_control");
const InterfaceUpdater = require("../../ui/interface_updater");
const logger = require("../../logger_service");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play audio from a Bilibili video")
    .addStringOption((option) =>
      option
        .setName("url")
        .setDescription("Bilibili video URL")
        .setRequired(true)
    ),

  cooldown: 5, // 5 seconds cooldown

  async execute(interaction) {
    try {
      const url = interaction.options.getString("url");
      const user = interaction.user;
      const member = interaction.member;

      // Check if user is in a voice channel
      if (!member.voice.channel) {
        return await interaction.reply({
          content: "Voice channel required",
          ephemeral: true,
        });
      }

      // Check if bot is in a voice channel and if it's different from user's
      const botVoiceChannel = interaction.guild.members.me?.voice?.channel;
      if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
        return await interaction.reply({
          content: `Bot is already playing in <#${botVoiceChannel.id}>`,
          ephemeral: true,
        });
      }

      // Validate Bilibili URL
      if (!UrlValidator.isValidBilibiliUrl(url)) {
        return await interaction.reply({
          content: "Invalid URL",
          ephemeral: true,
        });
      }

      const player = AudioManager.getPlayer(interaction.guild.id);
      const joined = await player.joinVoiceChannel(member.voice.channel);
      if (!joined) {
        return await interaction.reply({
          content: "Failed to join voice",
          ephemeral: true,
        });
      }
      const track = await PlaylistManager.add(
        interaction.guild.id,
        url,
        user.displayName || user.username
      );
      if (!track) {
        return await interaction.reply({
          content: "Add failed",
          ephemeral: true,
        });
      }
      InterfaceUpdater.setPlaybackContext(
        interaction.guild.id,
        interaction.channelId
      );
      if (!player.isPlaying && !player.isPaused) {
        await PlayerControl.play(interaction.guild.id);
      }
      PlayerControl.notifyState(interaction.guild.id);
      await interaction.reply({
        content: "🎵 Added and playing",
        ephemeral: true,
      });
      logger.info("Play command completed", {
        url,
        title: track.title,
        user: user.username,
      });
    } catch (error) {
      logger.error("Play command failed", {
        url: interaction.options.getString("url"),
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: "Play failed" });
        } else {
          await interaction.reply({ content: "Play failed", ephemeral: true });
        }
      } catch (replyError) {
        logger.error("Failed to send error response", {
          error: replyError.message,
        });
      }
    }
  },
};
