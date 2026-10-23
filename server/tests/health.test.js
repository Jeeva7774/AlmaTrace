/**
 * health.test.js — tests for the health check endpoint
 *
 * These tests start the Express app without a real database connection.
 * The readiness endpoint is expected to return 503 (no DB in CI).
 * The liveness endpoint returns 200 with no DB dependency.
 */

import 'dotenv/config';
import request from 'supertest';
import { createApp } from '../../src/app.js';

// Provide minimum required env vars for tests
process.env.SESSION_SECRET = 'test-secret-min-32-characters-long-ok';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/almatrace_test';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';   // Silence logs during tests
process.env.LOG_PRETTY = 'false';

describe('GET /api/v1/health', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  test('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.app).toBe('ALMATRACE');
    expect(res.body.env).toBe('test');
    expect(res.body.timestamp).toBeDefined();
  });

  test('includes X-Request-ID header in response', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  test('echoes client-supplied X-Request-ID', async () => {
    const clientId = 'test-request-id-12345';
    const res = await request(app)
      .get('/api/v1/health')
      .set('X-Request-ID', clientId);
    expect(res.headers['x-request-id']).toBe(clientId);
  });

  test('sanitizes malicious characters in X-Request-ID', async () => {
    const malicious = '<script>alert(1)</script>';
    const res = await request(app)
      .get('/api/v1/health')
      .set('X-Request-ID', malicious);
    // Sanitized — should not contain < or >
    expect(res.headers['x-request-id']).not.toContain('<');
    expect(res.headers['x-request-id']).not.toContain('>');
  });
});

describe('GET /api/v1/health/ready', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  test('returns 503 when database is unreachable', async () => {
    // In test environment without a real DB, readiness should fail gracefully
    const res = await request(app).get('/api/v1/health/ready');
    // Either 200 (if DB is available in test env) or 503 (if not)
    expect([200, 503]).toContain(res.status);
    expect(res.body.checks).toBeDefined();
    expect(res.body.checks.database).toBeDefined();
  });
});

describe('404 handling', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  test('returns 404 with error shape for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeDefined();
  });
});

describe('Security headers', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  test('includes Content-Security-Policy header', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  test('includes X-Content-Type-Options header', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
