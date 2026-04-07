/**
 * Bilibili Discord Bot - Main Entry Point
 * Composition root: all dependencies are instantiated here and wired together.
 */

const config = require("./config/config");
const BotClient = require("./bot/client");
const BilibiliExtractor = require("./bilibili/extractor");
const SessionManager = require("./session/session_manager");
const AudioManager = require("./session/audio_manager");
const InterfaceUpdater = require("./ui/interface_updater");
const ProgressTracker = require("./ui/progress_tracker");
const HistoryStore = require("./utils/history_store");
const PlaybackService = require("./services/playback_service");
const QueueService = require("./services/queue_service");
const logger = require("./services/logger_service");
const TokenPrecheck = require("./utils/token_precheck");
const Debug = require("./utils/debug");

class BilibiliDiscordBot {
  constructor() {
    this.botClient = null;
    this.sessionManager = null;
    this.isRunning = false;
  }

  /**
   * Initialize and start the bot
   */
  async start() {
    try {
      logger.info("Starting Bilibili Discord Bot");
      Debug.trace("start.begin");

      if (!config.discord.token) {
        throw new Error(
          "Discord token is not configured. Please set DISCORD_TOKEN in your environment."
        );
      }

      const tokenCheck = await TokenPrecheck.validate();
      if (!tokenCheck.valid) {
        logger.error("Discord token precheck failed", {
          reason: tokenCheck.reason,
        });
        Debug.error("token.precheck", new Error(tokenCheck.reason));
        throw new Error("Discord token invalid or not usable");
      }
      Debug.trace("token.precheck", { reason: tokenCheck.reason || "OK" });

      // --- Composition root: instantiate and wire all dependencies ---

      const sessionManager = new SessionManager();
      this.sessionManager = sessionManager;

      const extractor = new BilibiliExtractor();
      logger.info("Bilibili extractor initialized (will test on first use)");

      const audioManager = new AudioManager(sessionManager, extractor);
      const progressTracker = new ProgressTracker(sessionManager);
      const historyStore = new HistoryStore(sessionManager);
      const interfaceUpdater = new InterfaceUpdater(sessionManager, progressTracker, audioManager);

      // Inject historyStore into bilibiliApi singleton
      const bilibiliApi = require("./bilibili/api");
      bilibiliApi.setHistoryStore(historyStore);

      const playbackService = new PlaybackService({
        audioManager,
        interfaceUpdater,
        progressTracker,
        extractor,
        historyStore,
      });

      const queueService = new QueueService({ audioManager, extractor });
      Debug.trace("inject.dependencies");

      // Bot client
      logger.info("Initializing Discord bot client");
      Debug.trace("client.init");
      this.botClient = new BotClient(playbackService, queueService);
      this.botClient.setExtractor(extractor);

      // Initialize bot client (login, load commands, bind UI)
      await this.botClient.initialize(interfaceUpdater);
      Debug.trace("client.initialize.done");

      this.isRunning = true;
      logger.info("Bilibili Discord Bot started successfully");
      Debug.trace("start.success");

      // Log bot statistics
      const stats = this.botClient.getStats();
      logger.info("Bot statistics", stats);
    } catch (error) {
      logger.error("Failed to start Bilibili Discord Bot", {
        error: error.message,
        stack: error.stack,
      });
      Debug.error("start.failed", error);
      Debug.summary();

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

      // Cleanup all guild sessions (players, progress trackers, UI contexts)
      if (this.sessionManager) {
        this.sessionManager.cleanup();
      }

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
    error: error?.message || String(error),
    stack: error?.stack,
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
