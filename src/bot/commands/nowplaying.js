/**
 * Now Playing Command
 * Shows information about the currently playing track
 */

const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const AudioManager = require("../../audio/manager");
const logger = require("../../services/logger_service");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show information about the currently playing track"),

  cooldown: 3,

  async execute(interaction) {
    try {
      const user = interaction.user;
      const guildId = interaction.guild.id;
      const player = AudioManager.getPlayer(guildId);
      const state = player.getState();
      const currentTrack = state.currentTrack;

      if (!state.isPlaying && !state.isPaused && !currentTrack) {
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

      const currentTime = player.getCurrentTime();
      const requestedBy = currentTrack.user || "Unknown";

      // Create now playing embed
      const nowPlayingEmbed = EmbedBuilders.createNowPlayingEmbed(
        currentTrack,
        {
          currentTime,
          requestedBy,
          queuePosition: state.currentIndex + 1,
          totalQueue: state.queueLength,
          loopMode: state.loopMode,
        }
      );

      // Create control buttons
      const controlButtons = ButtonBuilders.createPlaybackControls({
        isPlaying: state.isPlaying,
        hasQueue: state.queueLength > 0,
        canGoBack: state.hasPrevious,
        canSkip: state.hasNext,
        loopMode: state.loopMode,
      });

      await interaction.reply({
        embeds: [nowPlayingEmbed],
        components: controlButtons,
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
