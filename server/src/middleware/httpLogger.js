/**
 * httpLogger.js — log every request/response at the info level
 *
 * Logs: method, path, status code, response time, user ID (if authenticated).
 * Does NOT log: request body, query parameters, Authorization headers,
 * session cookies, or any value that may contain personal data.
 */

import logger from '../config/logger.js';

export function httpLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const log = res.locals.logger ?? logger;

    const entry = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      // User identity if authenticated — only the opaque ID, not email/name
      userId: req.session?.userId ?? null,
    };

    if (res.statusCode >= 500) {
      log.error(entry, 'HTTP error response');
    } else if (res.statusCode >= 400) {
      log.warn(entry, 'HTTP client error response');
    } else {
      log.info(entry, 'HTTP response');
    }
  });

  next();
}
