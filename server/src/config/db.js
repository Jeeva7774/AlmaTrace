/**
 * db.js — PostgreSQL connection pool
 *
 * Creates a single shared pg.Pool instance. All modules should import the
 * `query` helper and the `pool` object from here. Do not create additional
 * pools in feature modules.
 *
 * The pool is configured from validated environment variables. It logs slow
 * queries at the warn level (> 1000 ms) without logging query parameters
 * (which may contain personal data).
 */

import pg from 'pg';
import config from './env.js';
import logger from './logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  min: config.DB_POOL_MIN,
  max: config.DB_POOL_MAX,
  statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
  // Idle connections released after 30 s to avoid resource leaks
  idleTimeoutMillis: 30000,
  // Fail fast if a connection cannot be established within 10 s (1 s in test environment)
  connectionTimeoutMillis: config.NODE_ENV === 'test' ? 1000 : 10000,
});

// Log slow queries — parameters intentionally omitted to avoid logging PII
pool.on('connect', (_client) => {
  logger.debug('pg: new client connected');
});

pool.on('error', (err) => {
  logger.error({ err }, 'pg: unexpected pool error');
});

/**
 * Execute a parameterised SQL query.
 *
 * @param {string} text   — SQL with $1, $2, … placeholders
 * @param {any[]}  params — parameter values (never interpolate directly)
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  if (duration > 1000) {
    // Log slow queries for performance triage — do NOT log params (may contain PII)
    logger.warn({ duration, rows: result.rowCount, query: text }, 'pg: slow query detected');
  }

  return result;
}

/**
 * Acquire a client from the pool for manual transaction management.
 * Always use try/finally to release the client.
 *
 * @example
 * const client = await getClient();
 * try {
 *   await client.query('BEGIN');
 *   // ... queries ...
 *   await client.query('COMMIT');
 * } catch (err) {
 *   await client.query('ROLLBACK');
 *   throw err;
 * } finally {
 *   client.release();
 * }
 *
 * @returns {Promise<pg.PoolClient>}
 */
export async function getClient() {
  return pool.connect();
}

/**
 * Run `fn(client)` inside a BEGIN/COMMIT transaction.
 * Rolls back automatically on error and re-throws.
 *
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verify connectivity. Used by the health-check endpoint and startup probe.
 * Returns { ok: true } on success, or throws on failure.
 */
export async function checkDbHealth() {
  const result = await pool.query('SELECT 1 AS ok');
  return { ok: result.rows[0].ok === 1 };
}

/**
 * Gracefully drain all pool connections.
 * Call this in the SIGTERM / SIGINT handler.
 */
export async function closePool() {
  await pool.end();
  logger.info('pg: pool closed');
}
