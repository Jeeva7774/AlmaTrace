# ALMATRACE — Department Coordinator Operations Guide

## 1. Role & Access

The Department Coordinator operates the ALMATRACE program for the Department of MCA, PSG College of Technology. The coordinator account has privileged access to:
- The Member Verification Queue (`/admin.html#panel-verify`)
- Department, Program, and Cohort configuration
- Aggregated operational analytics
- The immutable system audit log
- Confidential safety reports

---

## 2. Reviewing the Verification Queue

When an alumni member registers, their account is placed into a `pending_review` status until their institutional affiliation is confirmed:

1. Sign in to your coordinator account and open the **Admin Console** (`/admin.html`).
2. In the **Verification Queue**, each submission shows:
   - Full Name and Registered Email
   - Cohort / Graduating Batch (e.g. 2021–2023 MCA)
   - Submitted Token / Roll Number Identifier
3. Cross-reference the submitted roll number against the department's authorized alumni roll sheet or official records.
4. Click **Approve & Verify** to activate their account and enable them for mentorship discovery.
5. If the submission cannot be confirmed or contains errors, click **Reject**.

---

## 3. Managing Token Rules & Imports

- **Synthetic Rules (Current Development State):** Token matching currently operates in `synthetic` mode. Do not enable production matching until the department signs off the official roll number mapping formula (D1).
- **Importing Cohort Rosters:** Use the Dry-Run CSV import tool (`POST /api/v1/departments/imports/dry-run`). The dry run validates syntax, highlights duplicates, and prevents incomplete database corruption.

---

## 4. Monitoring Aggregate Program Health

Open the **Operations Metrics** tab on `/admin.html`. Metrics track:
- Total verified students and alumni
- Active, completed, and paused mentorship relationships
- Conversion rates on mentorship requests

*Note: Group categories with fewer than 5 individuals are automatically masked (`< 5`) to preserve participant privacy.*
