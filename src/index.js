/**
 * Bilibili Discord Bot - Main Entry Point
 * Initializes and starts the Discord bot with Bilibili audio streaming capabilities
 */

const BotClient = require("./bot/client");
const BilibiliExtractor = require("./audio/extractor");
const AudioManager = require("./audio/manager");
const logger = require("./utils/logger");
const config = require("./config/config");

class BilibiliDiscordBot {
  constructor() {
    this.botClient = null;
    this.extractor = null;
    this.isRunning = false;
  }

  /**
   * Initialize and start the bot
   */
  async start() {
    try {
      logger.info("Starting Bilibili Discord Bot");

      // Validate configuration
      if (!config.discord.token) {
        throw new Error(
          "Discord token is not configured. Please set DISCORD_TOKEN in your environment."
        );
      }

      // Initialize Bilibili extractor
      logger.info("Initializing Bilibili audio extractor");
      this.extractor = new BilibiliExtractor();

      // Test extractor availability
      const extractorTest = await this.extractor.testExtraction();
      if (!extractorTest.success) {
        logger.warn("Bilibili extractor test failed", {
          error: extractorTest.error,
          ytdlpAvailable: extractorTest.ytdlpAvailable,
        });

        if (!extractorTest.ytdlpAvailable) {
          throw new Error(
            "yt-dlp is not available. Please install it: pip install yt-dlp"
          );
        }
      } else {
        logger.info("Bilibili extractor is working correctly");
      }

      // Initialize Discord bot client
      logger.info("Initializing Discord bot client");
      this.botClient = new BotClient();

      // Attach extractor to bot client and audio manager
      this.botClient.setExtractor(this.extractor);
      AudioManager.setExtractor(this.extractor);

      // Initialize bot client
      await this.botClient.initialize();

      this.isRunning = true;
      logger.info("Bilibili Discord Bot started successfully");

      // Log bot statistics
      const stats = this.botClient.getStats();
      logger.info("Bot statistics", stats);
    } catch (error) {
      logger.error("Failed to start Bilibili Discord Bot", {
        error: error.message,
        stack: error.stack,
      });

      await this.shutdown();
      process.exit(1);
    }
  }

  /**
   * Gracefully shutdown the bot
   */
  async shutdown() {
    if (!this.isRunning) return;

    logger.info("Shutting down Bilibili Discord Bot");

    try {
      if (this.botClient) {
        await this.botClient.shutdown();
      }

      // Cleanup audio resources
      AudioManager.cleanup();

      this.isRunning = false;
      logger.info("Bot shutdown completed");
    } catch (error) {
      logger.error("Error during bot shutdown", {
        error: error.message,
      });
    }
  }

  /**
   * Get current bot status
   */
  getStatus() {
    return {
      running: this.isRunning,
      botStats: this.botClient ? this.botClient.getStats() : null,
      extractorAvailable: this.extractor !== null,
    };
  }
}

// Create bot instance
const bot = new BilibiliDiscordBot();

// Handle process signals for graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully");
  await bot.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully");
  await bot.shutdown();
  process.exit(0);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled promise rejection", {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise,
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {
    error: error.message,
    stack: error.stack,
  });

  // Attempt graceful shutdown
  bot.shutdown().finally(() => {
    process.exit(1);
  });
});

// Start the bot if this file is run directly
if (require.main === module) {
  bot.start().catch((error) => {
    logger.error("Failed to start bot", {
      error: error.message,
    });
    process.exit(1);
  });
}

module.exports = BilibiliDiscordBot;
