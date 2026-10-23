#!/usr/bin/env node
/**
 * migrate.js — lightweight SQL migration runner
 *
 * Usage:
 *   node scripts/migrate.js up       — apply all pending migrations
 *   node scripts/migrate.js status   — list applied and pending migrations
 *   node scripts/migrate.js down N   — not implemented (use forward repair approach)
 *
 * How it works:
 *   1. Ensures a `schema_migrations` table exists (idempotent DDL).
 *   2. Reads all .sql files from server/migrations/ sorted by filename.
 *   3. Skips already-applied migrations (recorded in schema_migrations).
 *   4. Runs each pending migration in a transaction; rolls back on error.
 *   5. Records the applied migration with a SHA-256 checksum.
 *
 * Conventions:
 *   - Migration filenames: NNN_description.sql (e.g. 001_extensions.sql)
 *   - Each .sql file may contain multiple statements; they run as one transaction.
 *   - Do not modify or delete applied migrations. Add a new migration to correct.
 *
 * Roles:
 *   - The migration runner must connect as a role with DDL privileges
 *     (different from the application role in production).
 *   - Use DATABASE_URL from the environment; override with MIGRATE_DATABASE_URL
 *     in production to use a privileged role.
 *
 * Security:
 *   - Checksums guard against accidental modification of applied migrations.
 *   - This script does not accept migration filenames as command-line arguments
 *     (to prevent path traversal — migrations directory is fixed).
 */

import 'dotenv/config';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import pg from 'pg';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Use MIGRATE_DATABASE_URL if set (allows separate DDL role in production)
const connectionString = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('ERROR: DATABASE_URL (or MIGRATE_DATABASE_URL) is not set.');
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function ensureMigrationsTable() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum    TEXT        NOT NULL,
      description TEXT
    );
  `);
}

async function getAppliedVersions() {
  const res = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  return new Map(res.rows.map((r) => [r.version, r.checksum]));
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function getMigrationFiles() {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files;
}

async function runUp() {
  await ensureMigrationsTable();
  const applied = await getAppliedVersions();
  const files = await getMigrationFiles();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('✅ All migrations are up to date.');
    return;
  }

  console.log(`⏳ Applying ${pending.length} pending migration(s)...\n`);

  for (const file of pending) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = await readFile(filePath, 'utf8');
    const checksum = sha256(sql);

    console.log(`  → ${file}`);

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (version, checksum, description)
         VALUES ($1, $2, $3)`,
        [file, checksum, file.replace(/^\d+_/, '').replace('.sql', '')]
      );
      await client.query('COMMIT');
      console.log(`  ✅ Applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`\n  ❌ Failed: ${file}`);
      console.error(`  Error: ${err.message}`);
      console.error('\nMigration rolled back. Fix the error and retry.');
      process.exit(1);
    }
  }

  console.log('\n✅ All pending migrations applied successfully.');
}

async function runStatus() {
  await ensureMigrationsTable();
  const applied = await getAppliedVersions();
  const files = await getMigrationFiles();

  if (files.length === 0) {
    console.log('No migration files found in', MIGRATIONS_DIR);
    return;
  }

  console.log('\nMigration Status\n' + '─'.repeat(60));
  for (const file of files) {
    const status = applied.has(file) ? '✅ applied' : '⏳ pending';
    console.log(`  ${status}  ${file}`);
  }

  // Warn about checksums that have changed (applied migrations modified)
  for (const [version, storedChecksum] of applied.entries()) {
    const filePath = path.join(MIGRATIONS_DIR, version);
    try {
      const sql = await readFile(filePath, 'utf8');
      if (sha256(sql) !== storedChecksum) {
        console.warn(`\n  ⚠️  Checksum mismatch for applied migration: ${version}`);
        console.warn('     This migration file has been modified after it was applied.');
        console.warn('     Create a new migration to make corrections.');
      }
    } catch {
      console.warn(`\n  ⚠️  Applied migration file missing: ${version}`);
    }
  }

  console.log('');
}

async function main() {
  const command = process.argv[2] ?? 'up';

  try {
    await client.connect();

    if (command === 'up') {
      await runUp();
    } else if (command === 'status') {
      await runStatus();
    } else {
      console.error(`Unknown command: ${command}. Use 'up' or 'status'.`);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration runner error:', err.message);
  process.exit(1);
});
