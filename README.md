# ALMATRACE — Digital Department Token System

## PSG College of Technology, Department of MCA

> **Status:** Pre-production / Development  
> **Stack:** HTML · CSS · Vanilla JS · Node.js · PostgreSQL  
> **Last updated:** October 2026

---

## Overview

ALMATRACE turns the department's token/roll-sequence tradition into a durable,
privacy-aware mentorship network. It identifies a student's token counterpart
across graduating batches, preserves their shared lineage, helps students find
suitable mentors when the primary match is unavailable, and gives coordinators
the tools to verify members and maintain the program.

This is an **invitation-only, internal departmental application** — not a public
social network. All personal data is collected and processed only under
institutional approval (pending).

---

## Local Development Setup

### Prerequisites

| Tool | Required version |
|---|---|
| Node.js | 20 LTS or newer |
| npm | 10+ (bundled with Node 20) |
| PostgreSQL | 15 or newer |

### 1. Clone and install

```bash
cd "TOKEN LINEAGE SYSTEM"
npm install                # installs root dev tooling
npm run server:install     # installs server dependencies
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — fill in your local PostgreSQL credentials
# Never commit .env
```

See `.env.example` for every required variable and its description.

### 3. Create the database

```bash
# In psql or pgAdmin, run:
CREATE DATABASE almatrace_dev;
CREATE USER almatrace_app WITH PASSWORD 'changeme_local';
GRANT ALL PRIVILEGES ON DATABASE almatrace_dev TO almatrace_app;
```

### 4. Run migrations

```bash
npm run migrate
```

Migrations are numbered SQL files in `server/migrations/`. They run in order
and record applied versions in a `schema_migrations` table.

### 5. Seed synthetic data

```bash
npm run seed
```

Seeds development-only fixture data. **This data is entirely synthetic — no
real student or alumni records.** Synthetic users are clearly labeled
`[SYNTHETIC]` in their display names.

### 6. Start the development server

```bash
npm run dev
```

Server starts on `http://localhost:3000` by default. The `client/public/`
directory is served as static files.

### 7. Run tests

```bash
npm test
```

---

## Project Structure

```
TOKEN LINEAGE SYSTEM/
  client/
    public/         — static HTML/CSS/JS served directly
    src/
      assets/       — images, fonts, icons
      styles/       — CSS (BEM + custom properties)
      pages/        — page-level JS modules
      components/   — reusable UI components
      services/     — API client, auth helpers
  server/
    src/
      config/       — env validation, db pool, session config
      middleware/   — request ID, logger, auth, CSRF, error handler
      modules/      — feature modules (auth, people, departments, …)
      routes/       — route registration
      jobs/         — background job workers
      app.js        — Express app factory
      server.js     — HTTP server entry point
    migrations/     — numbered .sql migration files
    tests/          — Jest test suites
  shared/
    schemas/        — Zod schemas shared between client validation and server
  docs/
    adr/            — Architecture Decision Records
    runbooks/       — operational runbooks
  scripts/          — migrate.js, seed.js, etc.
  .env.example
  .gitignore
  package.json
  README.md
```

---

## npm Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start server with nodemon (auto-reload) |
| `npm start` | Start server (production) |
| `npm run migrate` | Run pending migrations |
| `npm run migrate:status` | Show which migrations have been applied |
| `npm run seed` | Seed synthetic development data |
| `npm test` | Run all Jest tests |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |
| `npm run server:install` | Install server-specific dependencies |

---

## Environment Variables

See `.env.example` for the full list. Key variables:

- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — long random string for cookie signing
- `NODE_ENV` — `development`, `test`, or `production`
- `PORT` — HTTP port (default 3000)

**Never commit `.env` or any file containing real credentials.**

---

## Unresolved Decisions (Required Before Production)

| ID | Decision | Status |
|---|---|---|
| D1 | Token/roll-number matching rule and gold examples | ⛔ UNCONFIRMED |
| D2 | Identity provider (PSG SSO vs local passwords) | ⛔ UNCONFIRMED |
| D3 | Alumni verification owner and workflow | ⛔ UNCONFIRMED |
| D4 | Hosting provider and data region (PSG IT approval) | ⛔ UNCONFIRMED |
| D5 | Data owner, privacy approver, retention schedule | ⛔ UNCONFIRMED |
| D6 | Pilot scope: specific cohort years and alumni numbers | ⛔ UNCONFIRMED |
| D7 | Email provider (institutional SMTP or approved service) | ⛔ UNCONFIRMED |
| D8 | Coordinator MFA approach | ⛔ UNCONFIRMED |

See `docs/decision-log.md` for details and progress.

---

## Security Notes

- Passwords are hashed with Argon2id — never stored in plain text.
- Sessions use HttpOnly, Secure, SameSite=Strict cookies.
- All SQL uses parameterized queries.
- Never add real student/alumni data until D4 and D5 are resolved.
- See `docs/runbooks/security-incident.md` for the incident response process.

---

## Contributing

Match the existing code style. Run `npm run lint` and `npm test` before
submitting changes. See `docs/adr/` for architectural decisions.

---

## License

Internal use — PSG College of Technology, Department of MCA.  
Not for public distribution.
