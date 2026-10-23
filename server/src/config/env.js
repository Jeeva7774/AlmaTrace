/**
 * env.js — environment variable validation and configuration
 *
 * Validates all required environment variables at startup. The server will
 * refuse to start if a required variable is missing or invalid. This prevents
 * silent mis-configuration in staging and production.
 *
 * Sensitive values (secrets, passwords) are validated for presence and
 * minimum length but are never logged or included in error messages.
 */

import { z } from 'zod';

const envSchema = z.object({
  // ── Application ──────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  APP_NAME: z.string().min(1).default('ALMATRACE'),

  // ── Database ─────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),

  // ── Session ──────────────────────────────────────────────────────────────
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters')
    .refine(
      (v) => !v.includes('REPLACE_WITH'),
      'SESSION_SECRET must be replaced with a real secret'
    ),
  SESSION_MAX_AGE_MS: z.coerce.number().int().min(60000).default(28800000),
  SESSION_SECURE: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // ── Email ────────────────────────────────────────────────────────────────
  SMTP_URL: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('noreply@almatrace.local'),

  // ── Rate Limits ──────────────────────────────────────────────────────────
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_VERIFY_MAX: z.coerce.number().int().min(1).default(10),

  // ── Token Rules ──────────────────────────────────────────────────────────
  TOKEN_RULE_MODE: z.enum(['synthetic', 'configured']).default('synthetic'),

  // ── Logging ──────────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_PRETTY: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // ── Security ─────────────────────────────────────────────────────────────
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  CSP_MODE: z.enum(['strict', 'report-only', 'off']).default('strict'),

  // ── Feature Flags ────────────────────────────────────────────────────────
  REGISTRATION_OPEN: z
    .string()
    .transform((v) => v !== 'false')
    .default('true'),
  SYNTHETIC_DATA_BANNER: z
    .string()
    .transform((v) => v !== 'false')
    .default('true'),
});

/**
 * Parsed, type-safe environment configuration.
 * Import this object throughout the server instead of reading process.env directly.
 *
 * @type {z.infer<typeof envSchema>}
 */
let config;

try {
  config = envSchema.parse(process.env);
} catch (err) {
  // Format Zod errors into a readable list without printing secret values
  const issues = err.issues
    .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(
    `\n❌ Environment validation failed. Fix the following before starting:\n${issues}\n` +
      `\nSee .env.example for the complete list of required variables.\n`
  );
  process.exit(1);
}

export default config;
