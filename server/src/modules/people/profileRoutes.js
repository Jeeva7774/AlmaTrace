/**
 * profileRoutes.js — endpoints for personal profile, preferences, and discovery
 */

import { Router } from 'express';
import { query, withTransaction } from '../../config/db.js';
import { requireAuth, requireVerified } from '../../middleware/auth.js';
import { updateProfileSchema, mentorSettingsSchema } from '../../../../shared/schemas/authSchemas.js';
import { createError } from '../../middleware/errorHandler.js';
import { logAuditEvent } from '../audit/auditService.js';

const router = Router();

// ── GET /api/v1/me — own profile and settings ─────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const profileRes = await query(
      `SELECT p.display_name, p.headline, p.bio, p.current_role, p.current_company,
              p.locale, p.time_zone, p.visibility, p.avatar_url, p.linkedin_url,
              p.created_at, p.updated_at
       FROM profiles p
       WHERE p.user_id = $1`,
      [req.user.id]
    );

    const membershipsRes = await query(
      `SELECT m.id, m.member_type, m.normalized_token_key, m.affiliation_status,
              m.is_primary, c.admission_year, c.graduation_year, c.label AS cohort_label,
              prog.name AS program_name, prog.degree, d.name AS department_name, d.code AS department_code
       FROM memberships m
       JOIN cohorts c ON c.id = m.cohort_id
       JOIN programs prog ON prog.id = c.program_id
       JOIN departments d ON d.id = prog.department_id
       WHERE m.user_id = $1
       ORDER BY m.is_primary DESC, c.admission_year DESC`,
      [req.user.id]
    );

    let mentorSettings = null;
    if (req.user.role === 'alumni') {
      const msRes = await query(
        `SELECT available, max_mentees, accepting_requests, preferred_modes,
                preferred_languages, schedule_note, max_requests_per_month
         FROM mentor_settings
         WHERE user_id = $1`,
        [req.user.id]
      );
      mentorSettings = msRes.rows[0] ?? null;
    }

    const interestsRes = await query(
      `SELECT i.id, i.name, i.slug, i.group_name, pi.direction
       FROM profile_interests pi
       JOIN interests i ON i.id = pi.interest_id
       WHERE pi.user_id = $1`,
      [req.user.id]
    );

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        status: req.user.status,
      },
      profile: profileRes.rows[0] ?? null,
      memberships: membershipsRes.rows,
      mentorSettings,
      interests: interestsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/v1/me — update own profile ─────────────────────────────────
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const validated = updateProfileSchema.parse(req.body);

    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, val] of Object.entries(validated)) {
      if (val !== undefined) {
        const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
        fields.push(`${col} = $${idx}`);
        values.push(val);
        idx++;
      }
    }

    if (fields.length === 0) {
      return res.json({ message: 'No changes provided.' });
    }

    values.push(req.user.id);
    const sql = `UPDATE profiles SET ${fields.join(', ')}, updated_at = NOW() WHERE user_id = $${idx} RETURNING *`;
    const result = await query(sql, values);

    await logAuditEvent({
      actorId: req.user.id,
      action: 'PROFILE_UPDATED',
      targetType: 'profile',
      targetId: req.user.id,
      requestId: req.requestId,
    });

    res.json({ message: 'Profile updated successfully.', profile: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/v1/me/mentor-settings ──────────────────────────────────────
router.patch('/me/mentor-settings', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'alumni' && req.user.role !== 'coordinator') {
      throw createError(403, 'FORBIDDEN', 'Only alumni mentors have mentor settings.');
    }

    const validated = mentorSettingsSchema.parse(req.body);
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, val] of Object.entries(validated)) {
      if (val !== undefined) {
        const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
        fields.push(`${col} = $${idx}`);
        values.push(val);
        idx++;
      }
    }

    if (fields.length === 0) {
      return res.json({ message: 'No changes provided.' });
    }

    values.push(req.user.id);
    const sql = `
      INSERT INTO mentor_settings (user_id, available, max_mentees, accepting_requests)
      VALUES ($${idx}, TRUE, 3, TRUE)
      ON CONFLICT (user_id) DO UPDATE SET ${fields.join(', ')}, updated_at = NOW()
      RETURNING *`;
    const result = await query(sql, values);

    res.json({ message: 'Mentor settings updated.', settings: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/profiles/:userId — view another user's profile ────────────
router.get('/profiles/:userId', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const targetUserId = req.params.userId;

    // Check if target user has blocked current user or vice versa
    const blockRes = await query(
      `SELECT 1 FROM blocks
       WHERE ((blocker_id = $1 AND blocked_id = $2)
          OR  (blocker_id = $2 AND blocked_id = $1))
         AND active = TRUE`,
      [req.user.id, targetUserId]
    );

    if (blockRes.rows.length > 0) {
      throw createError(404, 'NOT_FOUND', 'Profile not found.');
    }

    const result = await query(
      `SELECT p.display_name, p.headline, p.bio, p.current_role, p.current_company,
              p.locale, p.time_zone, p.visibility, p.avatar_url, p.linkedin_url,
              u.role, u.status,
              ms.available AS mentor_available, ms.accepting_requests, ms.preferred_modes,
              ms.schedule_note
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN mentor_settings ms ON ms.user_id = u.id
       WHERE p.user_id = $1 AND u.status = 'active' AND u.deleted_at IS NULL`,
      [targetUserId]
    );

    if (result.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', 'Profile not found or currently unavailable.');
    }

    const profile = result.rows[0];

    // Privacy filter
    if (profile.visibility === 'hidden' && req.user.role !== 'coordinator') {
      throw createError(404, 'NOT_FOUND', 'Profile is not discoverable.');
    }

    // Never return personal email, exact roll numbers, or private notes
    res.json({
      profile: {
        userId: targetUserId,
        displayName: profile.display_name,
        headline: profile.headline,
        bio: profile.bio,
        currentRole: profile.current_role,
        currentCompany: profile.current_company,
        timeZone: profile.time_zone,
        avatarUrl: profile.avatar_url,
        linkedinUrl: profile.linkedin_url,
        role: profile.role,
        mentorSettings: profile.role === 'alumni' ? {
          available: profile.mentor_available,
          acceptingRequests: profile.accepting_requests,
          preferredModes: profile.preferred_modes,
          scheduleNote: profile.schedule_note,
        } : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/me/deactivate ────────────────────────────────────────────
router.post('/me/deactivate', requireAuth, async (req, res, next) => {
  try {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users
         SET status = 'deactivated', deactivated_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [req.user.id]
      );

      // End active mentorships safely
      await client.query(
        `UPDATE mentorships
         SET status = 'ended', ended_at = NOW(), end_reason = 'user_deactivated', updated_at = NOW()
         WHERE (mentee_id = $1 OR mentor_id = $1) AND status = 'active'`,
        [req.user.id]
      );
    });

    await logAuditEvent({
      actorId: req.user.id,
      action: 'USER_DEACTIVATED',
      targetType: 'user',
      targetId: req.user.id,
      requestId: req.requestId,
    });

    req.session.destroy(() => {
      res.clearCookie('almatrace.sid');
      res.json({ message: 'Account deactivated successfully.' });
    });
  } catch (err) {
    next(err);
  }
});

export default router;
