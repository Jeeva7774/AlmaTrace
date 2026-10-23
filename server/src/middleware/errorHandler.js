/**
 * errorHandler.js — centralized Express error handler
 *
 * This must be the LAST middleware registered in app.js (after all routes).
 *
 * Error shape returned to clients:
 * {
 *   "error": {
 *     "code": "VALIDATION_ERROR",    // machine-readable code
 *     "message": "Human readable",   // safe, non-revealing message
 *     "requestId": "uuid",
 *     "details": [...]               // optional: field-level validation issues
 *   }
 * }
 *
 * Security notes:
 * - Stack traces and internal error details are NEVER sent to clients.
 * - Validation errors from Zod are safe to return (they reference field names,
 *   not internal state).
 * - Database errors are mapped to generic codes; never reveal SQL or schema details.
 */

import { ZodError } from 'zod';
import logger from '../config/logger.js';

/**
 * Map a thrown error to a safe HTTP response.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
export function errorHandler(err, req, res, _next) {
  const log = res.locals.logger ?? logger;
  const requestId = req.requestId ?? 'unknown';

  // ── Zod validation errors ─────────────────────────────────────────────────
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    log.warn({ requestId, details }, 'Request validation failed');

    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'One or more fields are invalid.',
        requestId,
        details,
      },
    });
  }

  // ── Application-level errors (thrown with .status and .code) ─────────────
  if (err.status && err.code) {
    log.warn({ requestId, code: err.code, status: err.status }, err.message);

    return res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        requestId,
      },
    });
  }

  // ── PostgreSQL unique-violation ───────────────────────────────────────────
  if (err.code === '23505') {
    log.warn({ requestId, pgCode: err.code }, 'Database unique constraint violation');
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'A record with this value already exists.',
        requestId,
      },
    });
  }

  // ── PostgreSQL foreign-key violation ─────────────────────────────────────
  if (err.code === '23503') {
    log.warn({ requestId, pgCode: err.code }, 'Database foreign key violation');
    return res.status(422).json({
      error: {
        code: 'REFERENCE_ERROR',
        message: 'A referenced record does not exist.',
        requestId,
      },
    });
  }

  // ── CSRF token errors (from csurf) ───────────────────────────────────────
  if (err.code === 'EBADCSRFTOKEN') {
    log.warn({ requestId }, 'CSRF token validation failed');
    return res.status(403).json({
      error: {
        code: 'CSRF_ERROR',
        message: 'Invalid or missing CSRF token. Reload the page and try again.',
        requestId,
      },
    });
  }

  // ── Generic / unhandled error ─────────────────────────────────────────────
  // Log the full error (including stack) server-side only
  log.error({ requestId, err }, 'Unhandled server error');

  const isDev = process.env.NODE_ENV === 'development';

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
      requestId,
      // Only reveal the error message (not stack) in development
      ...(isDev ? { debug: err.message } : {}),
    },
  });
}

/**
 * 404 handler — register BEFORE errorHandler, AFTER all routes.
 */
export function notFoundHandler(req, res) {
  const requestId = req.requestId ?? 'unknown';
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      requestId,
    },
  });
}

/**
 * Create a typed application error.
 *
 * @param {number} status  HTTP status code
 * @param {string} code    Machine-readable error code (SCREAMING_SNAKE_CASE)
 * @param {string} message Safe, user-visible message
 * @returns {Error & { status: number, code: string }}
 */
export function createError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}
