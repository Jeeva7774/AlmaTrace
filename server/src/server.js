/**
 * server.js — HTTP server entry point
 *
 * Loads environment variables, creates the Express app, starts the HTTP
 * server, and registers graceful shutdown handlers for SIGTERM and SIGINT.
 *
 * Startup sequence:
 *   1. Load .env (if present — production uses real env vars)
 *   2. Validate environment (config/env.js exits on failure)
 *   3. Create Express app
 *   4. Start listening
 *   5. Log startup summary
 *
 * Shutdown sequence (SIGTERM / SIGINT):
 *   1. Stop accepting new connections (server.close)
 *   2. Close database pool
 *   3. Exit 0
 */

// Load .env before importing anything that reads process.env
import 'dotenv/config';

import http from 'http';
import { createApp } from './app.js';
import config from './config/env.js';
import logger from './config/logger.js';
import { closePool } from './config/db.js';

const app = createApp();
const server = http.createServer(app);

server.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      env: config.NODE_ENV,
      app: config.APP_NAME,
      synthetic: config.SYNTHETIC_DATA_BANNER,
      tokenRuleMode: config.TOKEN_RULE_MODE,
    },
    `${config.APP_NAME} server started`
  );

  if (config.TOKEN_RULE_MODE === 'synthetic') {
    logger.warn(
      'TOKEN_RULE_MODE=synthetic — token matching is disabled. ' +
        'Do not use real student data until the department approves the official rule (D1).'
    );
  }

  if (config.SYNTHETIC_DATA_BANNER) {
    logger.warn(
      'SYNTHETIC_DATA_BANNER=true — this environment uses synthetic fixture data only. ' +
        'Do not add real personal data until hosting (D4) and data governance (D5) are approved.'
    );
  }
});

// ── Graceful shutdown ────────────────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Received shutdown signal — draining connections');

  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await closePool();
    } catch (err) {
      logger.error({ err }, 'Error closing database pool during shutdown');
    }
    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Force exit if shutdown takes too long (e.g., hung DB connection)
  setTimeout(() => {
    logger.error('Shutdown timed out after 10 s — forcing exit');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Log unhandled rejections so they don't silently disappear
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});
