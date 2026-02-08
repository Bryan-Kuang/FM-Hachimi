/**
 * Hachimi Command
 * Automatically plays Bilibili videos with "哈基米" tag that meet specific criteria
 */

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const AudioManager = require("../../audio/manager");
const PlaylistManager = require("../../playlist/playlist_manager");
const InterfaceUpdater = require("../../ui/interface_updater");
const EmbedBuilders = require("../../ui/embeds");
const logger = require("../../services/logger_service");

// Configuration Constants
/**
 * Maximum number of videos to add in a single batch
 * Recommended range: 1-10 to prevent timeouts and rate limits
 */
const MAX_VIDEO_BATCH_SIZE = 5;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("hachimi")
    .setDescription(
      `Auto-play ${MAX_VIDEO_BATCH_SIZE} Bilibili videos with 哈基米 tag that meet quality criteria`
    ),

  cooldown: 30, // 30 seconds cooldown to prevent spam

  async execute(interaction) {
    try {
      const user = interaction.user;
      const member = interaction.member;

      // Check if user is in a voice channel
      if (!member.voice.channel) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Voice Channel Required",
          "You need to be in a voice channel to use Hachimi feature!",
          {
            suggestion: "Join a voice channel and try again.",
          }
        );

        return await interaction.reply({
          embeds: [errorEmbed],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Check if bot is in a voice channel and if it's different from user's
      const botVoiceChannel = interaction.guild.members.me?.voice?.channel;
      if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Different Voice Channel",
          "I'm already playing music in a different voice channel!",
          {
            suggestion: `Join ${botVoiceChannel.name} or wait for the current session to end.`,
          }
        );

        return await interaction.reply({
          embeds: [errorEmbed],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Bind playback UI context to current channel and defer reply to avoid timeout
      InterfaceUpdater.setPlaybackContext(
        interaction.guild.id,
        interaction.channelId
      );
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const loadingEmbed = EmbedBuilders.createLoadingEmbed(
        "🔍 Searching for Hachimi videos that meet quality criteria..."
      );
      await interaction.editReply({ embeds: [loadingEmbed] });

      // Get audio manager instance
      const audioManager = AudioManager; // Fix: use exported singleton instead of getInstance()

      // Clear current queue
      const player = audioManager.getPlayer(interaction.guild.id);
      if (player) {
        player.clearQueue();
        logger.info("Queue cleared for Hachimi feature", {
          guild: interaction.guild.id,
          user: user.username,
        });
      }

      await this.searchAndAddHachimiVideos(
        interaction,
        audioManager,
        user.username
      );
    } catch (error) {
      logger.error("Error in hachimi command", {
        error: error.message,
        stack: error.stack,
        guild: interaction.guild?.id,
        user: interaction.user?.username,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Hachimi Feature Error",
        "Failed to search for Hachimi videos. Please try again later.",
        {
          suggestion: "If the problem persists, contact the bot administrator.",
        }
      );

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      }
    }
  },

  /**
   * Search for Hachimi videos and add them to queue
   * @param {Object} interaction - Discord interaction object
   * @param {Object} audioManager - Audio manager instance
   * @param {string} username - Username who triggered the command
   */
  async searchAndAddHachimiVideos(interaction, audioManager, username) {
    try {
      const bilibiliApi = require("../../utils/bilibiliApi");

      // Validate batch size
      const safeBatchSize = Math.min(Math.max(1, MAX_VIDEO_BATCH_SIZE), 20); // Clamp between 1 and 20

      if (MAX_VIDEO_BATCH_SIZE > 20) {
        logger.warn(
          `Configured MAX_VIDEO_BATCH_SIZE (${MAX_VIDEO_BATCH_SIZE}) exceeds safety limit of 20. Capped to ${safeBatchSize}.`
        );
      }

      // Search for qualified Hachimi videos (randomized with history filtering)
      const qualifiedVideos = await bilibiliApi.searchHachimiVideos(
        safeBatchSize,
        interaction.guild.id
      );

      // Ensure extractor is available for audio URL resolution
      const extractor =
        typeof audioManager.getExtractor === "function"
          ? audioManager.getExtractor()
          : audioManager.extractor;
      if (!extractor) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Extractor Not Ready",
          "Audio extractor is not initialized. Please wait a moment and try again.",
          { suggestion: "Restart the bot or try again later." }
        );
        return await interaction.editReply({ embeds: [errorEmbed] });
      }

      if (qualifiedVideos.length === 0) {
        const noResultsEmbed = EmbedBuilders.createErrorEmbed(
          "No Qualified Videos Found",
          "No Hachimi videos currently meet the quality criteria.",
          {
            suggestion: "Quality criteria: Like Rate > 5% OR Views > 10,000",
          }
        );

        return await interaction.editReply({ embeds: [noResultsEmbed] });
      }

      // Get or create player for this guild
      let player = audioManager.getPlayer(interaction.guild.id);

      // Join voice channel if not already connected
      if (
        !player.voiceConnection ||
        player.voiceConnection.joinConfig.channelId !==
          interaction.member.voice.channel.id
      ) {
        const joinSuccess = await player.joinVoiceChannel(
          interaction.member.voice.channel
        );
        if (!joinSuccess) {
          const errorEmbed = EmbedBuilders.createErrorEmbed(
            "Voice Channel Error",
            "Failed to join voice channel.",
            {
              suggestion:
                "Make sure the bot has permission to join and speak in the voice channel.",
            }
          );
          return await interaction.editReply({ embeds: [errorEmbed] });
        }
      }

      player.clearQueue();

      // Add qualified videos to queue
      let addedCount = 0;
      const failedVideos = [];
      let nowPlayingSent = false;

      for (const video of qualifiedVideos) {
        try {
          const _track = await PlaylistManager.add(
            interaction.guild.id,
            video.url,
            username
          );
          addedCount++;

          if (addedCount === 1 && !player.isPlaying && !player.isPaused) {
            try {
              const PlayerControl = require("../../control/player_control");
              await PlayerControl.play(interaction.guild.id);
              nowPlayingSent = true;
            } catch (err) {
              logger.warn("Failed to start playback on first Hachimi track", {
                error: err.message,
              });
            }
          }
        } catch (error) {
          logger.warn("Failed to add Hachimi video to queue", {
            title: video.title,
            bvid: video.bvid,
            error: error.message,
          });
          failedVideos.push(video.title);
        }
      }

      // Ensure UI reflects latest state if no state transition occurred
      try {
        const PlayerControl = require("../../control/player_control");
        PlayerControl.notifyState(interaction.guild.id);
      } catch (e) {
        logger.warn("Notify state after hachimi add failed", {
          error: e.message,
        });
      }

      // Create success embed
      const successEmbed = EmbedBuilders.createSuccessEmbed(
        "🎵 Hachimi Playlist Ready!",
        `Successfully added ${addedCount} qualified Hachimi videos to the queue.`
      );

      // Append details fields explicitly
      successEmbed.addFields(
        {
          name: "📊 Quality Criteria Applied",
          value: "• Like Rate > 5%\n• OR Views > 10,000",
          inline: false,
        },
        {
          name: "🎯 Results",
          value: `✅ Added: ${addedCount} videos\n${
            failedVideos.length > 0
              ? `❌ Failed: ${failedVideos.length} videos`
              : ""
          }`,
          inline: true,
        }
      );

      if (failedVideos.length > 0 && failedVideos.length <= 3) {
        successEmbed.addFields({
          name: "⚠️ Failed Videos",
          value: failedVideos.join("\n"),
          inline: false,
        });
      }

      // If candidates exhausted by history and soft fallback applied, append footer hint
      // Note: actual soft fallback detection occurs in API; here we add UI hint when addedCount > 0 but qualifiedVideos.length < safeBatchSize
      if (addedCount > 0 && qualifiedVideos.length < safeBatchSize) {
        successEmbed.setFooter({
          text: "(候选池已耗尽，随机回溯历史记录)",
          iconURL: "https://cdn.discordapp.com/emojis/741605543046807626.png",
        });
      }

      const capNote =
        typeof MAX_VIDEO_BATCH_SIZE === "number" &&
        MAX_VIDEO_BATCH_SIZE > safeBatchSize
          ? `（已按批量上限 ${safeBatchSize} 截断）`
          : "";
      await interaction.editReply({
        content: `Added ${addedCount} videos${
          failedVideos.length > 0 ? `, failed ${failedVideos.length}` : ""
        } ${capNote}`.trim(),
      });

      // Start playing if not already playing
      if (!player.isPlaying && !player.isPaused) {
        const PlayerControl = require("../../control/player_control");
        await PlayerControl.play(interaction.guild.id);
      }

      // Post Now Playing UI and start progress tracking
      if (player.currentTrack && !nowPlayingSent) {
        try {
          const PlayerControl = require("../../control/player_control");
          PlayerControl.notifyState(interaction.guild.id);
        } catch (e) {
          logger.warn("Notify state failed after nowPlaying check", {
            error: e.message,
          });
        }
      }

      logger.info("Hachimi playlist created successfully", {
        guild: interaction.guild.id,
        user: username,
        addedCount,
        failedCount: failedVideos.length,
      });
    } catch (error) {
      logger.error("Error searching Hachimi videos", {
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  },
};
