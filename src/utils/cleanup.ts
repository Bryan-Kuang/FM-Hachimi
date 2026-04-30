/**
 * Cleanup Utilities
 * Handles proper cleanup of resources to prevent memory leaks
 */

import * as logger from '../services/logger_service';  // fix: was stale "./logger"

type CleanupTask = { task: () => Promise<void> | void; name: string };

class CleanupManager {
  private cleanupTasks: CleanupTask[];

  constructor() {
    this.cleanupTasks = [];
    this.setupGracefulShutdown();
  }

  registerCleanup(task: () => Promise<void> | void, name: string): void {
    this.cleanupTasks.push({ task, name });
    logger.debug('Cleanup task registered', { name });
  }

  async executeCleanup(): Promise<void> {
    logger.info('Starting cleanup process', { taskCount: this.cleanupTasks.length });

    for (const { task, name } of this.cleanupTasks) {
      try {
        await task();
        logger.info('Cleanup task completed', { name });
      } catch (error) {
        logger.error('Cleanup task failed', { name, error: (error as Error).message });
      }
    }

    logger.info('Cleanup process completed');
  }

  private setupGracefulShutdown(): void {
    const handleShutdown = async (signal: string): Promise<void> => {
      logger.info('Shutdown signal received', { signal });
      await this.executeCleanup();
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGUSR2', () => handleShutdown('SIGUSR2'));

    process.on('uncaughtException', async (error: Error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      await this.executeCleanup();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason: unknown) => {
      logger.error('Unhandled promise rejection', {
        reason: (reason as Error)?.message || String(reason),
      });
      await this.executeCleanup();
      process.exit(1);
    });

    logger.info('Graceful shutdown handlers registered');
  }
}

export = new CleanupManager();
