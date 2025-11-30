/**
 * Now Playing Command
 * Shows information about the currently playing track
 */

const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const logger = require("../../services/logger_service");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show information about the currently playing track"),

  cooldown: 3,

  async execute(interaction) {
    try {
      const user = interaction.user;

      // TODO: Get actual currently playing track from audio manager
      // For now, simulate current track
      const isPlaying = true; // This will be replaced with actual player state

      if (!isPlaying) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Nothing Playing",
          "There is no track currently playing.",
          {
            suggestion: "Use `/play` to start playing a Bilibili video.",
          }
        );

        return await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      // Simulate current track data
      const currentTrack = {
        title:
          "韩红-一个人 伴奏 高音质纯伴奏高品每天爱你多一些 长宇 晨悠组合 无损伴奏",
        duration: 240,
        uploader: "AC影音WWW",
        thumbnail:
          "http://i2.hdslb.com/bfs/archive/48f55bbdd4abe8b157242056bcc344e0346ebe6d.jpg",
        videoId: "BV1uv4y1q7Mv",
        uploadDateFormatted: "2023-01-04",
      };

      const currentTime = 72; // 1:12 into the track
      const requestedBy = "TestUser";

      // Create now playing embed
      const nowPlayingEmbed = EmbedBuilders.createNowPlayingEmbed(
        currentTrack,
        {
          currentTime,
          requestedBy,
          queuePosition: 1,
          totalQueue: 3,
          loopMode: "queue", // Fix: Add missing loopMode parameter (simulated for now)
        }
      );

      // Create control buttons
      const controlButtons = ButtonBuilders.createPlaybackControls({
      isPlaying: true,
      hasQueue: true,
      canGoBack: false,
      canSkip: true,
      loopMode: "queue",
    });

    await interaction.reply({
      embeds: [nowPlayingEmbed],
      components: controlButtons, // Now returns array of ActionRowBuilders
    });

      logger.info("Now playing command executed successfully", {
        user: user.username,
        currentTrack: currentTrack.title,
        currentTime,
      });
    } catch (error) {
      logger.error("Now playing command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Display Failed",
        "Failed to display currently playing track information.",
        {
          errorCode: "NOWPLAYING_FAILED",
        }
      );

      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  },
};
