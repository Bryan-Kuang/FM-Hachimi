/**
 * Cleanup Utilities
 * Handles proper cleanup of resources to prevent memory leaks
 */

const logger = require("./logger");

class CleanupManager {
  constructor() {
    this.cleanupTasks = [];
    this.setupGracefulShutdown();
  }

  /**
   * Register a cleanup task
   * @param {Function} task - Cleanup function
   * @param {string} name - Task name for logging
   */
  registerCleanup(task, name) {
    this.cleanupTasks.push({ task, name });
    logger.debug("Cleanup task registered", { name });
  }

  /**
   * Execute all cleanup tasks
   */
  async executeCleanup() {
    logger.info("Starting cleanup process", {
      taskCount: this.cleanupTasks.length,
    });

    for (const { task, name } of this.cleanupTasks) {
      try {
        await task();
        logger.info("Cleanup task completed", { name });
      } catch (error) {
        logger.error("Cleanup task failed", {
          name,
          error: error.message,
        });
      }
    }

    logger.info("Cleanup process completed");
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const handleShutdown = async (signal) => {
      logger.info("Shutdown signal received", { signal });
      await this.executeCleanup();
      process.exit(0);
    };

    // Handle various shutdown signals
    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGUSR2", () => handleShutdown("SIGUSR2")); // nodemon restart

    // Handle uncaught exceptions
    process.on("uncaughtException", async (error) => {
      logger.error("Uncaught exception", {
        error: error.message,
        stack: error.stack,
      });
      await this.executeCleanup();
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", async (reason, promise) => {
      logger.error("Unhandled promise rejection", {
        reason: reason?.message || reason,
        promise,
      });
      await this.executeCleanup();
      process.exit(1);
    });

    logger.info("Graceful shutdown handlers registered");
  }
}

// Export singleton instance
const cleanupManager = new CleanupManager();
module.exports = cleanupManager;

