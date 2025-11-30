/**
 * Search Command
 * Search for Bilibili videos by keyword
 */

const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const AudioManager = require("../../audio/manager");
const logger = require("../../services/logger_service");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search for Bilibili videos by keyword")
    .addStringOption((option) =>
      option
        .setName("keyword")
        .setDescription("Search keyword")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("results")
        .setDescription("Number of results to show (1-10)")
        .setMinValue(1)
        .setMaxValue(10)
        .setRequired(false)
    ),

  cooldown: 10, // 10 seconds cooldown to prevent spam

  async execute(interaction) {
    try {
      const keyword = interaction.options.getString("keyword");
      const maxResults = interaction.options.getInteger("results") || 5;
      const user = interaction.user;

      logger.info("Search command executed", {
        keyword,
        maxResults,
        user: user.username,
        guild: interaction.guild?.name,
      });

      // Defer the reply as search might take some time
      await interaction.deferReply();

      // Get the extractor from AudioManager
      const extractor = AudioManager.getExtractor();
      if (!extractor) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "Search Failed",
          "Audio extractor is not available",
          {
            suggestion: "Please try again later.",
          }
        );

        return await interaction.editReply({
          embeds: [errorEmbed],
        });
      }

      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Search timeout: Operation took too long'));
        }, 30000); // 30 seconds timeout
      });

      // Create progress update
      const progressEmbed = EmbedBuilders.createLoadingEmbed(
        `Searching for "${keyword}"... This may take a moment.`
      );
      
      await interaction.editReply({
        embeds: [progressEmbed],
      });

      // Perform the search with timeout
      const searchResult = await Promise.race([
        extractor.searchVideos(keyword, maxResults),
        timeoutPromise
      ]);

      if (!searchResult.success || !searchResult.results || searchResult.results.length === 0) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          "No Results Found",
          `No videos found for "${keyword}"`,
          {
            suggestion: "Try different keywords or check your spelling.",
          }
        );

        return await interaction.editReply({
          embeds: [errorEmbed],
        });
      }

      // Create search results embed
      const searchEmbed = EmbedBuilders.createSearchResultsEmbed(
        searchResult.results,
        keyword
      );

      // Create search results selection menu
      const searchButtons = ButtonBuilders.createSearchResultsMenu(
        searchResult.results,
        keyword
      );

      const response = {
        embeds: [searchEmbed],
      };

      if (searchButtons) {
        response.components = [searchButtons];
      }

      await interaction.editReply(response);

      logger.info("Search command completed successfully", {
        keyword,
        resultCount: searchResult.results.length,
        user: user.username,
        guild: interaction.guild?.name,
      });
    } catch (error) {
      logger.error("Search command error", {
        error: error.message,
        stack: error.stack,
        user: interaction.user?.username,
        guild: interaction.guild?.name,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Search Error",
        "An error occurred while searching for videos",
        {
          suggestion: "Please try again with different keywords.",
          error: error.message,
        }
      );

      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed],
        });
      } else {
        await interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }
    }
  },
};
