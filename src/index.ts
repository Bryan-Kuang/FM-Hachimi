/**
 * Bilibili Discord Bot - Main Entry Point
 * Composition root: all dependencies are instantiated here and wired together.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { validateEnv } from './config/env_validator';
import BotClient = require('./bot/client');
import BilibiliExtractor = require('./bilibili/extractor');
import YouTubeExtractor = require('./youtube/extractor');
import MediaCache = require('./audio/media_cache');
import YouTubeCookieRefreshService = require('./youtube/cookie_refresh_service');
import SessionManager = require('./session/session_manager');
import AudioManager = require('./session/audio_manager');
import ResumeService = require('./session/resume_service');
import InterfaceUpdater = require('./ui/interface_updater');
import ProgressTracker = require('./ui/progress_tracker');
import HistoryStore = require('./utils/history_store');
import PlayerService = require('./services/player_service');
import RadioService = require('./services/radio_service');
import AnnoyingService = require('./services/annoying_service');
import DailyHachimiService = require('./services/daily_hachimi_service');
import WorldCupSource = require('./world_cup/source');
import WorldCupService = require('./world_cup/world_cup_service');
import PreExtractionService = require('./playback/pre_extraction_service');
import * as logger from './services/logger_service';
import TokenPrecheck = require('./utils/token_precheck');
import Debug = require('./utils/debug');
import { startMetricsServerFromEnv } from './observability/metrics_server';
import config = require('./config/config');

class BilibiliDiscordBot {
  private botClient:      BotClient | null;
  private sessionManager: any;
  private metricsServer:  any;
  private youtubeCookieRefreshService: YouTubeCookieRefreshService | null;
  private worldCupService: WorldCupService | null;
  private resumeService:  ResumeService | null;
  private isRunning:      boolean;

  constructor() {
    this.botClient      = null;
    this.sessionManager = null;
    this.metricsServer  = null;
    this.youtubeCookieRefreshService = null;
    this.worldCupService = null;
    this.resumeService  = null;
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

      this.metricsServer = startMetricsServerFromEnv(() => this.getStatus());

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

      const youtubeExtractor = new YouTubeExtractor();
      logger.info('YouTube extractor initialized (requires yt-dlp)');

      if (config.youtube.mediaCacheEnabled) {
        const mediaCache = new MediaCache({
          dir: config.youtube.mediaCacheDir,
          maxEntries: config.youtube.mediaCacheMaxEntries,
          maxBytes: config.youtube.mediaCacheMaxBytes,
        });
        youtubeExtractor.setMediaCache(mediaCache);
        logger.info('YouTube media cache enabled', {
          dir: config.youtube.mediaCacheDir,
          maxEntries: config.youtube.mediaCacheMaxEntries,
        });
      }

      // Bilibili gets its own media cache (separate dir + budget) so replayed
      // Bilibili tracks — notably the fixed radio break video — play from a
      // local file instead of re-extracting/streaming from Bilibili's CDN.
      if (config.bilibili.mediaCacheEnabled) {
        const bilibiliMediaCache = new MediaCache({
          dir: config.bilibili.mediaCacheDir,
          maxEntries: config.bilibili.mediaCacheMaxEntries,
          maxBytes: config.bilibili.mediaCacheMaxBytes,
        });
        extractor.setMediaCache(bilibiliMediaCache);
        logger.info('Bilibili media cache enabled', {
          dir: config.bilibili.mediaCacheDir,
          maxEntries: config.bilibili.mediaCacheMaxEntries,
        });
      }

      const youtubeCookieRefreshService = new YouTubeCookieRefreshService(config.youtube.cookieRefresh);
      youtubeCookieRefreshService.start();
      youtubeCookieRefreshService.refreshInBackground({ reason: 'startup' });
      youtubeExtractor.setCookieRefreshService(youtubeCookieRefreshService);
      this.youtubeCookieRefreshService = youtubeCookieRefreshService;

      const audioManager    = new AudioManager(sessionManager, extractor, youtubeExtractor);
      const progressTracker = new ProgressTracker(sessionManager);
      const historyStore    = new HistoryStore(sessionManager);
      const interfaceUpdater = new InterfaceUpdater(sessionManager, progressTracker, audioManager);
      const preExtractionService = new PreExtractionService({
        bilibiliExtractor: extractor,
        youtubeExtractor,
      });

      // Inject historyStore into bilibiliApi singleton
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const bilibiliApi = require('./bilibili/api') as any;
      bilibiliApi.setHistoryStore(historyStore);

      const playerService = new PlayerService({
        audioManager,
        interfaceUpdater,
        progressTracker,
        extractor,
        youtubeExtractor,
        historyStore,
        preExtractionService,
      });

      // Endless radio mode. Reuses bilibiliApi (random Hachimi search + history)
      // and plays through the same playerService; attached so commands can reach
      // it via playerService.getRadioService().
      const radioService = new RadioService(playerService as any, bilibiliApi);
      playerService.setRadioService(radioService as any);

      const dailyHachimiService = new DailyHachimiService(config as any, preExtractionService);

      // Temporal World Cup feature (live scores). Inert outside the tournament
      // window; commands degrade to a manual fallback if the source is down.
      let worldCupService: WorldCupService | null = null;
      if (config.worldCup.enabled) {
        const worldCupSource = new WorldCupSource({
          baseUrl: config.worldCup.sourceUrl,
          timeoutMs: config.worldCup.requestTimeoutMs,
        });
        worldCupService = new WorldCupService(config.worldCup, worldCupSource);
        this.worldCupService = worldCupService;
      }
      Debug.trace('inject.dependencies');

      // Bot client
      logger.info('Initializing Discord bot client');
      Debug.trace('client.init');
      this.botClient = new BotClient(playerService, dailyHachimiService, worldCupService);
      this.botClient.setExtractor(extractor);

      // Initialize bot client (login, load commands, bind UI)
      await this.botClient.initialize(interfaceUpdater);

      // Initialize daily hachimi service after bot is ready (needs Discord client)
      dailyHachimiService.initialize(this.botClient.getClient() as any, bilibiliApi);

      // Initialize World Cup service after bot is ready (needs Discord client)
      worldCupService?.initialize(this.botClient.getClient() as any);
      audioManager.prewarmPlaybackTools([youtubeExtractor]);
      Debug.trace('client.initialize.done');

      // Resume playback sessions interrupted by the previous shutdown
      // (snapshot written in shutdown() below). Best-effort, non-blocking.
      const resumeService = new ResumeService(config.resume);
      this.resumeService = resumeService;

      // /annoying anti-disconnect mode: fights hostile disconnects/moves by
      // reconstructing the session via the resume machinery. Attached to
      // playerService so the command and voiceStateUpdate handler can reach it.
      const annoyingService = new AnnoyingService(config.annoying);
      // Load the persisted on/off flag BEFORE anything can toggle it — this is
      // what lets /annoying survive a redeploy even when nothing is playing
      // (this repo's pipeline redeploys on every merge to main).
      annoyingService.load();
      annoyingService.initialize({
        client: this.botClient.getClient(),
        audioManager,
        sessionManager,
        radioService,
        resumeService,
      });
      playerService.setAnnoyingService(annoyingService as any);

      resumeService.scheduleRestore({
        client: this.botClient.getClient(),
        audioManager,
        sessionManager,
        radioService,
      });
      // Keep the snapshot fresh while playing so a hard kill / crash (not just a
      // graceful SIGTERM) still has something to resume from.
      resumeService.startAutoSnapshot(sessionManager);

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
      // Snapshot active playback BEFORE the client/voice connections are torn
      // down — the snapshot needs each player's live voice channel id. Stop the
      // periodic flush first so it can't race this final write.
      if (this.resumeService && this.sessionManager) {
        this.resumeService.stopAutoSnapshot();
        this.resumeService.persist(this.sessionManager);
      }

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

      if (this.youtubeCookieRefreshService) {
        this.youtubeCookieRefreshService.stop();
        this.youtubeCookieRefreshService = null;
      }

      if (this.worldCupService) {
        this.worldCupService.stop();
        this.worldCupService = null;
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
