/**
 * requestId.js — attach a unique request ID to every incoming request
 *
 * Reads the X-Request-ID header if the client (or reverse proxy) supplies one.
 * Otherwise generates a new UUID v4. Sets the ID on:
 *   - req.requestId       — for use by other middleware and route handlers
 *   - res header          — X-Request-ID echoed to the client
 *   - res.locals.logger   — child logger bound with requestId for structured logs
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger.js';

export function requestIdMiddleware(req, res, next) {
  const id =
    (req.headers['x-request-id'] || '').replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 64) ||
    uuidv4();

  req.requestId = id;
  res.setHeader('X-Request-ID', id);

  // Bind a child logger so every log line from this request carries the ID
  res.locals.logger = logger.child({ requestId: id });

  next();
}
