/**
 * adminRoutes.js — coordinator and administrative controls
 *
 * Implements verification queue, audit views, reports moderation,
 * and privacy-preserving aggregate metrics.
 */

import { Router } from 'express';
import { query, withTransaction } from '../../config/db.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createError } from '../../middleware/errorHandler.js';
import { logAuditEvent } from '../audit/auditService.js';

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

export default router;
