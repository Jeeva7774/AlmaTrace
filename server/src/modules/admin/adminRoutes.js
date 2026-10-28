/**
 * adminRoutes.js — coordinator and administrative controls
 *
 * Implements verification queue, audit views, reports moderation,
 * privacy-preserving aggregate metrics, and Excel member export.
 */

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import ExcelJS from 'exceljs';
import { query, withTransaction } from '../../config/db.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createError } from '../../middleware/errorHandler.js';
import { logAuditEvent } from '../audit/auditService.js';

// ── Formula-injection sanitizer ───────────────────────────────────────────────
// Prefixes any cell value that starts with =, +, -, or @ with a single quote
// so spreadsheet applications do not evaluate it as a formula.
const FORMULA_START = /^[=+\-@]/;
function sanitizeCell(v) {
  if (v === null || v === undefined) return '';
  const str = String(v);
  return FORMULA_START.test(str) ? `'${str}` : str;
}

const router = Router();

// Restrict all routes in this router to coordinator or sysadmin
router.use(requireAuth, requireRole('coordinator', 'sysadmin'));

// ── GET /api/v1/admin/verifications — pending verification queue ─────────
router.get('/verifications', async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT m.id, m.user_id, m.member_type, m.raw_identifier, m.normalized_token_key,
              m.affiliation_status, m.created_at,
              u.email, u.status AS user_status,
              p.display_name,
              c.admission_year, c.graduation_year, c.label AS cohort_label,
              prog.name AS program_name, d.name AS department_name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       JOIN profiles p ON p.user_id = u.id
       JOIN cohorts c ON c.id = m.cohort_id
       JOIN programs prog ON prog.id = c.program_id
       JOIN departments d ON d.id = prog.department_id
       WHERE m.affiliation_status IN ('unverified', 'pending')
       ORDER BY m.created_at ASC`
    );

    res.json({
      verifications: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/admin/verifications/:id/decision — approve or reject ─────
router.post('/verifications/:id/decision', async (req, res, next) => {
  try {
    const membershipId = req.params.id;
    const { decision, notes } = req.body; // 'verified' | 'rejected'

    if (!['verified', 'rejected'].includes(decision)) {
      throw createError(400, 'INVALID_DECISION', "Decision must be 'verified' or 'rejected'.");
    }

    const membershipRes = await query(
      `SELECT m.id, m.user_id, m.member_type, u.email
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.id = $1`,
      [membershipId]
    );

    if (membershipRes.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', 'Membership record not found.');
    }

    const membership = membershipRes.rows[0];

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE memberships
         SET affiliation_status = $1,
             affiliation_verified_at = NOW(),
             affiliation_reviewer_id = $2,
             notes = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [decision, req.user.id, notes ?? null, membershipId]
      );

      // If approved, update user account status to 'active'
      if (decision === 'verified') {
        await client.query(
          `UPDATE users
           SET status = 'active', updated_at = NOW()
           WHERE id = $1 AND status != 'suspended'`,
          [membership.user_id]
        );
      }
    });

    await logAuditEvent({
      actorId: req.user.id,
      action: decision === 'verified' ? 'MEMBERSHIP_VERIFIED' : 'MEMBERSHIP_REJECTED',
      targetType: 'membership',
      targetId: membershipId,
      requestId: req.requestId,
      metadata: { targetUserId: membership.user_id, memberType: membership.member_type },
    });

    res.json({
      message: `Membership ${decision} successfully.`,
      membershipId,
      status: decision,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/admin/audit-logs — append-only audit trail ────────────────
router.get('/audit-logs', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const action = req.query.action;

    let sql = `
      SELECT a.id, a.actor_id, a.action, a.target_type, a.target_id,
             a.request_id, a.metadata, a.created_at,
             u.email AS actor_email
      FROM audit_events a
      LEFT JOIN users u ON u.id = a.actor_id
    `;
    const params = [];

    if (action) {
      sql += ` WHERE a.action = $1`;
      params.push(action);
    }

    sql += ` ORDER BY a.id DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);
    res.json({ auditEvents: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/admin/metrics — privacy-preserving aggregate metrics ──────
router.get('/metrics', async (_req, res, next) => {
  try {
    // Suppress small group counts (< 5) per product principle
    const userCounts = await query(`
      SELECT role, status, COUNT(*)::int AS count
      FROM users
      GROUP BY role, status
    `);

    const mentorshipCounts = await query(`
      SELECT status, COUNT(*)::int AS count
      FROM mentorships
      GROUP BY status
    `);

    const requestCounts = await query(`
      SELECT status, COUNT(*)::int AS count
      FROM mentorship_requests
      GROUP BY status
    `);

    const meetingsCount = await query(`
      SELECT status, COUNT(*)::int AS count
      FROM meetings
      GROUP BY status
    `);

    // Mask any metric category with fewer than 5 members to protect privacy
    const sanitizeCounts = (rows) =>
      rows.map((r) => ({
        ...r,
        count: r.count < 5 ? '< 5' : r.count,
      }));

    res.json({
      users: sanitizeCounts(userCounts.rows),
      mentorships: sanitizeCounts(mentorshipCounts.rows),
      requests: sanitizeCounts(requestCounts.rows),
      meetings: sanitizeCounts(meetingsCount.rows),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/admin/reports — safety reports ────────────────────────────
router.get('/reports', async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT r.id, r.reporter_id, r.reported_user_id, r.category, r.status,
              r.created_at, r.resolved_at,
              u_reporter.email AS reporter_email,
              u_reported.email AS reported_email
       FROM reports r
       JOIN users u_reporter ON u_reporter.id = r.reporter_id
       JOIN users u_reported ON u_reported.id = r.reported_user_id
       ORDER BY r.created_at DESC`
    );
    res.json({ reports: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── Rate limiter for the export endpoint (5 requests / 5 min per IP) ─────────
const exportRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Export rate limit exceeded. Try again in 5 minutes.' },
});

// ── GET /api/v1/admin/export/members — Excel member export ───────────────────
router.get('/export/members', exportRateLimit, async (req, res, next) => {
  try {
    const ALLOWED_CATEGORIES = new Set(['all', 'students', 'alumni']);
    const category = (req.query.category || 'all').toLowerCase();

    if (!ALLOWED_CATEGORIES.has(category)) {
      throw createError(
        400,
        'INVALID_CATEGORY',
        "Query parameter 'category' must be 'students', 'alumni', or 'all'."
      );
    }

    // Resolve member_type filter value (DB stores 'student'/'alumni' singular)
    const memberTypeFilter = category === 'students' ? 'student'
                           : category === 'alumni'   ? 'alumni'
                           : null; // null → 'all'

    // Build parameterized query
    const baseSql = `
      SELECT
        p.display_name,
        u.email,
        m.normalized_token_key,
        c.label AS cohort_label,
        prog.name AS program_name,
        d.name AS department_name,
        m.member_type,
        m.affiliation_status,
        u.status AS account_status,
        u.created_at AS registered_at,
        p.headline,
        p.current_role,
        p.current_company,
        p.linkedin_url,
        p.time_zone,
        ms.available AS mentor_available,
        ms.accepting_requests,
        ms.max_mentees
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      JOIN profiles p ON p.user_id = u.id
      JOIN cohorts c ON c.id = m.cohort_id
      JOIN programs prog ON prog.id = c.program_id
      JOIN departments d ON d.id = prog.department_id
      LEFT JOIN mentor_settings ms ON ms.user_id = u.id
      WHERE u.deleted_at IS NULL
        AND m.is_primary = TRUE
    `;

    let sql, params;
    if (memberTypeFilter === null) {
      sql = baseSql + ` ORDER BY m.member_type, p.display_name`;
      params = [];
    } else {
      sql = baseSql + ` AND m.member_type = $1 ORDER BY m.member_type, p.display_name`;
      params = [memberTypeFilter];
    }

    const result = await query(sql, params);
    const rows = result.rows;
    const recordCount = rows.length;

    // ── Build workbook ────────────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ALMATRACE Admin';
    workbook.created = new Date();

    // Shared header style
    const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D3B2B' } };
    const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

    // ── Students sheet ────────────────────────────────────────────────────────
    const studentSheet = workbook.addWorksheet('Students');
    studentSheet.columns = [
      { header: 'Member Display Name',       key: 'display_name',        width: 28 },
      { header: 'Email (admin-only ⚠)',      key: 'email',               width: 32 },
      { header: 'Token Key',                 key: 'normalized_token_key', width: 14 },
      { header: 'Cohort Label',              key: 'cohort_label',         width: 22 },
      { header: 'Program Name',              key: 'program_name',         width: 34 },
      { header: 'Department Name',           key: 'department_name',      width: 28 },
      { header: 'Affiliation Status',        key: 'affiliation_status',   width: 18 },
      { header: 'Account Status',            key: 'account_status',       width: 16 },
      { header: 'Registered At',             key: 'registered_at',        width: 22 },
      { header: 'Profile Headline',          key: 'headline',             width: 40 },
      { header: 'Time Zone',                 key: 'time_zone',            width: 20 },
    ];
    studentSheet.getRow(1).fill = HEADER_FILL;
    studentSheet.getRow(1).font = HEADER_FONT;

    // ── Alumni sheet ──────────────────────────────────────────────────────────
    const alumniSheet = workbook.addWorksheet('Alumni');
    alumniSheet.columns = [
      { header: 'Member Display Name',       key: 'display_name',        width: 28 },
      { header: 'Email (admin-only ⚠)',      key: 'email',               width: 32 },
      { header: 'Token Key',                 key: 'normalized_token_key', width: 14 },
      { header: 'Cohort Label',              key: 'cohort_label',         width: 22 },
      { header: 'Program Name',              key: 'program_name',         width: 34 },
      { header: 'Department Name',           key: 'department_name',      width: 28 },
      { header: 'Affiliation Status',        key: 'affiliation_status',   width: 18 },
      { header: 'Account Status',            key: 'account_status',       width: 16 },
      { header: 'Registered At',             key: 'registered_at',        width: 22 },
      { header: 'Profile Headline',          key: 'headline',             width: 40 },
      { header: 'Current Role',              key: 'current_role',         width: 28 },
      { header: 'Current Company',           key: 'current_company',      width: 28 },
      { header: 'LinkedIn URL',              key: 'linkedin_url',         width: 36 },
      { header: 'Mentor Available',          key: 'mentor_available',     width: 16 },
      { header: 'Accepting Requests',        key: 'accepting_requests',   width: 18 },
      { header: 'Max Mentees',               key: 'max_mentees',          width: 13 },
      { header: 'Time Zone',                 key: 'time_zone',            width: 20 },
    ];
    alumniSheet.getRow(1).fill = HEADER_FILL;
    alumniSheet.getRow(1).font = HEADER_FONT;

    // ── Populate rows ─────────────────────────────────────────────────────────
    let studentCount = 0;
    let alumniCount  = 0;

    for (const row of rows) {
      const isStudent = row.member_type === 'student';
      const registeredAt = row.registered_at
        ? new Date(row.registered_at).toISOString().replace('T', ' ').slice(0, 19)
        : '';

      if (isStudent) {
        studentCount++;
        studentSheet.addRow({
          display_name:         sanitizeCell(row.display_name),
          email:                sanitizeCell(row.email),
          normalized_token_key: sanitizeCell(row.normalized_token_key),
          cohort_label:         sanitizeCell(row.cohort_label),
          program_name:         sanitizeCell(row.program_name),
          department_name:      sanitizeCell(row.department_name),
          affiliation_status:   sanitizeCell(row.affiliation_status),
          account_status:       sanitizeCell(row.account_status),
          registered_at:        registeredAt,
          headline:             sanitizeCell(row.headline),
          time_zone:            sanitizeCell(row.time_zone),
        });
      } else {
        alumniCount++;
        alumniSheet.addRow({
          display_name:         sanitizeCell(row.display_name),
          email:                sanitizeCell(row.email),
          normalized_token_key: sanitizeCell(row.normalized_token_key),
          cohort_label:         sanitizeCell(row.cohort_label),
          program_name:         sanitizeCell(row.program_name),
          department_name:      sanitizeCell(row.department_name),
          affiliation_status:   sanitizeCell(row.affiliation_status),
          account_status:       sanitizeCell(row.account_status),
          registered_at:        registeredAt,
          headline:             sanitizeCell(row.headline),
          current_role:         sanitizeCell(row.current_role),
          current_company:      sanitizeCell(row.current_company),
          linkedin_url:         sanitizeCell(row.linkedin_url),
          mentor_available:     row.mentor_available === true  ? 'Yes'
                              : row.mentor_available === false ? 'No' : '',
          accepting_requests:   row.accepting_requests === true  ? 'Yes'
                              : row.accepting_requests === false ? 'No' : '',
          max_mentees:          row.max_mentees ?? '',
          time_zone:            sanitizeCell(row.time_zone),
        });
      }
    }

    // ── Empty-result note rows ────────────────────────────────────────────────
    if (studentCount === 0 && (category === 'students' || category === 'all')) {
      studentSheet.addRow({ display_name: 'No records found for the selected category.' });
    }
    if (alumniCount === 0 && (category === 'alumni' || category === 'all')) {
      alumniSheet.addRow({ display_name: 'No records found for the selected category.' });
    }

    // ── Audit log (no row data logged) ────────────────────────────────────────
    const exportedFields = category === 'alumni'
      ? ['display_name', 'email', 'normalized_token_key', 'cohort_label', 'program_name',
         'department_name', 'affiliation_status', 'account_status', 'registered_at',
         'headline', 'current_role', 'current_company', 'linkedin_url',
         'mentor_available', 'accepting_requests', 'max_mentees', 'time_zone']
      : category === 'students'
      ? ['display_name', 'email', 'normalized_token_key', 'cohort_label', 'program_name',
         'department_name', 'affiliation_status', 'account_status', 'registered_at',
         'headline', 'time_zone']
      : ['display_name', 'email', 'normalized_token_key', 'cohort_label', 'program_name',
         'department_name', 'member_type', 'affiliation_status', 'account_status',
         'registered_at', 'headline', 'current_role', 'current_company', 'linkedin_url',
         'mentor_available', 'accepting_requests', 'max_mentees', 'time_zone'];

    await logAuditEvent({
      actorId:    req.user.id,
      action:     'ADMIN_EXPORT_MEMBERS',
      targetType: 'export',
      targetId:   null,
      requestId:  req.requestId,
      metadata:   { category, recordCount, fields: exportedFields },
    });

    // ── Write response ────────────────────────────────────────────────────────
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="almatrace-members-${dateStr}.xlsx"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

export default router;
