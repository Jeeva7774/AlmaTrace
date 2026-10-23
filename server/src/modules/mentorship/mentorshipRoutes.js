/**
 * mentorshipRoutes.js — mentorship requests, atomic capacity, meetings, reports, and blocks
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../../config/db.js';
import { requireAuth, requireVerified } from '../../middleware/auth.js';
import { createError } from '../../middleware/errorHandler.js';
import { logAuditEvent } from '../audit/auditService.js';

const router = Router();

router.use(requireAuth, requireVerified);

// ── 1. Mentorship Requests ──────────────────────────────────────────────────

// POST /api/v1/mentorship-requests — create request
router.post('/requests', async (req, res, next) => {
  try {
    const { mentorId, purpose, message, preferredMode = 'online', idempotencyKey } = req.body;

    if (!mentorId || !purpose || !idempotencyKey) {
      throw createError(400, 'VALIDATION_ERROR', 'mentorId, purpose, and idempotencyKey are required.');
    }

    if (mentorId === req.user.id) {
      throw createError(400, 'SELF_REQUEST', 'You cannot send a mentorship request to yourself.');
    }

    // Verify mentor exists, is verified alumni, and is accepting requests
    const mentorRes = await query(
      `SELECT u.id, u.status, ms.available, ms.accepting_requests, ms.max_mentees
       FROM users u
       JOIN mentor_settings ms ON ms.user_id = u.id
       WHERE u.id = $1 AND u.role = 'alumni' AND u.status = 'active'`,
      [mentorId]
    );

    if (mentorRes.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', 'Mentor not found or is currently not active.');
    }

    const mentor = mentorRes.rows[0];
    if (!mentor.available || !mentor.accepting_requests) {
      throw createError(400, 'MENTOR_UNAVAILABLE', 'This mentor is currently not accepting new requests.');
    }

    // Check for existing pending request
    const existingReq = await query(
      `SELECT id FROM mentorship_requests
       WHERE mentee_id = $1 AND mentor_id = $2 AND status = 'sent'`,
      [req.user.id, mentorId]
    );
    if (existingReq.rows.length > 0) {
      throw createError(409, 'PENDING_REQUEST_EXISTS', 'You already have an active request pending with this mentor.');
    }

    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14-day expiry

    const newReq = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO mentorship_requests
           (mentee_id, mentor_id, status, purpose, message, preferred_mode, idempotency_key, sent_at, expires_at)
         VALUES ($1, $2, 'sent', $3, $4, $5, $6, NOW(), $7)
         RETURNING *`,
        [req.user.id, mentorId, purpose.trim(), message ? message.trim() : null, preferredMode, idempotencyKey, expiresAt]
      );

      // Create in-app notification for mentor
      await client.query(
        `INSERT INTO notifications (user_id, type, title, body, ref_type, ref_id, dedupe_key)
         VALUES ($1, 'request_received', 'New Mentorship Request', 'You have received a new mentorship request.', 'mentorship_request', $2, $3)
         ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
        [mentorId, result.rows[0].id, `req_${result.rows[0].id}`]
      );

      return result.rows[0];
    });

    await logAuditEvent({
      actorId: req.user.id,
      action: 'MENTORSHIP_REQUEST_SENT',
      targetType: 'mentorship_request',
      targetId: newReq.id,
      requestId: req.requestId,
      metadata: { mentorId },
    });

    res.status(201).json({ request: newReq });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/mentorship-requests — list incoming/outgoing requests
router.get('/requests', async (req, res, next) => {
  try {
    const incoming = await query(
      `SELECT r.*, p.display_name AS mentee_name, p.headline AS mentee_headline
       FROM mentorship_requests r
       JOIN profiles p ON p.user_id = r.mentee_id
       WHERE r.mentor_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );

    const outgoing = await query(
      `SELECT r.*, p.display_name AS mentor_name, p.headline AS mentor_headline
       FROM mentorship_requests r
       JOIN profiles p ON p.user_id = r.mentor_id
       WHERE r.mentee_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );

    res.json({
      incoming: incoming.rows,
      outgoing: outgoing.rows,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/mentorship-requests/:id — accept, decline, or withdraw
router.patch('/requests/:id', async (req, res, next) => {
  try {
    const { action, declineReason } = req.body; // 'accept' | 'decline' | 'withdraw'
    const requestId = req.params.id;

    const reqRes = await query(
      `SELECT * FROM mentorship_requests WHERE id = $1`,
      [requestId]
    );

    if (reqRes.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', 'Request not found.');
    }

    const request = reqRes.rows[0];
    if (request.status !== 'sent') {
      throw createError(400, 'INVALID_STATE', `Cannot respond to a request with status '${request.status}'.`);
    }

    // Permission checks
    if (action === 'withdraw' && request.mentee_id !== req.user.id) {
      throw createError(403, 'FORBIDDEN', 'Only the sender can withdraw a request.');
    }
    if ((action === 'accept' || action === 'decline') && request.mentor_id !== req.user.id) {
      throw createError(403, 'FORBIDDEN', 'Only the mentor can accept or decline a request.');
    }

    if (action === 'withdraw') {
      await query(
        `UPDATE mentorship_requests SET status = 'withdrawn', updated_at = NOW() WHERE id = $1`,
        [requestId]
      );
      return res.json({ message: 'Request withdrawn successfully.', status: 'withdrawn' });
    }

    if (action === 'decline') {
      await query(
        `UPDATE mentorship_requests
         SET status = 'declined', decline_reason = $1, decided_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [declineReason ?? null, requestId]
      );
      return res.json({ message: 'Request declined.', status: 'declined' });
    }

    if (action === 'accept') {
      // ── ATOMIC CAPACITY PROTECTION ──────────────────────────────────────────
      // Use transaction + SELECT ... FOR UPDATE on mentor_settings to prevent race condition
      const mentorship = await withTransaction(async (client) => {
        // Lock mentor_settings row for update
        const settingsRes = await client.query(
          `SELECT max_mentees FROM mentor_settings WHERE user_id = $1 FOR UPDATE`,
          [request.mentor_id]
        );

        const maxMentees = settingsRes.rows[0]?.max_mentees ?? 3;

        // Count current active mentees under transaction
        const activeRes = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM mentorships
           WHERE mentor_id = $1 AND status = 'active'`,
          [request.mentor_id]
        );

        const currentActive = activeRes.rows[0].count;
        if (currentActive >= maxMentees) {
          throw createError(
            409,
            'CAPACITY_EXCEEDED',
            `You have reached your maximum active mentee capacity (${maxMentees}). Please complete or end an existing mentorship first.`
          );
        }

        // Update request status
        await client.query(
          `UPDATE mentorship_requests
           SET status = 'accepted', decided_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [requestId]
        );

        // Atomically create active mentorship relationship
        const shipRes = await client.query(
          `INSERT INTO mentorships (request_id, mentee_id, mentor_id, status, started_at)
           VALUES ($1, $2, $3, 'active', NOW())
           RETURNING *`,
          [requestId, request.mentee_id, request.mentor_id]
        );

        // Notify mentee
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body, ref_type, ref_id, dedupe_key)
           VALUES ($1, 'request_accepted', 'Mentorship Accepted!', 'Your mentor has accepted your request. You can now plan meetings.', 'mentorship', $2, $3)
           ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
          [request.mentee_id, shipRes.rows[0].id, `accept_${shipRes.rows[0].id}`]
        );

        return shipRes.rows[0];
      });

      await logAuditEvent({
        actorId: req.user.id,
        action: 'MENTORSHIP_ACCEPTED',
        targetType: 'mentorship',
        targetId: mentorship.id,
        requestId: req.requestId,
      });

      return res.json({
        message: 'Mentorship accepted successfully!',
        mentorship,
      });
    }

    throw createError(400, 'INVALID_ACTION', 'Action must be accept, decline, or withdraw.');
  } catch (err) {
    next(err);
  }
});

// ── 2. Mentorship Relationships ─────────────────────────────────────────────

// GET /api/v1/mentorship/relationships — list all user relationships
router.get('/relationships', async (req, res, next) => {
  try {
    const listRes = await query(
      `SELECT m.*,
              p_mentee.display_name AS mentee_name, p_mentee.headline AS mentee_headline,
              p_mentor.display_name AS mentor_name, p_mentor.headline AS mentor_headline,
              req.purpose, req.preferred_mode
       FROM mentorships m
       JOIN profiles p_mentee ON p_mentee.user_id = m.mentee_id
       JOIN profiles p_mentor ON p_mentor.user_id = m.mentor_id
       JOIN mentorship_requests req ON req.id = m.request_id
       WHERE m.mentee_id = $1 OR m.mentor_id = $1
       ORDER BY m.started_at DESC`,
      [req.user.id]
    );

    res.json({ relationships: listRes.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/mentorship/relationships/:id — view relationship
router.get('/relationships/:id', async (req, res, next) => {
  try {
    const shipRes = await query(
      `SELECT m.*,
              p_mentee.display_name AS mentee_name, p_mentor.display_name AS mentor_name,
              req.purpose, req.preferred_mode
       FROM mentorships m
       JOIN profiles p_mentee ON p_mentee.user_id = m.mentee_id
       JOIN profiles p_mentor ON p_mentor.user_id = m.mentor_id
       JOIN mentorship_requests req ON req.id = m.request_id
       WHERE m.id = $1`,
      [req.params.id]
    );

    if (shipRes.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', 'Mentorship relationship not found.');
    }

    const ship = shipRes.rows[0];
    if (ship.mentee_id !== req.user.id && ship.mentor_id !== req.user.id && req.user.role !== 'coordinator') {
      throw createError(403, 'FORBIDDEN', 'Access denied.');
    }

    const meetingsRes = await query(
      `SELECT * FROM meetings WHERE mentorship_id = $1 ORDER BY scheduled_at ASC`,
      [ship.id]
    );

    res.json({
      mentorship: ship,
      meetings: meetingsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/mentorships/:id — pause, resume, or end relationship
router.patch('/relationships/:id', async (req, res, next) => {
  try {
    const { action, endReason } = req.body; // 'pause' | 'resume' | 'end'
    const shipId = req.params.id;

    const shipRes = await query(`SELECT * FROM mentorships WHERE id = $1`, [shipId]);
    if (shipRes.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', 'Mentorship relationship not found.');
    }

    const ship = shipRes.rows[0];
    if (ship.mentee_id !== req.user.id && ship.mentor_id !== req.user.id && req.user.role !== 'coordinator') {
      throw createError(403, 'FORBIDDEN', 'Access denied.');
    }

    let nextStatus = ship.status;
    let updateFields = '';
    const params = [shipId];

    if (action === 'pause') {
      nextStatus = 'paused';
      updateFields = ', paused_at = NOW()';
    } else if (action === 'resume') {
      nextStatus = 'active';
      updateFields = ', paused_at = NULL';
    } else if (action === 'end') {
      nextStatus = 'ended';
      updateFields = `, ended_at = NOW(), end_reason = $2`;
      params.push(endReason || 'completed_naturally');
    } else {
      throw createError(400, 'INVALID_ACTION', 'Action must be pause, resume, or end.');
    }

    const result = await query(
      `UPDATE mentorships SET status = '${nextStatus}', updated_at = NOW() ${updateFields} WHERE id = $1 RETURNING *`,
      params
    );

    await logAuditEvent({
      actorId: req.user.id,
      action: `MENTORSHIP_${action.toUpperCase()}`,
      targetType: 'mentorship',
      targetId: shipId,
      requestId: req.requestId,
    });

    res.json({ message: `Mentorship ${action}d successfully.`, mentorship: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── 3. Meetings ─────────────────────────────────────────────────────────────

// POST /api/v1/mentorships/:id/meetings — propose meeting
router.post('/relationships/:id/meetings', async (req, res, next) => {
  try {
    const { scheduledAt, durationMinutes = 45, mode = 'online', locationOrLink, agenda, timeZone = 'Asia/Kolkata' } = req.body;
    const shipId = req.params.id;

    const shipRes = await query(`SELECT * FROM mentorships WHERE id = $1`, [shipId]);
    if (shipRes.rows.length === 0) throw createError(404, 'NOT_FOUND', 'Mentorship not found.');

    const ship = shipRes.rows[0];
    if (ship.mentee_id !== req.user.id && ship.mentor_id !== req.user.id) {
      throw createError(403, 'FORBIDDEN', 'Access denied.');
    }

    const result = await query(
      `INSERT INTO meetings
         (mentorship_id, proposed_by, status, scheduled_at, duration_minutes, mode, location_or_link, agenda, time_zone)
       VALUES ($1, $2, 'proposed', $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [shipId, req.user.id, scheduledAt, durationMinutes, mode, locationOrLink ?? null, agenda ?? null, timeZone]
    );

    res.status(201).json({ meeting: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/meetings/:id — confirm, reschedule, or cancel
router.patch('/meetings/:id', async (req, res, next) => {
  try {
    const { action, cancelReason, newScheduledAt } = req.body; // 'confirm' | 'cancel' | 'complete'
    const meetingId = req.params.id;

    const mRes = await query(
      `SELECT m.*, s.mentee_id, s.mentor_id
       FROM meetings m
       JOIN mentorships s ON s.id = m.mentorship_id
       WHERE m.id = $1`,
      [meetingId]
    );

    if (mRes.rows.length === 0) throw createError(404, 'NOT_FOUND', 'Meeting not found.');
    const meeting = mRes.rows[0];

    if (meeting.mentee_id !== req.user.id && meeting.mentor_id !== req.user.id) {
      throw createError(403, 'FORBIDDEN', 'Access denied.');
    }

    let status = meeting.status;
    let extra = '';
    const params = [meetingId];

    if (action === 'confirm') {
      status = 'confirmed';
      extra = ', confirmed_at = NOW()';
    } else if (action === 'cancel') {
      status = 'cancelled';
      extra = ', cancelled_at = NOW(), cancel_reason = $2';
      params.push(cancelReason || 'Cancelled by participant');
    } else if (action === 'complete') {
      status = 'completed';
      extra = ', completed_at = NOW()';
    }

    const result = await query(
      `UPDATE meetings SET status = '${status}', updated_at = NOW() ${extra} WHERE id = $1 RETURNING *`,
      params
    );

    res.json({ message: `Meeting ${action}ed.`, meeting: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/mentorship/meetings — list meetings for user
router.get('/meetings', async (req, res, next) => {
  try {
    const meetingsRes = await query(
      `SELECT mt.*,
              s.mentee_id, s.mentor_id,
              p_mentee.display_name AS mentee_name,
              p_mentor.display_name AS mentor_name,
              req.purpose
       FROM meetings mt
       JOIN mentorships s ON s.id = mt.mentorship_id
       JOIN profiles p_mentee ON p_mentee.user_id = s.mentee_id
       JOIN profiles p_mentor ON p_mentor.user_id = s.mentor_id
       JOIN mentorship_requests req ON req.id = s.request_id
       WHERE s.mentee_id = $1 OR s.mentor_id = $1
       ORDER BY mt.scheduled_at ASC`,
      [req.user.id]
    );

    res.json({ meetings: meetingsRes.rows });
  } catch (err) {
    next(err);
  }
});

// ── 4. Notifications ────────────────────────────────────────────────────────

// GET /api/v1/notifications
router.get('/notifications', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY read_at IS NULL DESC, created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ notifications: result.rows });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/notifications/:id/read
router.patch('/notifications/:id/read', async (req, res, next) => {
  try {
    await query(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── 5. Safety: Blocks and Reports ───────────────────────────────────────────

// POST /api/v1/blocks — block a user
router.post('/blocks', async (req, res, next) => {
  try {
    const { blockedUserId } = req.body;
    if (!blockedUserId || blockedUserId === req.user.id) {
      throw createError(400, 'INVALID_USER', 'Cannot block yourself or empty user.');
    }

    await query(
      `INSERT INTO blocks (blocker_id, blocked_id, active)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET active = TRUE`,
      [req.user.id, blockedUserId]
    );

    await logAuditEvent({
      actorId: req.user.id,
      action: 'USER_BLOCKED',
      targetType: 'user',
      targetId: blockedUserId,
      requestId: req.requestId,
    });

    res.json({ message: 'User blocked successfully.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/reports — confidential safety report
router.post('/reports', async (req, res, next) => {
  try {
    const { reportedUserId, mentorshipId, category, details } = req.body;
    if (!reportedUserId || !category) {
      throw createError(400, 'VALIDATION_ERROR', 'reportedUserId and category are required.');
    }

    const result = await query(
      `INSERT INTO reports (reporter_id, reported_user_id, mentorship_id, category, details, status)
       VALUES ($1, $2, $3, $4, $5, 'submitted')
       RETURNING id, category, status, created_at`,
      [req.user.id, reportedUserId, mentorshipId ?? null, category, details ?? null]
    );

    await logAuditEvent({
      actorId: req.user.id,
      action: 'SAFETY_REPORT_SUBMITTED',
      targetType: 'report',
      targetId: result.rows[0].id,
      requestId: req.requestId,
      metadata: { category },
    });

    res.status(201).json({
      message: 'Report submitted confidentially. A department coordinator will review it.',
      reportId: result.rows[0].id,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
