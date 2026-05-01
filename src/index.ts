/**
 * Bilibili Discord Bot - Main Entry Point
 * Composition root: all dependencies are instantiated here and wired together.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { validateEnv } from './config/env_validator';
import BotClient = require('./bot/client');
import BilibiliExtractor = require('./bilibili/extractor');
import SessionManager = require('./session/session_manager');
import AudioManager = require('./session/audio_manager');
import InterfaceUpdater = require('./ui/interface_updater');
import ProgressTracker = require('./ui/progress_tracker');
import HistoryStore = require('./utils/history_store');
import PlaybackService = require('./services/playback_service');
import QueueService = require('./services/queue_service');
import DailyHachimiService = require('./services/daily_hachimi_service');
import * as logger from './services/logger_service';
import TokenPrecheck = require('./utils/token_precheck');
import Debug = require('./utils/debug');
import { startMetricsServerFromEnv } from './observability/metrics_server';

class BilibiliDiscordBot {
  private botClient:      BotClient | null;
  private sessionManager: any;
  private metricsServer:  any;
  private isRunning:      boolean;

  constructor() {
    this.botClient      = null;
    this.sessionManager = null;
    this.metricsServer  = null;
    this.isRunning      = false;
  }

  /**
   * Initialize and start the bot
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting Bilibili Discord Bot');
      Debug.trace('start.begin');

      const envCheck = validateEnv();
      for (const w of envCheck.warnings) logger.warn(w);
      if (!envCheck.ok) {
        for (const e of envCheck.errors) logger.error(e);
        throw new Error(`Environment validation failed: ${envCheck.errors.join('; ')}`);
      }

      this.metricsServer = startMetricsServerFromEnv();

      const tokenCheck = await TokenPrecheck.validate();
      if (!tokenCheck.valid) {
        logger.error('Discord token precheck failed', { reason: tokenCheck.reason });
        Debug.error('token.precheck', new Error(tokenCheck.reason));
        throw new Error('Discord token invalid or not usable');
      }
      Debug.trace('token.precheck', { reason: tokenCheck.reason || 'OK' });

      // --- Composition root: instantiate and wire all dependencies ---

      const sessionManager = new SessionManager();
      this.sessionManager  = sessionManager;

      const extractor = new BilibiliExtractor();
      logger.info('Bilibili extractor initialized (will test on first use)');

      const audioManager    = new AudioManager(sessionManager, extractor);
      const progressTracker = new ProgressTracker(sessionManager);
      const historyStore    = new HistoryStore(sessionManager);
      const interfaceUpdater = new InterfaceUpdater(sessionManager, progressTracker, audioManager);

      // Inject historyStore into bilibiliApi singleton
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const bilibiliApi = require('./bilibili/api') as any;
      bilibiliApi.setHistoryStore(historyStore);

      const playbackService = new PlaybackService({
        audioManager,
        interfaceUpdater,
        progressTracker,
        extractor,
        historyStore,
      });

      const queueService = new QueueService({ audioManager, extractor });

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const config = require('./config/config') as any;
      const dailyHachimiService = new DailyHachimiService(config);
      Debug.trace('inject.dependencies');

      // Bot client
      logger.info('Initializing Discord bot client');
      Debug.trace('client.init');
      this.botClient = new BotClient(playbackService, queueService, dailyHachimiService);
      this.botClient.setExtractor(extractor);

      // Initialize bot client (login, load commands, bind UI)
      await this.botClient.initialize(interfaceUpdater);

      // Initialize daily hachimi service after bot is ready (needs Discord client)
      dailyHachimiService.initialize(this.botClient.getClient() as any, bilibiliApi);
      Debug.trace('client.initialize.done');

      this.isRunning = true;
      logger.info('Bilibili Discord Bot started successfully');
      Debug.trace('start.success');

      // Log bot statistics
      const stats = this.botClient.getStats();
      logger.info('Bot statistics', stats as any);
    } catch (error: unknown) {
      logger.error('Failed to start Bilibili Discord Bot', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      Debug.error('start.failed', error as Error);
      Debug.summary();

      await this.shutdown();
      process.exit(1);
    }
  }

  /**
   * Gracefully shutdown the bot
   */
  async shutdown(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Shutting down Bilibili Discord Bot');

    try {
      if (this.botClient) {
        await this.botClient.shutdown();
      }

      if (this.sessionManager) {
        this.sessionManager.cleanup();
      }

      if (this.metricsServer) {
        await this.metricsServer.stop().catch(() => {});
        this.metricsServer = null;
      }

      this.isRunning = false;
      logger.info('Bot shutdown completed');
    } catch (error: unknown) {
      logger.error('Error during bot shutdown', { error: (error as Error).message });
    }
  }

  /**
   * Get current bot status
   */
  getStatus(): { running: boolean; botStats: any } {
    return {
      running:  this.isRunning,
      botStats: this.botClient ? this.botClient.getStats() : null,
    };
  }
}

// Create bot instance
const bot = new BilibiliDiscordBot();

// Handle process signals for graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  await bot.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  await bot.shutdown();
  process.exit(0);
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled promise rejection', {
    reason: reason?.message || reason,
    stack:  reason?.stack,
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', {
    error: error?.message || String(error),
    stack: error?.stack,
  });

  bot.shutdown().finally(() => {
    process.exit(1);
  });
});

// Start the bot if this file is run directly
if (require.main === module) {
  bot.start().catch((error: Error) => {
    logger.error('Failed to start bot', { error: error.message });
    process.exit(1);
  });
}

export = BilibiliDiscordBot;
