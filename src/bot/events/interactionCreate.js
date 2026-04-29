/**
 * Interaction Create Event Handler
 * Handles button interactions for audio controls
 */

const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const logger = require("../../services/logger_service");
const Lock = require("../../utils/lock");
const { MessageFlags } = require("discord.js");

module.exports = function createInteractionHandler(playbackService, queueService) {
  return {
    name: "interactionCreate",

    async execute(interaction) {
      // Handle button interactions
      if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
      }

      // Handle select menu interactions
      if (interaction.isStringSelectMenu()) {
        await handleSelectMenuInteraction(interaction);
      }
    },
  };

  /**
   * Handle button interactions with immediate defer reply to avoid timeout
   * @param {ButtonInteraction} interaction - Discord button interaction
   */
  async function handleButtonInteraction(interaction) {
    try {
      const customId = interaction.customId;
      const user = interaction.user;

      logger.debug("Button interaction received", {
        customId,
        user: user.username,
        guild: interaction.guild?.name,
      });

      // Immediately defer to beat Discord's 3-second timeout.
      // Control buttons use deferUpdate() so the original now-playing embed
      // is NOT replaced — any subsequent editReply() would overwrite it.
      // All other buttons use deferReply(ephemeral) so their responses
      // (queue list, loop confirmation, etc.) are only visible to the presser
      // and never clobber the now-playing embed.
      const controlButtons = ["pause_resume", "skip", "prev", "stop"];
      const isControlButton = controlButtons.includes(customId);

      if (isControlButton) {
        await interaction.deferUpdate();
      } else {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }

      // Check if user is in a voice channel for control buttons.
      // Use followUp (not editReply) so the original embed stays intact.
      if (isControlButton) {
        if (!interaction.member.voice.channel) {
          return await interaction.followUp({
            content: "🔇 Join the voice channel where music is playing first.",
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      // daily_play_<bvid>: triggered from daily hachimi recommendation cards
      // deferReply(ephemeral) was already called above (not a control button)
      if (customId.startsWith("daily_play_")) {
        if (!interaction.member.voice.channel) {
          return await interaction.editReply({
            content: "🔇 请先加入一个语音频道再点击聆听。",
          });
        }

        const bvid = customId.slice("daily_play_".length);
        if (!bvid) {
          return await interaction.editReply({ content: "❌ 无效的视频 ID。" });
        }

        const videoUrl = `https://www.bilibili.com/video/${bvid}`;

        // Tell InterfaceUpdater which channel to post the Now Playing embed in,
        // then play. Without setUIContext the embed has nowhere to go.
        playbackService.setUIContext(interaction.guild.id, interaction.channelId);
        const result = await playbackService.playBilibiliVideo(interaction, videoUrl);

        if (!result || !result.success) {
          return await interaction.editReply({
            content: `❌ 无法播放视频：${result?.error || "未知错误"}`,
          });
        }

        await interaction.editReply({ content: "✅ 已加入队列！" });

        // Fire the Now Playing UI (same as playbackService.play() does internally).
        playbackService.notifyState(interaction.guild.id);
        return;
      }

      // Route control buttons through PlaybackService
      if (["pause_resume", "skip", "prev", "stop"].includes(customId)) {
        playbackService.setUIContext(
          interaction.guild.id,
          interaction.channelId
        );
        const player = playbackService.getPlayer(interaction.guild.id);
        if (customId === "pause_resume") {
          if (player.isPlaying) {
            playbackService.pause(interaction.guild.id);
          } else if (player.isPaused) {
            playbackService.resume(interaction.guild.id);
          }
        } else if (customId === "skip") {
          await playbackService.skip(interaction.guild.id);
        } else if (customId === "prev") {
          await playbackService.previous(interaction.guild.id);
        } else if (customId === "stop") {
          await playbackService.stop(interaction.guild.id);
        }
        return;
      }

      // Non-control buttons: delegate to PlaybackService
      const result = await playbackService.handleButtonInteraction(interaction);

      if (!result.success && !result.showMenu) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Action Failed",
          result.error,
          {
            suggestion: result.suggestion,
          }
        );

        return await interaction.editReply({
          embeds: [errorEmbed],
        });
      }

      // Handle loop button menu display
      if (result.showMenu && customId === "loop") {
        logger.debug("Showing loop mode selection menu", {
          user: user.username,
          guild: interaction.guild?.name,
        });

        const {
          StringSelectMenuBuilder,
          ActionRowBuilder,
        } = require("discord.js");

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("loop_select")
          .setPlaceholder("Choose loop mode...")
          .addOptions([
            {
              label: "No Loop",
              description: "Play through queue once",
              value: "none",
              emoji: "➡️",
            },
            {
              label: "Loop Queue",
              description: "Repeat entire queue",
              value: "queue",
              emoji: "🔁",
            },
            {
              label: "Loop Single",
              description: "Repeat current track",
              value: "track",
              emoji: "🔂",
            },
          ]);

        const selectRow = new ActionRowBuilder().addComponents(selectMenu);

        return await interaction.editReply({
          content: "🔁 **Choose Loop Mode:**",
          components: [selectRow],
        });
      }

      // Create response based on button type
      let responseEmbed;
      let responseButtons;

      switch (customId) {
        case "queue": {
          const queueInfo = queueService.getQueue(interaction.guild.id);
          responseEmbed = EmbedBuilders.createQueueEmbed(queueInfo.queue, {
            currentTrack: queueInfo.currentTrack,
            page: 1,
            itemsPerPage: 10,
            totalPages: Math.ceil(queueInfo.state.queueLength / 10) || 1,
          });

          responseButtons = ButtonBuilders.createQueueControls({
            hasQueue: queueInfo.state.queueLength > 0,
            queueLength: queueInfo.state.queueLength,
            queue: queueInfo.queue,
            currentIndex: queueInfo.state.currentIndex,
          });
          break;
        }

        case "queue_clear": {
          responseEmbed = EmbedBuilders.createSuccessEmbed(
            "Queue Cleared",
            "🗑️ The queue has been cleared"
          );

          const queueInfo = queueService.getQueue(interaction.guild.id);
          responseButtons = ButtonBuilders.createQueueControls({
            hasQueue: result.player.queueLength > 0,
            queueLength: result.player.queueLength,
            queue: queueInfo.queue,
            currentIndex: queueInfo.state.currentIndex,
          });
          break;
        }

        case "queue_shuffle": {
          responseEmbed = EmbedBuilders.createSuccessEmbed(
            "Queue Shuffled",
            "🔀 The queue has been shuffled"
          );

          const queueInfoShuffle = queueService.getQueue(interaction.guild.id);
          responseButtons = ButtonBuilders.createQueueControls({
            hasQueue: result.player.queueLength > 0,
            queueLength: result.player.queueLength,
            queue: queueInfoShuffle.queue,
            currentIndex: queueInfoShuffle.state.currentIndex,
          });
          break;
        }

        case "queue_loop": {
          const loopMode = result.mode;
          const loopEmoji =
            loopMode === "none" ? "➡️" : loopMode === "queue" ? "🔁" : "🔂";
          const loopText =
            loopMode === "none"
              ? "disabled"
              : loopMode === "queue"
              ? "enabled (queue)"
              : "enabled (single)";

          responseEmbed = EmbedBuilders.createSuccessEmbed(
            "Loop Mode Changed",
            `${loopEmoji} Loop mode ${loopText}`
          );

          const queueInfoLoop = queueService.getQueue(interaction.guild.id);
          responseButtons = ButtonBuilders.createQueueControls({
            hasQueue: result.player.queueLength > 0,
            queueLength: result.player.queueLength,
            queue: queueInfoLoop.queue,
            currentIndex: queueInfoLoop.state.currentIndex,
          });
          break;
        }

        case "loop": {
          // This is handled above in the showMenu logic
          return;
        }

        case "queue_remove": {
          const queueInfo = queueService.getQueue(interaction.guild.id);

          if (!queueInfo.queue || queueInfo.queue.length === 0) {
            responseEmbed = EmbedBuilders.createErrorEmbed(
              "Queue Empty",
              "There are no tracks in the queue to remove."
            );
            break;
          }

          // Create and send select menu
          const selectMenu = ButtonBuilders.createQueueRemoveMenu({
            queue: queueInfo.queue,
            currentIndex: queueInfo.state.currentIndex,
          });

          responseEmbed = EmbedBuilders.createSuccessEmbed(
            "Select Track to Remove",
            "Choose a track from the dropdown menu below to remove it from the queue."
          );

          responseButtons = [selectMenu];
          break;
        }

        default: {
          responseEmbed = EmbedBuilders.createSuccessEmbed(
            "Action Completed",
            "✅ Action completed successfully"
          );
          break;
        }
      }

      // Send response
      const response = {
        embeds: [responseEmbed],
      };

      if (responseButtons) {
        response.components = responseButtons; // Now returns array of ActionRowBuilders
      }

      await interaction.editReply(response);

      logger.info("Button interaction handled successfully", {
        customId,
        user: user.username,
        guild: interaction.guild?.name,
      });
    } catch (error) {
      logger.error("Button interaction failed", {
        customId: interaction.customId,
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Interaction Failed",
        "An error occurred while processing your request.",
        {
          errorCode: "BUTTON_INTERACTION_FAILED",
        }
      );

      // Control buttons (pause/skip/prev/stop) used deferUpdate(), so editReply()
      // would overwrite the now-playing embed. Use followUp() instead to keep the
      // embed intact and send the error only to the button presser.
      const isCtrlButton = ["pause_resume", "skip", "prev", "stop"].includes(
        interaction.customId
      );

      try {
        if (interaction.replied || interaction.deferred) {
          if (isCtrlButton) {
            await interaction.followUp({
              embeds: [errorEmbed],
              flags: MessageFlags.Ephemeral,
            });
          } else {
            await interaction.editReply({
              embeds: [errorEmbed],
            });
          }
        } else {
          await interaction.reply({
            embeds: [errorEmbed],
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (replyError) {
        logger.error("Failed to send error response for button interaction", {
          error: replyError.message,
        });
      }
    }
  }

  /**
   * Handle select menu interactions
   * @param {StringSelectMenuInteraction} interaction - Discord select menu interaction
   */
  async function handleSelectMenuInteraction(interaction) {
    try {
      const customId = interaction.customId;
      const user = interaction.user;

      if (customId === "queue_remove_select") {
        if (Lock.shouldDebounce(interaction.guild.id, customId, 1000)) {
          await interaction.reply({ content: "操作过于频繁，请稍后重试", flags: MessageFlags.Ephemeral })
          return
        }
        if (!Lock.acquire(interaction.guild.id, customId)) {
          await interaction.reply({ content: "操作繁忙，请稍后重试", flags: MessageFlags.Ephemeral })
          return
        }
        const selectedValue = interaction.values[0];

        logger.debug("Queue remove select menu interaction received", {
          selectedValue,
          user: user.username,
          guild: interaction.guild?.name,
        });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let result;
        let responseEmbed;
        let responseButtons;

        if (selectedValue === "clear_all" || selectedValue === "remove_all") {
          result = { success: queueService.clearQueue(interaction.guild.id) };

          if (!result.success) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              "Clear Queue Failed",
              result.error || "Failed to clear the queue",
              {
                suggestion: result.suggestion || "Please try again.",
              }
            );

            return await interaction.editReply({
              embeds: [errorEmbed],
            });
          }

          responseEmbed = EmbedBuilders.createSuccessEmbed(
            "Queue Cleared",
            "🗑️ All tracks have been removed from the queue"
          );

          responseButtons = ButtonBuilders.createQueueControls({
            hasQueue: false,
            queueLength: 0,
            queue: [],
            currentIndex: -1,
          });
        } else {
          // Remove specific track by index
          // Extract index from "remove_X" format
          const indexMatch = selectedValue.match(/^remove_(\d+)$/);
          if (!indexMatch) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              "Invalid Selection",
              "Invalid track selection format",
              {
                suggestion: "Please try selecting a track again.",
              }
            );

            return await interaction.editReply({
              embeds: [errorEmbed],
            });
          }

          const index = parseInt(indexMatch[1]);
          const ok = queueService.removeTrack(interaction.guild.id, index);
          result = { success: ok };

          if (!result.success) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              "Remove Track Failed",
              result.error || "Failed to remove the track",
              {
                suggestion: result.suggestion || "Please try again.",
              }
            );

            return await interaction.editReply({
              embeds: [errorEmbed],
            });
          }

          responseEmbed = EmbedBuilders.createSuccessEmbed(
            "Track Removed",
            `🗑️ Track has been removed from the queue`
          );

          const queueInfo = queueService.getQueue(interaction.guild.id);
          responseButtons = ButtonBuilders.createQueueControls({
            hasQueue: queueInfo.queue.length > 0,
            queueLength: queueInfo.queue.length,
            queue: queueInfo.queue,
            currentIndex: queueInfo.state.currentIndex,
          });
        }

        Lock.release(interaction.guild.id, customId)

        // Update the original message with new queue info
        const queueInfo = queueService.getQueue(interaction.guild.id);
        const queueEmbed = EmbedBuilders.createQueueEmbed(queueInfo.queue, {
          currentTrack: queueInfo.currentTrack,
          page: 1,
          itemsPerPage: 10,
          totalPages: Math.ceil(queueInfo.state.queueLength / 10) || 1,
        });

        const response = {
          embeds: [queueEmbed],
        };

        if (responseButtons) {
          response.components = responseButtons;
        }

        // Update the original queue message
        await interaction.message.edit(response);

        // Send confirmation as ephemeral reply
        await interaction.editReply({
          embeds: [responseEmbed],
          flags: MessageFlags.Ephemeral,
        });

        logger.info("Track removed via select menu", {
          selectedValue,
          user: user.username,
          guild: interaction.guild?.name,
        });
      } else if (customId === "loop_select") {
        if (Lock.shouldDebounce(interaction.guild.id, customId, 1000)) {
          await interaction.reply({ content: "操作过于频繁，请稍后重试", flags: MessageFlags.Ephemeral })
          return
        }
        if (!Lock.acquire(interaction.guild.id, customId)) {
          await interaction.reply({ content: "操作繁忙，请稍后重试", flags: MessageFlags.Ephemeral })
          return
        }
        const selectedMode = interaction.values[0];

        logger.debug("Loop select menu interaction received", {
          selectedMode,
          user: user.username,
          guild: interaction.guild?.name,
        });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Handle loop mode change via QueueService
        const result = queueService.setLoopMode(
          interaction.guild.id,
          selectedMode
        );

        if (!result.success) {
          const errorEmbed = EmbedBuilders.createErrorEmbed(
            "Loop Mode Failed",
            result.error || "Failed to change loop mode",
            {
              suggestion: result.suggestion || "Please try again.",
            }
          );

          return await interaction.editReply({
            embeds: [errorEmbed],
          });
        }

        const loopEmoji =
          selectedMode === "none" ? "➡️" : selectedMode === "queue" ? "🔁" : "🔂";
        const loopText =
          selectedMode === "none"
            ? "disabled"
            : selectedMode === "queue"
            ? "enabled (queue)"
            : "enabled (single)";

        const successEmbed = EmbedBuilders.createSuccessEmbed(
          "Loop Mode Changed",
          `${loopEmoji} Loop mode ${loopText}`
        );

        await interaction.editReply({
          embeds: [successEmbed],
        });

        Lock.release(interaction.guild.id, customId)

        // Notify state to update the main playback card's loop button
        playbackService.notifyState(interaction.guild.id);

        logger.info("Loop mode changed via select menu", {
          mode: selectedMode,
          user: user.username,
          guild: interaction.guild?.name,
        });
      } else if (customId.startsWith("search_select_")) {
        const selectedValue = interaction.values[0];

        logger.debug("Search result select menu interaction received", {
          selectedValue,
          user: user.username,
          guild: interaction.guild?.name,
        });

        // Defer the reply immediately to avoid timeout
        await interaction.deferReply();

        // Extract the search results from the original message
        const originalEmbed = interaction.message.embeds[0];
        if (!originalEmbed || !originalEmbed.description) {
          const errorEmbed = EmbedBuilders.createErrorEmbed(
            "Search Results Not Found",
            "Could not find the original search results.",
            {
              suggestion: "Please perform a new search.",
            }
          );

          return await interaction.editReply({
            embeds: [errorEmbed],
          });
        }

        // Extract index from "search_result_X" format
        const indexMatch = selectedValue.match(/^search_result_(\d+)$/);
        if (!indexMatch) {
          const errorEmbed = EmbedBuilders.createErrorEmbed(
            "Invalid Selection",
            "Invalid search result selection format",
            {
              suggestion: "Please try selecting a result again.",
            }
          );

          return await interaction.editReply({
            embeds: [errorEmbed],
          });
        }

        const resultIndex = parseInt(indexMatch[1]);

        // Get the search keyword from custom ID
        const keyword = customId.replace("search_select_", "").replace(/_/g, " ");

        try {
          // Get the extractor and perform search again to get the selected video URL
          const extractor = playbackService.getExtractor();
          if (!extractor) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              "Extractor Not Available",
              "Bilibili extractor is not available.",
              {
                suggestion: "Please try again later.",
              }
            );

            return await interaction.editReply({
              embeds: [errorEmbed],
            });
          }

          // Search again to get the video data
          const searchResults = await extractor.searchVideos(keyword, 25);

          if (
            !searchResults.success ||
            !searchResults.results ||
            resultIndex >= searchResults.results.length
          ) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              "Video Not Found",
              "The selected video is no longer available.",
              {
                suggestion: "Please perform a new search.",
              }
            );

            return await interaction.editReply({
              embeds: [errorEmbed],
            });
          }

          const selectedVideo = searchResults.results[resultIndex];
          // Use the URL from the search result or construct av format URL
          const videoUrl =
            selectedVideo.url ||
            `https://www.bilibili.com/video/av${selectedVideo.id}`;

          // Add the video to the queue using playbackService
          const result = await playbackService.playBilibiliVideo(
            interaction,
            videoUrl
          );

          if (!result.success) {
            const errorEmbed = EmbedBuilders.createErrorEmbed(
              "Failed to Add Video",
              result.error || "Failed to add the selected video to queue.",
              {
                suggestion: result.suggestion || "Please try again.",
              }
            );

            return await interaction.editReply({
              embeds: [errorEmbed],
            });
          }

          const successEmbed = EmbedBuilders.createSuccessEmbed(
            "Video Added to Queue",
            `🎵 **${selectedVideo.title}** has been added to the queue`
          );

          await interaction.editReply({
            embeds: [successEmbed],
          });

          logger.info("Video added to queue from search results", {
            videoTitle: selectedVideo.title,
            videoId: selectedVideo.id,
            user: user.username,
            guild: interaction.guild?.name,
          });
        } catch (error) {
          logger.error("Failed to add video from search results", {
            error: error.message,
            stack: error.stack,
            user: user.username,
            guild: interaction.guild?.name,
          });

          const errorEmbed = EmbedBuilders.createErrorEmbed(
            "Error Adding Video",
            "An error occurred while adding the video to queue.",
            {
              suggestion: "Please try again.",
            }
          );

          await interaction.editReply({
            embeds: [errorEmbed],
          });
        }
      }
    } catch (error) {
      logger.error("Select menu interaction failed", {
        customId: interaction.customId,
        user: interaction.user.username,
        guild: interaction.guild?.name,
        error: error.message,
        stack: error.stack,
      });

      // Try to respond with error if possible
      try {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Interaction Failed",
          "An error occurred while processing your selection.",
          {
            errorCode: "SELECT_MENU_FAILED",
          }
        );

        if (interaction.deferred) {
          await interaction.editReply({
            embeds: [errorEmbed],
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            embeds: [errorEmbed],
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (replyError) {
        logger.error("Failed to send error response for select menu", {
          error: replyError.message,
        });
      }
    }
  }
};
