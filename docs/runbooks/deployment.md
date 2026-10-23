# Deployment & Rollback Runbook — ALMATRACE

## 1. Pre-Deployment Verification

Before triggering deployment to staging or production:

1. **Check Working Tree & Status:**
   ```bash
   git status
   ```
2. **Run All Automated Tests:**
   ```bash
   npm test
   ```
   Must pass 100% of test suites with zero failures.
3. **Verify Pending Migrations:**
   ```bash
   node server/scripts/migrate.js status
   ```
4. **Environment Audit:**
   Ensure all required variables in `.env.example` are present and securely populated in the target environment secret manager.

---

## 2. Deployment Steps

1. **Pull Release Artifact / Git Tag:**
   ```bash
   git fetch --tags
   git checkout tags/v1.0.0
   ```
2. **Install Production Dependencies:**
   ```bash
   npm ci --omit=dev
   ```
3. **Run Database Migrations:**
   ```bash
   node server/scripts/migrate.js up
   ```
4. **Restart Application Service:**
   ```bash
   # If using systemd:
   sudo systemctl restart almatrace
   # If using PM2:
   pm2 reload almatrace
   ```
5. **Verify Readiness Probe:**
   ```bash
   curl -f http://localhost:3000/api/v1/health/ready
   ```
   Must return HTTP 200 with `status: "ready"` and `database: "ok"`.

---

## 3. Rollback Procedure

If health checks fail or severe regression occurs:

1. **Revert Application Code:**
   ```bash
   git checkout tags/v_PREVIOUS_KNOWN_GOOD
   npm ci --omit=dev
   sudo systemctl restart almatrace
   ```
2. **Database Schema Considerations:**
   ALMATRACE migrations follow expand-and-contract principles. Backward-incompatible column deletions are never run in the same release as application updates. Forward repair migrations should be deployed rather than raw schema rollbacks where user data may be stranded.
