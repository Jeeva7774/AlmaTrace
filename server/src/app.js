/**
 * app.js — Express application factory
 *
 * Creates and configures the Express app. Does not start the HTTP server
 * (that is done in server.js). Keeping these separate makes the app testable
 * without binding to a port.
 *
 * Middleware registration order matters:
 *   1. Security headers (helmet)
 *   2. Request ID (so all subsequent logs carry it)
 *   3. HTTP request logger
 *   4. Body parsers
 *   5. Session
 *   6. CSRF (after session)
 *   7. CORS
 *   8. Rate limiters (applied per-router or globally as needed)
 *   9. Application routes
 *   10. 404 handler
 *   11. Error handler (must be last)
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';

import config from './config/env.js';
import { pool } from './config/db.js';
import logger from './config/logger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { httpLogger } from './middleware/httpLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import healthRouter from './routes/health.js';

const PgSession = connectPgSimple(session);

export function createApp() {
  const app = express();

  // ── 1. Security headers ──────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy:
        config.CSP_MODE === 'off'
          ? false
          : {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"], // relax for MVP CSS; tighten after hash extraction
                imgSrc: ["'self'", 'data:'],
                fontSrc: ["'self'"],
                connectSrc: ["'self'"],
                frameSrc: ["'none'"],
                objectSrc: ["'none'"],
                upgradeInsecureRequests:
                  config.NODE_ENV === 'production' ? [] : null,
              },
              reportOnly: config.CSP_MODE === 'report-only',
            },
      // Enforce HTTPS in production
      hsts:
        config.NODE_ENV === 'production'
          ? { maxAge: 31536000, includeSubDomains: true }
          : false,
    })
  );

  // ── 2. Request ID ────────────────────────────────────────────────────────
  app.use(requestIdMiddleware);

  // ── 3. HTTP request logger ───────────────────────────────────────────────
  app.use(httpLogger);

  // ── 4. Body parsers ──────────────────────────────────────────────────────
  // Limit body size to mitigate payload-based DoS
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));
  app.use(cookieParser());

  // ── 5. CORS ──────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Request-ID', 'X-CSRF-Token'],
    })
  );

  // ── 6. Session ───────────────────────────────────────────────────────────
  app.use(
    session({
      store: new PgSession({
        pool,
        tableName: 'user_sessions',
        // Prune expired sessions every hour
        pruneSessionInterval: 3600,
        errorLog: (err) => logger.error({ err }, 'Session store error'),
      }),
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true, // Reset expiry on each request
      cookie: {
        httpOnly: true,
        secure: config.SESSION_SECURE,
        sameSite: 'strict',
        maxAge: config.SESSION_MAX_AGE_MS,
      },
      name: 'almatrace.sid', // avoid generic 'connect.sid'
    })
  );

  // ── 7. Global rate limiter ────────────────────────────────────────────────
  // A loose global limit; tighter limits are applied per sensitive route.
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,   // 1 minute
    max: 300,              // 300 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down.',
      },
    },
  });
  app.use('/api/', globalLimiter);

  // ── 8. Serve static client files ─────────────────────────────────────────
  // In development the server serves client/public directly.
  // In production a reverse proxy (nginx) would serve these files instead.
  app.use(
    express.static(new URL('../../client/public', import.meta.url).pathname)
  );

  // ── 9. API routes ─────────────────────────────────────────────────────────
  app.use('/api/v1', healthRouter);

  // Placeholder: additional routers will be registered here as modules are built
  // app.use('/api/v1/auth', authRouter);
  // app.use('/api/v1/me', meRouter);
  // app.use('/api/v1/admin', adminRouter);

  // ── 10. 404 handler ───────────────────────────────────────────────────────
  app.use(notFoundHandler);

  // ── 11. Error handler (must be last) ─────────────────────────────────────
  app.use(errorHandler);

  return app;
}
