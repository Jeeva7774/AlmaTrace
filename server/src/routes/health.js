/**
 * health.js — health and readiness check routes
 *
 * GET /api/v1/health
 *   Shallow check: server is running. Returns 200 immediately.
 *   Used by load balancers for liveness probes.
 *
 * GET /api/v1/health/ready
 *   Deep check: verifies database connectivity.
 *   Used by orchestrators for readiness probes before sending traffic.
 *   Returns 503 if the database is unreachable.
 *
 * These endpoints intentionally reveal minimal information:
 *   - No internal version details, stack traces, or database schema info.
 *   - The database check only confirms connectivity (SELECT 1).
 */

import { Router } from 'express';
import { checkDbHealth } from '../config/db.js';
import config from '../config/env.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: config.APP_NAME,
    env: config.NODE_ENV,
    timestamp: new Date().toISOString(),
    // Warn consumers if this is a synthetic/development environment
    synthetic: config.SYNTHETIC_DATA_BANNER,
  });
});

router.get('/health/ready', async (req, res, _next) => {
  try {
    const db = await checkDbHealth();

    res.json({
      status: 'ready',
      checks: {
        database: db.ok ? 'ok' : 'fail',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const log = res.locals.logger;
    log.error({ err }, 'Health readiness check failed');

    // Return 503 — do not propagate to error handler (avoid 500)
    res.status(503).json({
      status: 'not_ready',
      checks: {
        database: 'fail',
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  }
});

export default router;
