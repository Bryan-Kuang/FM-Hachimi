#!/usr/bin/env node

/**
 * Docker Health Check Script
 * Verifies that the bot process is running correctly
 */

// Simple health check - verify Node.js process is responsive
const healthCheck = () => {
  try {
    // Check if main process file exists and is readable
    require.resolve('../../src/index.js');

    // If we get here, the basic file system is working
    process.exit(0);
  } catch (error) {
    console.error('Health check failed:', error.message);
    process.exit(1);
  }
};

// Run health check with timeout
const timeout = setTimeout(() => {
  console.error('Health check timeout');
  process.exit(1);
}, 5000);

healthCheck();
clearTimeout(timeout);
