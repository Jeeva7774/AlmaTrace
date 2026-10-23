# ALMATRACE — Setup and Execution Instructions

**ALMATRACE** is the Digital Department Token System for the Department of Computer Applications (MCA) at **PSG College of Technology**. It connects current MCA students with verified alumni counterparts through the department's historical roll-number tradition and structured mentorship workflows.

This document contains complete, step-by-step instructions for installing all required dependencies, configuring the environment, running migrations, executing automated tests, and launching the application in both **Zero-Config Preview Mode** and **Full-Stack Production/Development Mode**.

---

## 1. System Requirements & Prerequisites

### Required Software
| Component | Minimum Version | Recommended Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v20.0.0+` (LTS) | `v20.18.0` or higher | JavaScript runtime (ES Modules support) |
| **npm** | `v10.0.0+` | `v10.8.0` or higher | Package and workspace manager |
| **PostgreSQL** *(for Full-Stack Mode)* | `v15.0+` | `v16.0+` | Relational database (UUID & JSONB support) |
| **Operating System** | Any | Windows 10/11, macOS, Linux | Cross-platform compatibility |

> **Note on Windows Environments:**
> ALMATRACE uses `bcryptjs` (100% pure JavaScript, zero native compilation required), eliminating the need for Visual C++ Build Tools or `node-gyp`.

---

## 2. Dependencies Overview

All dependencies are defined in the root `package.json` and `server/package.json` workspaces.

### Production Runtime Dependencies (`server/package.json`)
* `express` (`^4.21.2`) — Core HTTP web server and REST API framework.
* `pg` (`^8.13.0`) — Official PostgreSQL connection pool and client.
* `bcryptjs` (`^2.4.3`) — Secure password hashing (12 salt rounds, pure JS).
* `express-session` (`^1.18.1`) — HTTP-only session management.
* `connect-pg-simple` (`^10.0.0`) — PostgreSQL-backed persistent session store.
* `cookie-parser` (`^1.4.7`) — Cookie parsing middleware for signed session IDs.
* `csrf-csrf` (`^3.2.0`) — Cryptographic Double-Submit Cookie CSRF protection.
* `helmet` (`^8.0.0`) — HTTP security headers (CSP, HSTS, X-Frame-Options).
* `express-rate-limit` (`^7.5.0`) — IP-based rate limiting on authentication routes.
* `zod` (`^3.24.0`) — Schema validation and type enforcement on API boundaries.
* `winston` (`^3.17.0`) — Structured JSON logging with request tracing.
* `dotenv` (`^16.4.5`) — Environment configuration loading from `.env`.
* `uuid` (`^11.1.1`) — RFC 4122 compliant UUIDv4 generator.
* `cors` (`^2.8.5`) — Cross-origin resource sharing policy.

### Developer & Testing Dependencies
* `jest` (`^29.7.0`) — Automated unit, integration, and security testing framework.
* `supertest` (`^7.0.0`) — HTTP assertions for Express route testing.
* `nodemon` (`^3.1.4`) — Auto-reloading development server for Node.js.
* `eslint` (`^8.57.0`) — Code quality and syntax linter.
* `prettier` (`^3.2.5`) — Code formatter for HTML, CSS, JS, and Markdown.

---

## 3. Installation Step-by-Step

### Step 3.1: Clone or Navigate to the Repository
Open a terminal (PowerShell, Command Prompt, or Bash) and change directory into the project root:
```bash
cd "c:\Users\JEEVA\Desktop\TOKEN LINEAGE SYSTEM"
```

### Step 3.2: Install npm Dependencies
Install all workspace dependencies from the root directory:
```bash
npm install
```
This automatically installs root tools (ESLint, Prettier) as well as all dependencies in `server/package.json`.

---

## 4. Execution Mode 1: Instant Zero-Config Preview Mode
> **Recommended for frontend inspection, UI reviews, and immediate demonstrations without requiring a local PostgreSQL database.**

The repository includes a standalone preview server that mocks the REST API, serves all frontend screens, and simulates session states, token matching, and meeting scheduling.

### Start the Preview Server:
```bash
npm run preview
```
*(Or directly: `node scripts/preview.js`)*

### Access the Application in Your Browser:
The server runs on **port 3000**:
* **Home / Overview & Roadmap:** [http://localhost:3000/index.html](http://localhost:3000/index.html)
* **Member Dashboard:** [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html)
* **Mentor Discovery:** [http://localhost:3000/mentors.html](http://localhost:3000/mentors.html)
* **Mentorship Workspace & Meetings:** [http://localhost:3000/requests.html](http://localhost:3000/requests.html)
* **Batch Token Lineage:** [http://localhost:3000/lineage.html](http://localhost:3000/lineage.html)
* **Coordinator Operations Console:** [http://localhost:3000/admin.html](http://localhost:3000/admin.html)
* **Sign In:** [http://localhost:3000/login.html](http://localhost:3000/login.html)
* **Registration Wizard:** [http://localhost:3000/register.html](http://localhost:3000/register.html)

---

## 5. Execution Mode 2: Full-Stack Mode (Node.js + PostgreSQL)
> **Recommended for end-to-end testing with real database persistence, transactional sessions, and schema migrations.**

### Step 5.1: Create the PostgreSQL Database
Open your PostgreSQL shell (`psql` or pgAdmin) as superuser:
```sql
-- 1. Create dedicated application role
CREATE ROLE almatrace_app WITH LOGIN PASSWORD 'changeme_local';

-- 2. Create the development database
CREATE DATABASE almatrace_dev OWNER almatrace_app;

-- 3. Grant privileges
GRANT ALL PRIVILEGES ON DATABASE almatrace_dev TO almatrace_app;
```

### Step 5.2: Configure Environment Variables
Copy the template file to `.env`:
* **Windows (PowerShell):**
  ```powershell
  Copy-Item .env.example .env
  ```
* **macOS / Linux:**
  ```bash
  cp .env.example .env
  ```

Generate a secure 64-character random session secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Open `.env` and configure the following required parameters:
```env
NODE_ENV=development
PORT=3000
APP_BASE_URL=http://localhost:3000
APP_NAME=ALMATRACE

# Database connection string
DATABASE_URL=postgres://almatrace_app:changeme_local@localhost:5432/almatrace_dev

# Paste generated session secret here
SESSION_SECRET=paste_your_generated_64_char_hex_secret_here

# Synthetic token matching mode (safe sandbox)
TOKEN_RULE_MODE=synthetic
```

### Step 5.3: Run Database Migrations
Apply the 5 versioned SQL migrations to create the schema, tables, triggers, and indices:
```bash
npm run migrate
```
To check migration status:
```bash
npm run migrate:status
```

### Step 5.4: Seed Synthetic Test Data
Populate the database with synthetic MCA batches, token lineages, coordinator accounts, and mock mentors:
```bash
npm run seed
```

### Step 5.5: Launch the Server
* **For development with live reloading:**
  ```bash
  npm run dev
  ```
* **For standard production execution:**
  ```bash
  npm start
  ```

---

## 6. Synthetic Test Accounts (Development & Testing)

The seed script creates verified synthetic users for testing all product roles. **No real student records or personal data are used.**

| Role | Email | Password | Identifier / Sequence |
| :--- | :--- | :--- | :--- |
| **Student** | `synth.student1@almatrace.local` | `[SYNTHETIC]Dev@12345` | Roll No: `24MX001` (Seq: `001`) |
| **Alumni Mentor** | `synth.alumni1@almatrace.local` | `[SYNTHETIC]Dev@12345` | Roll No: `21MX001` (Seq: `001`) |
| **Coordinator (Admin)** | `coordinator@psgtech.ac.in` | `[SYNTHETIC]Dev@12345` | Institutional Admin |

---

## 7. Running Automated Test Suites

ALMATRACE features comprehensive automated tests covering authentication, rate limiting, capacity race conditions (`SELECT ... FOR UPDATE`), security headers, and token lineage parsing.

Execute the full Jest test suite:
```bash
npm test
```

### Test Suites Included:
1. `tests/auth.test.js` — User registration, bcrypt password hashing, session management, and RBAC authorization.
2. `tests/capacity.test.js` — Atomic concurrent mentorship acceptance preventing capacity race conditions.
3. `tests/health.test.js` — Health check endpoint, helmet security headers, and CORS validation.
4. `tests/tokenParser.test.js` — Token sequence extraction, edge cases, and deterministic match explanations.

To run code formatting and linting checks:
```bash
npm run lint
npm run format:check
```

---

## 8. Repository Structure

```
TOKEN LINEAGE SYSTEM/
├── client/
│   └── public/               # Semantic HTML, vanilla ES module JS, and CSS
│       ├── styles/
│       │   └── main.css      # Design tokens (palette: #F7F4EF, #0D3B2B, #8EB09B, #D9744B)
│       ├── js/
│       │   ├── services/api.js # Centralized ApiClient (CSRF handling, fetch wrapper)
│       │   └── app.js
│       ├── index.html        # Public homepage & 4-step tradition roadmap
│       ├── login.html        # Institutional login form
│       ├── register.html     # Multi-step registration wizard
│       ├── dashboard.html    # Member dashboard, next step banner, checklist
│       ├── lineage.html      # Batch token heritage timeline
│       ├── mentors.html      # Discovery search, topic filters, request modal
│       ├── requests.html     # Mentorship workspace, meeting scheduler, progress tracker
│       ├── admin.html        # Coordinator operations, queue, suppressed metrics
│       ├── privacy.html      # Privacy notice & disclosure policies
│       └── conduct.html      # Department code of conduct
├── server/
│   ├── migrations/           # 5 versioned SQL migration scripts
│   ├── scripts/
│   │   ├── migrate.js        # Migration runner (up/down/status)
│   │   └── seed.js           # Synthetic test data seeder
│   ├── src/
│   │   ├── config/           # Database pool, env validation with Zod
│   │   ├── middleware/       # RBAC auth, error handler, rate limits
│   │   ├── modules/
│   │   │   ├── admin/        # Verification queue, privacy metrics, audit logs
│   │   │   ├── auth/         # Bcrypt auth, sessions, registration
│   │   │   ├── matching/     # Token lineage engine, explainable scoring
│   │   │   └── mentorship/   # Request lifecycle, atomic capacity, meetings
│   │   └── server.js         # Express app entrypoint
│   └── tests/                # Automated Jest test suites
├── scripts/
│   └── preview.js            # Standalone zero-config frontend preview server
├── docs/
│   └── runbooks/             # Operational procedures (backup, deploy, incident, coordinator)
├── .env.example              # Environment variables template
├── package.json              # Root workspaces configuration
└── SETUP INSTRUCTIONS.md     # This comprehensive guide
```

---

## 9. Troubleshooting & Common Issues

### Issue 1: Port 3000 is already in use
* **Solution:** Change `PORT=3000` to another port (e.g., `PORT=3001`) in your `.env` file or run:
  ```powershell
  $env:PORT=3001; node scripts/preview.js
  ```

### Issue 2: PostgreSQL connection refused (`ECONNREFUSED 127.0.0.1:5432`)
* **Solution:** Verify that your local PostgreSQL service is running:
  * **Windows:** Open Services (`services.msc`) and check that `postgresql-x64-XX` is running.
  * Alternatively, use **Execution Mode 1** (`npm run preview`), which requires **no database**.

### Issue 3: PowerShell Script Execution Policy error
* If Windows PowerShell blocks executing npm commands, run:
  ```powershell
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  ```

---

## 10. Support & Institutional Inquiries

ALMATRACE is maintained by the Department of MCA at PSG College of Technology.
For operational assistance, refer to the documentation in `docs/runbooks/coordinator-guide.md` or contact the department faculty coordinator.
