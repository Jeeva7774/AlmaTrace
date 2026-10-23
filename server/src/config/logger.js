/**
 * logger.js — structured JSON logger using winston
 *
 * In development (LOG_PRETTY=true) output is colorised and human-readable.
 * In production/staging it emits newline-delimited JSON for log aggregators.
 *
 * Never log: passwords, session tokens, raw roll numbers, report narratives,
 * full request bodies containing personal data, or database query parameters.
 */

import { createLogger, format, transports } from 'winston';
import config from './env.js';

const { combine, timestamp, errors, json, colorize, printf } = format;

const prettyFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, requestId, err, ...meta }) => {
    const rid = requestId ? ` [${requestId}]` : '';
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    const stack = err?.stack ? `\n${err.stack}` : '';
    return `${ts}${rid} ${level}: ${message}${metaStr}${stack}`;
  })
);

const jsonFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = createLogger({
  level: config.LOG_LEVEL,
  format: config.LOG_PRETTY ? prettyFormat : jsonFormat,
  transports: [new transports.Console()],
  // Prevent winston from crashing on uncaught exceptions (we handle those separately)
  exitOnError: false,
});

export default logger;
