# Backup and Restore Runbook — ALMATRACE

**Target RPO (Recovery Point Objective):** ≤ 24 hours (daily incremental or WAL archiving)  
**Target RTO (Recovery Time Objective):** ≤ 8 hours  
**Host:** Institutional / PSG IT approved environment (India region)

---

## 1. Automated Backups

### Daily Logical Dump (pg_dump)

Run via scheduled cron/task at 02:00 IST daily:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/almatrace"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${BACKUP_DIR}/almatrace_backup_${TIMESTAMP}.dump"

# Dump custom format with compression
pg_dump -Fc --no-owner --no-privileges -d "$DATABASE_URL" -f "$FILENAME"

# Encrypt backup at rest
gpg --batch --yes --encrypt --recipient "psg-backup-key@psgtech.ac.in" "$FILENAME"
rm -f "$FILENAME"

# Prune local backups older than 30 days
find "$BACKUP_DIR" -type f -name "*.dump.gpg" -mtime +30 -delete
```

---

## 2. Restore Procedure (Staging or Emergency Recovery)

### Step 1: Provision Clean Database

```bash
createdb -h localhost -U postgres almatrace_recovery
```

### Step 2: Decrypt the Selected Dump

```bash
gpg --decrypt /var/backups/almatrace/almatrace_backup_YYYYMMDD_HHMMSS.dump.gpg > /tmp/restore.dump
```

### Step 3: Execute pg_restore

```bash
pg_restore -h localhost -U postgres -d almatrace_recovery --clean --if-exists --no-owner /tmp/restore.dump
rm -f /tmp/restore.dump
```

### Step 4: Verify Database Health & Integrity

```bash
# Verify table counts and row presence
psql -d almatrace_recovery -c "SELECT COUNT(*) FROM users;"
psql -d almatrace_recovery -c "SELECT COUNT(*) FROM memberships;"
psql -d almatrace_recovery -c "SELECT COUNT(*) FROM audit_events;"
```

### Step 5: Switch Application Connection String

Update `DATABASE_URL` in the environment to point to `almatrace_recovery` and restart the Node.js application process.
