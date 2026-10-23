# Security Incident & Misconduct Response Runbook — ALMATRACE

## 1. Safety & Misconduct Reports

When a student or alumni submits a safety report through `POST /api/v1/reports`:

1. **Confidentiality:** The report is saved to `reports` and accessible only to Department Coordinators and System Administrators. The reported user receives **no notification** containing the reporter's identity.
2. **Immediate Mitigation (If Safety Risk):**
   - The coordinator may temporarily suspend the reported account:
     ```sql
     UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = 'TARGET_UUID';
     ```
   - Suspending the account immediately revokes all active sessions on their next request and prevents them from logging in or contacting members.
   - Immediate directional or mutual block:
     ```sql
     INSERT INTO blocks (blocker_id, blocked_id, active)
     VALUES ('REPORTER_UUID', 'REPORTED_UUID', TRUE)
     ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET active = TRUE;
     ```
3. **Escalation Path:**
   - Minor guidance misunderstandings: coordinator mediates privately.
   - Harassment, discrimination, or academic misconduct: escalate immediately to the designated Head of Department (MCA) and PSG Student Grievance / Disciplinary Authority per institutional policy.

---

## 2. Suspected Account Compromise

1. **Terminate All Sessions for Compromised User:**
   ```sql
   DELETE FROM user_sessions WHERE sess::text LIKE '%"userId":"COMPROMISED_UUID"%';
   ```
2. **Lock Account & Force Password Reset:**
   ```sql
   UPDATE users SET status = 'pending_review', locked_until = NOW() + INTERVAL '7 days' WHERE id = 'COMPROMISED_UUID';
   ```
3. **Inspect Audit Trail:**
   ```sql
   SELECT * FROM audit_events
   WHERE actor_id = 'COMPROMISED_UUID'
   ORDER BY created_at DESC;
   ```
