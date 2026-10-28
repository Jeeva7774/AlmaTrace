/**
 * matchingRoutes.js — token lineage timeline and alternative mentor recommendations
 */

import { Router } from 'express';
import { query } from '../../config/db.js';
import { requireAuth, requireVerified } from '../../middleware/auth.js';
import { createError } from '../../middleware/errorHandler.js';

const router = Router();

// ── GET /api/v1/me/token-lineage — read own token identity and visible lineage ──
router.get('/token-lineage', requireAuth, requireVerified, async (req, res, next) => {
  try {
    // 1. Get user's primary membership
    const myMemRes = await query(
      `SELECT m.id, m.cohort_id, m.member_type, m.normalized_token_key,
              c.admission_year, c.graduation_year, c.label AS cohort_label,
              prog.id AS program_id, prog.name AS program_name, d.code AS department_code
       FROM memberships m
       JOIN cohorts c ON c.id = m.cohort_id
       JOIN programs prog ON prog.id = c.program_id
       JOIN departments d ON d.id = prog.department_id
       WHERE m.user_id = $1 AND m.is_primary = TRUE`,
      [req.user.id]
    );

    if (myMemRes.rows.length === 0) {
      throw createError(404, 'MEMBERSHIP_NOT_FOUND', 'No active cohort membership found for this user.');
    }

    const myMembership = myMemRes.rows[0];

    // 2. Query all cohorts in the same program to construct the lineage timeline
    const allCohortsRes = await query(
      `SELECT c.id, c.admission_year, c.graduation_year, c.label, c.cohort_type
       FROM cohorts c
       WHERE c.program_id = $1 AND c.eligible_for_matching = TRUE
       ORDER BY c.admission_year DESC`,
      [myMembership.program_id]
    );

    // 3. Find registered counterparts with the same normalized_token_key
    const counterpartsRes = await query(
      `SELECT m.id AS membership_id, m.cohort_id, m.normalized_token_key, m.affiliation_status,
              u.id AS user_id, u.status AS user_status,
              p.display_name, p.headline, p.current_role, p.current_company, p.visibility,
              ms.available AS mentor_available, ms.accepting_requests
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       JOIN profiles p ON p.user_id = u.id
       LEFT JOIN mentor_settings ms ON ms.user_id = u.id
       WHERE m.cohort_id = ANY($1)
         AND m.normalized_token_key = $2
         AND m.user_id != $3`,
      [allCohortsRes.rows.map((c) => c.id), myMembership.normalized_token_key, req.user.id]
    );

    const counterpartMap = new Map();
    for (const cp of counterpartsRes.rows) {
      counterpartMap.set(cp.cohort_id, cp);
    }

    // Check blocks
    const blockedRes = await query(
      `SELECT blocked_id FROM blocks WHERE blocker_id = $1 AND active = TRUE
       UNION
       SELECT blocker_id FROM blocks WHERE blocked_id = $1 AND active = TRUE`,
      [req.user.id]
    );
    const blockedSet = new Set(blockedRes.rows.map((r) => r.blocked_id));

    // 4. Construct lineage timeline across cohorts
    const timeline = allCohortsRes.rows.map((cohort) => {
      const isMyCohort = cohort.id === myMembership.cohort_id;
      const cp = counterpartMap.get(cohort.id);

      if (isMyCohort) {
        return {
          cohortId: cohort.id,
          cohortLabel: cohort.label,
          admissionYear: cohort.admission_year,
          graduationYear: cohort.graduation_year,
          state: 'self',
          tokenKey: myMembership.normalized_token_key,
          details: 'Your cohort membership',
        };
      }

      if (!cp) {
        return {
          cohortId: cohort.id,
          cohortLabel: cohort.label,
          admissionYear: cohort.admission_year,
          graduationYear: cohort.graduation_year,
          state: 'unregistered',
          tokenKey: myMembership.normalized_token_key,
          details: 'No registered counterpart in this batch yet.',
        };
      }

      if (blockedSet.has(cp.user_id)) {
        return {
          cohortId: cohort.id,
          cohortLabel: cohort.label,
          state: 'unavailable',
          details: 'Profile unavailable.',
        };
      }

      let state = 'active';
      if (cp.user_status === 'deactivated' || cp.user_status === 'suspended') {
        state = 'inactive';
      } else if (cp.affiliation_status !== 'verified') {
        state = 'pending_verification';
      } else if (cp.visibility === 'hidden') {
        state = 'hidden';
      }

      return {
        cohortId: cohort.id,
        cohortLabel: cohort.label,
        admissionYear: cohort.admission_year,
        graduationYear: cohort.graduation_year,
        state,
        tokenKey: cp.normalized_token_key,
        counterpart: {
          userId: cp.user_id,
          displayName: state === 'active' ? cp.display_name : '[Hidden/Pending]',
          headline: state === 'active' ? cp.headline : null,
          currentRole: state === 'active' ? cp.current_role : null,
          currentCompany: state === 'active' ? cp.current_company : null,
          acceptingRequests: Boolean(cp.accepting_requests && cp.mentor_available),
        },
      };
    });

    res.json({
      tokenLineage: {
        department: myMembership.department_code,
        canonicalTokenKey: myMembership.normalized_token_key,
        ruleMode: 'synthetic',
        notice: 'Historical lineage view. A token link represents historical association, not consent to mentorship.',
        timeline,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/mentors/recommendations — explainable alternative mentors ──
router.get('/recommendations', requireAuth, requireVerified, async (req, res, next) => {
  try {
    // 1. Get requester interests & preferences
    const reqInterests = await query(
      `SELECT interest_id FROM profile_interests WHERE user_id = $1 AND direction = 'seeking'`,
      [req.user.id]
    );
    const myInterestIds = new Set(reqInterests.rows.map((r) => r.interest_id));

    const myProfileRes = await query(
      `SELECT time_zone, locale FROM profiles WHERE user_id = $1`,
      [req.user.id]
    );
    const myProfile = myProfileRes.rows[0] || {};

    // 2. Fetch eligible candidates:
    // - Verified alumni only
    // - Active account
    // - Discoverable visibility
    // - Available and accepting requests in mentor_settings
    // - Capacity check: active mentees < max_mentees
    // - Exclude users with mutual blocks
    const candidatesRes = await query(
      `SELECT u.id AS user_id, u.email,
              p.display_name, p.headline, p.bio, p.current_role, p.current_company,
              p.time_zone, p.locale,
              ms.max_mentees, ms.preferred_modes, ms.preferred_languages, ms.schedule_note,
              m.normalized_token_key,
              COALESCE(
                (SELECT COUNT(*)::int FROM mentorships WHERE mentor_id = u.id AND status = 'active'),
                0
              ) AS active_mentee_count
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       JOIN mentor_settings ms ON ms.user_id = u.id
       JOIN memberships m ON m.user_id = u.id AND m.is_primary = TRUE AND m.affiliation_status = 'verified'
       WHERE u.role = 'alumni'
         AND u.status = 'active'
         AND p.visibility = 'discoverable'
         AND ms.available = TRUE
         AND ms.accepting_requests = TRUE
         AND u.id != $1
         AND u.id NOT IN (
           SELECT blocked_id FROM blocks WHERE blocker_id = $1 AND active = TRUE
           UNION
           SELECT blocker_id FROM blocks WHERE blocked_id = $1 AND active = TRUE
         )`,
      [req.user.id]
    );

    // 3. For each candidate, fetch their offering interests & compute explainable score
    const scoredCandidates = [];

    for (const c of candidatesRes.rows) {
      // Enforce capacity filter
      if (c.active_mentee_count >= c.max_mentees) {
        continue;
      }

      const cInterestsRes = await query(
        `SELECT i.name, pi.interest_id
         FROM profile_interests pi
         JOIN interests i ON i.id = pi.interest_id
         WHERE pi.user_id = $1 AND pi.direction = 'offering'`,
        [c.user_id]
      );

      const candidateInterests = cInterestsRes.rows;
      const commonInterests = candidateInterests.filter((ci) => myInterestIds.has(ci.interest_id));

      // Calculate score breakdown (per plan weights):
      // Topic overlap: 35%
      const topicScore = myInterestIds.size > 0
        ? Math.min(commonInterests.length / Math.max(myInterestIds.size, 1), 1.0) * 0.35
        : 0.15; // default baseline if requester hasn't specified topics

      // Goal / capacity availability fit: 25%
      const capacityRatio = (c.max_mentees - c.active_mentee_count) / Math.max(c.max_mentees, 1);
      const capacityScore = capacityRatio * 0.25;

      // Language overlap: 10%
      const langScore = (c.preferred_languages || []).includes(myProfile.locale || 'en') ? 0.10 : 0.05;

      // Meeting mode / time zone overlap: 10%
      const timeZoneScore = c.time_zone === (myProfile.time_zone || 'Asia/Kolkata') ? 0.10 : 0.05;

      // Activity / willingness: 20%
      const activityScore = 0.20;

      const totalScore = topicScore + capacityScore + langScore + timeZoneScore + activityScore;

      // Build explainable human-readable rationale
      const reasons = [];
      if (commonInterests.length > 0) {
        reasons.push(`Shared guidance topics: ${commonInterests.map((i) => i.name).join(', ')}`);
      }
      if (c.max_mentees - c.active_mentee_count >= 2) {
        reasons.push('Has available mentorship capacity this semester');
      }
      if (timeZoneScore === 0.10) {
        reasons.push('Convenient matching time zone');
      }

      scoredCandidates.push({
        mentor: {
          userId: c.user_id,
          displayName: c.display_name,
          headline: c.headline,
          currentRole: c.current_role,
          currentCompany: c.current_company,
          preferredModes: c.preferred_modes,
          scheduleNote: c.schedule_note,
          availableSlots: c.max_mentees - c.active_mentee_count,
        },
        score: Math.round(totalScore * 100) / 100,
        explanation: reasons.length > 0 ? reasons.join('. ') : 'Verified alumni mentor with open capacity.',
      });
    }

    // Sort by deterministic score descending
    scoredCandidates.sort((a, b) => b.score - a.score);

    res.json({
      recommendations: scoredCandidates.slice(0, 20),
      count: scoredCandidates.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
