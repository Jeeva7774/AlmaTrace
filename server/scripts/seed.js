#!/usr/bin/env node
/**
 * seed.js — synthetic development data seeder
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️  SYNTHETIC DATA ONLY                                                 │
 * │ This script creates entirely fictional fixture data for development.    │
 * │ All names, roll numbers, emails, and relationships are invented.        │
 * │                                                                         │
 * │ NEVER run this against a staging or production database.               │
 * │ NEVER commit real personal data to this file or the repository.        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * What it creates:
 *   1. One MCA department and program
 *   2. One student cohort (2024–2026) and one alumni cohort (2021–2023)
 *   3. One synthetic token rule (rule_type='synthetic')
 *   4. One coordinator account
 *   5. 5 synthetic student accounts with profiles and memberships
 *   6. 5 synthetic alumni accounts with profiles, memberships, and mentor settings
 *   7. A sample token link between synthetic student and alumni
 *   8. Sample interests (catalog)
 *
 * Safe to run multiple times (uses INSERT ... ON CONFLICT DO NOTHING).
 */

import 'dotenv/config';
import pg from 'pg';
import { hash as argon2Hash, verify as argon2Verify, Algorithm } from '@node-rs/argon2';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('ERROR: DATABASE_URL is not set. Copy .env.example to .env and configure it.');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  console.error('ERROR: seed.js must not be run in production. NODE_ENV=production detected.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB_URL });

// ─── Synthetic data constants ──────────────────────────────────────────────

const SYNTHETIC_PASSWORD = '[SYNTHETIC]Dev@12345'; // Only for development fixture accounts

// Fixed UUIDs make the seed idempotent (same IDs every run)
const IDS = {
  dept: '00000000-0000-0000-0000-000000000001',
  program: '00000000-0000-0000-0000-000000000002',
  studentCohort: '00000000-0000-0000-0000-000000000003',
  alumniCohort: '00000000-0000-0000-0000-000000000004',
  tokenRule: '00000000-0000-0000-0000-000000000005',
  coordinator: '00000000-0000-0000-0001-000000000001',
  students: [
    '00000000-0000-0000-0002-000000000001',
    '00000000-0000-0000-0002-000000000002',
    '00000000-0000-0000-0002-000000000003',
    '00000000-0000-0000-0002-000000000004',
    '00000000-0000-0000-0002-000000000005',
  ],
  alumni: [
    '00000000-0000-0000-0003-000000000001',
    '00000000-0000-0000-0003-000000000002',
    '00000000-0000-0000-0003-000000000003',
    '00000000-0000-0000-0003-000000000004',
    '00000000-0000-0000-0003-000000000005',
  ],
};

const SYNTHETIC_STUDENTS = [
  { name: '[SYNTHETIC] Arjun Dev', email: 'synth.student1@almatrace.local', token: 'S24001' },
  { name: '[SYNTHETIC] Priya Kannan', email: 'synth.student2@almatrace.local', token: 'S24002' },
  { name: '[SYNTHETIC] Vikram Selvan', email: 'synth.student3@almatrace.local', token: 'S24003' },
  { name: '[SYNTHETIC] Deepa Murali', email: 'synth.student4@almatrace.local', token: 'S24004' },
  { name: '[SYNTHETIC] Karthik Raja', email: 'synth.student5@almatrace.local', token: 'S24005' },
];

const SYNTHETIC_ALUMNI = [
  { name: '[SYNTHETIC] Meena Suresh', email: 'synth.alumni1@almatrace.local', token: 'A21001' },
  { name: '[SYNTHETIC] Rajan Pillai', email: 'synth.alumni2@almatrace.local', token: 'A21002' },
  { name: '[SYNTHETIC] Sowmya Nair', email: 'synth.alumni3@almatrace.local', token: 'A21003' },
  { name: '[SYNTHETIC] Anand Kumar', email: 'synth.alumni4@almatrace.local', token: 'A21004' },
  { name: '[SYNTHETIC] Lakshmi Venkatesan', email: 'synth.alumni5@almatrace.local', token: 'A21005' },
];

const INTERESTS = [
  { slug: 'software-development', name: 'Software Development', group: 'Technology' },
  { slug: 'machine-learning', name: 'Machine Learning & AI', group: 'Technology' },
  { slug: 'cloud-computing', name: 'Cloud Computing', group: 'Technology' },
  { slug: 'cybersecurity', name: 'Cybersecurity', group: 'Technology' },
  { slug: 'database-systems', name: 'Database Systems', group: 'Technology' },
  { slug: 'career-planning', name: 'Career Planning', group: 'Professional' },
  { slug: 'higher-education', name: 'Higher Education & Research', group: 'Professional' },
  { slug: 'entrepreneurship', name: 'Entrepreneurship', group: 'Professional' },
  { slug: 'interview-prep', name: 'Interview Preparation', group: 'Professional' },
  { slug: 'networking', name: 'Professional Networking', group: 'Professional' },
];

async function hashPassword(plain) {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

async function seedUser(id, email, name, role, passwordHash) {
  const normalized = email.toLowerCase().trim();
  await client.query(
    `INSERT INTO users (id, email, email_normalized, role, status, password_hash, email_verified_at)
     VALUES ($1, $2, $3, $4, 'active', $5, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, email, normalized, role, passwordHash]
  );
  await client.query(
    `INSERT INTO profiles (user_id, display_name, bio, visibility)
     VALUES ($1, $2, $3, 'discoverable')
     ON CONFLICT (user_id) DO NOTHING`,
    [id, name, `Synthetic fixture account — ${name}. NOT a real person.`]
  );
}

async function main() {
  await client.connect();
  console.log('\n⚠️  SYNTHETIC DATA SEEDER — development only\n');

  try {
    const passwordHash = await hashPassword(SYNTHETIC_PASSWORD);

    // ── Department ──────────────────────────────────────────────────────────
    console.log('Seeding department and program...');
    await client.query(
      `INSERT INTO departments (id, name, code, institution)
       VALUES ($1, 'Department of MCA', 'MCA', 'PSG College of Technology')
       ON CONFLICT (id) DO NOTHING`,
      [IDS.dept]
    );

    await client.query(
      `INSERT INTO programs (id, department_id, name, degree, duration_years)
       VALUES ($1, $2, 'Master of Computer Applications', 'M.C.A.', 2)
       ON CONFLICT (id) DO NOTHING`,
      [IDS.program, IDS.dept]
    );

    // ── Cohorts ─────────────────────────────────────────────────────────────
    console.log('Seeding cohorts...');
    await client.query(
      `INSERT INTO cohorts (id, program_id, admission_year, graduation_year, label)
       VALUES ($1, $2, 2024, 2026, '2024–2026 MCA [SYNTHETIC]')
       ON CONFLICT (id) DO NOTHING`,
      [IDS.studentCohort, IDS.program]
    );

    await client.query(
      `INSERT INTO cohorts (id, program_id, admission_year, graduation_year, label)
       VALUES ($1, $2, 2021, 2023, '2021–2023 MCA [SYNTHETIC]')
       ON CONFLICT (id) DO NOTHING`,
      [IDS.alumniCohort, IDS.program]
    );

    // ── Token rule (synthetic only) ─────────────────────────────────────────
    console.log('Seeding synthetic token rule...');
    await client.query(
      `INSERT INTO token_rules (id, program_id, version, rule_type, config, status,
         description, created_by)
       VALUES ($1, $2, 'synthetic-v1', 'synthetic',
         '{"note": "Synthetic rule — no real matching logic. Replace with official rule when D1 is resolved."}',
         'preview',
         'SYNTHETIC DEVELOPMENT RULE — NOT approved for production use',
         $3)
       ON CONFLICT (id) DO NOTHING`,
      [IDS.tokenRule, IDS.program, IDS.coordinator]
    );

    // ── Coordinator ─────────────────────────────────────────────────────────
    console.log('Seeding coordinator...');
    await seedUser(
      IDS.coordinator,
      'synth.coordinator@almatrace.local',
      '[SYNTHETIC] MCA Coordinator',
      'coordinator',
      passwordHash
    );

    // ── Students ─────────────────────────────────────────────────────────────
    console.log('Seeding 5 synthetic students...');
    for (let i = 0; i < SYNTHETIC_STUDENTS.length; i++) {
      const s = SYNTHETIC_STUDENTS[i];
      const userId = IDS.students[i];
      await seedUser(userId, s.email, s.name, 'student', passwordHash);

      await client.query(
        `INSERT INTO memberships
           (id, user_id, cohort_id, member_type, raw_identifier,
            normalized_token_key, identifier_rule_version, affiliation_status)
         VALUES ($1, $2, $3, 'student', $4, $4, 'synthetic-v1', 'verified')
         ON CONFLICT (id) DO NOTHING`,
        [uuidv4(), userId, IDS.studentCohort, s.token]
      );
    }

    // ── Alumni ───────────────────────────────────────────────────────────────
    console.log('Seeding 5 synthetic alumni...');
    for (let i = 0; i < SYNTHETIC_ALUMNI.length; i++) {
      const a = SYNTHETIC_ALUMNI[i];
      const userId = IDS.alumni[i];
      await seedUser(userId, a.email, a.name, 'alumni', passwordHash);

      await client.query(
        `INSERT INTO memberships
           (id, user_id, cohort_id, member_type, raw_identifier,
            normalized_token_key, identifier_rule_version, affiliation_status)
         VALUES ($1, $2, $3, 'alumni', $4, $4, 'synthetic-v1', 'verified')
         ON CONFLICT (id) DO NOTHING`,
        [uuidv4(), userId, IDS.alumniCohort, a.token]
      );

      await client.query(
        `INSERT INTO mentor_settings (user_id, available, max_mentees, accepting_requests)
         VALUES ($1, TRUE, 3, TRUE)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
    }

    // ── Interests catalog ────────────────────────────────────────────────────
    console.log('Seeding interests catalog...');
    for (const interest of INTERESTS) {
      await client.query(
        `INSERT INTO interests (id, name, slug, group_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO NOTHING`,
        [uuidv4(), interest.name, interest.slug, interest.group]
      );
    }

    console.log('\n✅ Synthetic seed complete.\n');
    console.log('  Coordinator login: synth.coordinator@almatrace.local');
    console.log('  Student login:     synth.student1@almatrace.local');
    console.log('  Alumni login:      synth.alumni1@almatrace.local');
    console.log(`  Password for all:  ${SYNTHETIC_PASSWORD}`);
    console.log('\n  ⚠️  These are synthetic fixture accounts. Do not use in production.');
    console.log('  ⚠️  TOKEN_RULE_MODE=synthetic — no real token matching is enabled.\n');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Seed script error:', err.message);
  process.exit(1);
});
