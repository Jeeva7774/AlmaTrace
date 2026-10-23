# Decision Log — ALMATRACE

This log records architectural and design decisions, their rationale, and
current status. Update this file when a new decision is made or an
unresolved item is settled.

---

## Unresolved Decisions (Required Before Production)

### D1 — Token/roll-number matching rule

**Status:** ⛔ UNCONFIRMED  
**Blocks:** Token matching engine, lineage computation, gold-set tests  
**Required from:** Department of MCA  
**Required inputs:**
- Official examples covering all roll-number formats used across batches
- Exact mapping formula (modulo, suffix-parse, lookup table, etc.)
- Handling of leading zeros, duplicate sequences, transfers, re-admissions
- Whether one student can have multiple token counterparts
- Approved anonymized gold set for accuracy testing

**Current state:** Token rule engine built as configurable interface
(`token_rules` table, `rule_type` field). Synthetic rule in place for
development. No production matching until this is resolved.

---

### D2 — Identity provider (PSG SSO vs local passwords)

**Status:** ⛔ UNCONFIRMED  
**Blocks:** Final auth module; SSO adapter if needed  
**Required from:** PSG IT  
**Required inputs:** Whether OIDC/SAML SSO is available for both current
students AND alumni; if SSO is only available for students, what the
alumni fallback is.

**Current state:** Local email + Argon2id password flow implemented as
fallback. The auth module has a clear boundary (auth adapter) that can
be extended to support SSO when D2 is resolved.

---

### D3 — Alumni verification owner and workflow

**Status:** ⛔ UNCONFIRMED  
**Blocks:** Coordinator verification queue UX, evidence retention policy  
**Required from:** Department of MCA / alumni office  
**Required inputs:** Named coordinator role, evidence type accepted
(alumni record, alumni office confirmation), evidence retention rules.

---

### D4 — Hosting provider and data region

**Status:** ⛔ UNCONFIRMED  
**Blocks:** Production deployment, backup configuration, email provider  
**Required from:** PSG IT  
**Required inputs:** Approved cloud or on-premises host, data storage
region (India data residency requirements), whether external transactional
email services are permitted.

**Current state:** Server is environment-agnostic. No cloud-specific
dependencies added. Will configure for approved host when D4 is resolved.

---

### D5 — Data owner, privacy approver, retention schedule

**Status:** ⛔ UNCONFIRMED  
**Blocks:** Real data collection, privacy notice, export/deletion workflows  
**Required from:** PSG College of Technology (institutional data owner)  
**Required inputs:** Named data controller, approved privacy notice,
retention periods for each data category, deletion/anonymization workflow
approval.

**Current state:** Consent records table exists. No real personal data
collected. Synthetic data only.

---

### D6 — Pilot scope (specific cohort years and numbers)

**Status:** ⛔ UNCONFIRMED  
**Blocks:** Seed data calibration, capacity planning, coordinator workload  
**Required from:** Department of MCA  
**Required inputs:** Which admission/graduation years are included in the
first pilot, expected number of participating students and alumni.

---

### D7 — Email provider

**Status:** ⛔ UNCONFIRMED  
**Blocks:** Email delivery module, reminder jobs  
**Required from:** PSG IT  
**Required inputs:** Institutional SMTP credentials OR approval to use an
external transactional email service (Postmark, SendGrid, etc.) and which
sender domain is authorized.

---

### D8 — Coordinator MFA approach

**Status:** ⛔ UNCONFIRMED  
**Blocks:** Admin account hardening  
**Required from:** IT/security review  
**Required inputs:** Whether MFA should be app TOTP, institutional SSO MFA,
or hardware key; whether optional MFA for regular users is required.

---

## Resolved Decisions

### R1 — Primary keys: UUID v4

**Decided:** 2026-10-23 (plan requirement)  
**Choice:** `gen_random_uuid()` UUID v4 for all externally referenced entities.  
**Rationale:** Plan explicitly requires UUIDs. Avoids sequential enumeration
of IDs in URLs. Supported natively by PostgreSQL with `uuid-ossp` extension.  
**Exception:** `audit_events` uses `BIGSERIAL` for ordered append-only
inserts where sequence matters.

---

### R2 — Query approach: raw pg with parameterized queries

**Decided:** 2026-10-23  
**Choice:** `pg` npm package with parameterized `$1, $2` placeholders.  
**Rationale:** Plan guidance: "use a query builder or ORM only if the team
can understand generated SQL." Raw pg is most transparent for a small team.
Parameterization prevents SQL injection by construction.  
**Trade-off:** More SQL to write; no query builder helpers.

---

### R3 — Session store: connect-pg-simple on existing database

**Decided:** 2026-10-23  
**Choice:** `connect-pg-simple` storing sessions in PostgreSQL.  
**Rationale:** Avoids adding Redis for MVP scale (< 200 users). Keeps
infrastructure simple. Can switch to Redis if session volume justifies it.  
**Constraint:** Session table (`user_sessions`) must not be backed up with
the same frequency as user data; expired sessions are automatically pruned.

---

### R4 — Password hashing: Argon2id

**Decided:** 2026-10-23  
**Choice:** Argon2id with memoryCost=65536, timeCost=3, parallelism=1.  
**Rationale:** Argon2id is the current OWASP recommended algorithm. More
resistant to GPU attacks than bcrypt. Parameters are above OWASP minimums.  
**Note:** If institutional SSO (D2) is adopted, password hashing becomes
irrelevant for SSO users but remains for any fallback local accounts.

---

### R5 — Frontend: vanilla ES modules, no framework

**Decided:** 2026-10-23  
**Choice:** Semantic HTML + CSS custom properties + ES module JavaScript.  
**Rationale:** Plan says framework is optional. Avoids build tooling
complexity for a small institutional team. Can introduce a lightweight
framework (e.g. Alpine.js or Preact) later if interactive complexity grows.  
**Trade-off:** More manual DOM work for complex interactions.

---

### R6 — Migration runner: custom lightweight SQL runner

**Decided:** 2026-10-23  
**Choice:** Custom `scripts/migrate.js` reading numbered `.sql` files.  
**Rationale:** No extra dependency (vs Flyway, Liquibase, knex). Simple
enough for the team to understand and debug. Checksums detect accidental
modification of applied migrations.  
**Trade-off:** No automatic rollback (by design — use forward repair).

---

### R7 — Token rule implementation: interface only until D1 resolved

**Decided:** 2026-10-23  
**Choice:** Build rule engine interface, `token_rules` table, parser
test harness, and synthetic fixture. No production matching.  
**Rationale:** Plan hard-stop: "Do not implement production token matching
without department-approved examples and a signed-off gold set."  
**State:** TOKEN_RULE_MODE=synthetic enforced in configuration.
