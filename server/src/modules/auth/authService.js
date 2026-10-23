/**
 * authService.js — user registration, verification, session management
 */

import crypto from 'crypto';
import { withTransaction, query } from '../../config/db.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { logAuditEvent } from '../audit/auditService.js';
import { createError } from '../../middleware/errorHandler.js';
import config from '../../config/env.js';
import logger from '../../config/logger.js';

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function registerUser({
  email,
  password,
  displayName,
  role,
  cohortId,
  rawIdentifier,
  consentVersion,
  ip = null,
  requestId = null,
}) {
  const normalizedEmail = email.toLowerCase().trim();

  // Verify cohort exists and is active
  const cohortRes = await query(
    `SELECT id, program_id, enrollment_open FROM cohorts WHERE id = $1`,
    [cohortId]
  );
  if (cohortRes.rows.length === 0) {
    throw createError(400, 'INVALID_COHORT', 'The selected cohort does not exist.');
  }
  if (!cohortRes.rows[0].enrollment_open) {
    throw createError(400, 'COHORT_CLOSED', 'Enrollment for the selected cohort is currently closed.');
  }

  // Check existing user
  const existingRes = await query(
    `SELECT id FROM users WHERE email_normalized = $1 AND deleted_at IS NULL`,
    [normalizedEmail]
  );
  if (existingRes.rows.length > 0) {
    throw createError(409, 'EMAIL_EXISTS', 'An account with this email address already exists.');
  }

  const pwdHash = await hashPassword(password);
  const normalizedTokenKey = rawIdentifier.trim().toUpperCase();

  // Generate 6-digit or 32-byte verification token
  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = sha256(rawToken);
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  const newUser = await withTransaction(async (client) => {
    // 1. Create user
    const userRes = await client.query(
      `INSERT INTO users (email, email_normalized, role, status, password_hash)
       VALUES ($1, $2, $3, 'pending_verification', $4)
       RETURNING id, email, role, status, created_at`,
      [email.trim(), normalizedEmail, role, pwdHash]
    );
    const user = userRes.rows[0];

    // 2. Create profile
    await client.query(
      `INSERT INTO profiles (user_id, display_name, visibility)
       VALUES ($1, $2, 'discoverable')`,
      [user.id, displayName.trim()]
    );

    // 3. Create membership (students auto-verify upon email verification; alumni pending coordinator review)
    await client.query(
      `INSERT INTO memberships
         (user_id, cohort_id, member_type, raw_identifier, normalized_token_key, affiliation_status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [user.id, cohortId, role, rawIdentifier.trim(), normalizedTokenKey]
    );

    // 4. If alumni, initialize default mentor_settings
    if (role === 'alumni') {
      await client.query(
        `INSERT INTO mentor_settings (user_id, available, max_mentees, accepting_requests)
         VALUES ($1, TRUE, 3, TRUE)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id]
      );
    }

    // 5. Record consent
    await client.query(
      `INSERT INTO consent_records (user_id, document_type, document_version, action, source, ip_address)
       VALUES ($1, 'privacy_notice_and_conduct', $2, 'accepted', 'registration_wizard', $3)`,
      [user.id, consentVersion, ip]
    );

    // 6. Store verification token
    await client.query(
      `INSERT INTO email_verifications (user_id, purpose, token_hash, expires_at)
       VALUES ($1, 'email_verification', $2, $3)`,
      [user.id, tokenHash, tokenExpiresAt]
    );

    return user;
  });

  await logAuditEvent({
    actorId: newUser.id,
    action: 'USER_REGISTERED',
    targetType: 'user',
    targetId: newUser.id,
    requestId,
    metadata: { role },
  });

  // Transactional email dispatch or log in development
  logger.info({ userId: newUser.id, email: normalizedEmail }, 'User registered');
  if (config.NODE_ENV !== 'production') {
    logger.info({ userId: newUser.id, rawToken }, 'DEV: Email verification token');
  }

  return {
    user: newUser,
    // Return token in non-production environments to enable automated testing/local dev
    devVerificationToken: config.NODE_ENV !== 'production' ? rawToken : undefined,
  };
}

export async function verifyEmail({ token, requestId = null }) {
  const tokenHash = sha256(token.trim());

  const recordRes = await query(
    `SELECT ev.id, ev.user_id, ev.expires_at, ev.used_at, u.role, u.status
     FROM email_verifications ev
     JOIN users u ON u.id = ev.user_id
     WHERE ev.token_hash = $1 AND ev.purpose = 'email_verification'`,
    [tokenHash]
  );

  if (recordRes.rows.length === 0) {
    throw createError(400, 'INVALID_TOKEN', 'The verification token is invalid or does not exist.');
  }

  const record = recordRes.rows[0];
  if (record.used_at) {
    throw createError(400, 'TOKEN_ALREADY_USED', 'This verification token has already been used.');
  }
  if (new Date(record.expires_at) < new Date()) {
    throw createError(400, 'TOKEN_EXPIRED', 'This verification token has expired. Please request a new one.');
  }

  // Determine user status:
  // For students, verifying institutional email marks account as active and membership verified.
  // For alumni, email is verified, but account status remains pending coordinator review if policy requires.
  const isStudent = record.role === 'student';
  const nextUserStatus = isStudent ? 'active' : 'pending_review';
  const nextAffiliationStatus = isStudent ? 'verified' : 'pending';

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE email_verifications
       SET used_at = NOW()
       WHERE id = $1`,
      [record.id]
    );

    await client.query(
      `UPDATE users
       SET email_verified_at = NOW(),
           status = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [nextUserStatus, record.user_id]
    );

    if (isStudent) {
      await client.query(
        `UPDATE memberships
         SET affiliation_status = $1,
             affiliation_verified_at = NOW(),
             updated_at = NOW()
         WHERE user_id = $2 AND is_primary = TRUE`,
        [nextAffiliationStatus, record.user_id]
      );
    }
  });

  await logAuditEvent({
    actorId: record.user_id,
    action: 'EMAIL_VERIFIED',
    targetType: 'user',
    targetId: record.user_id,
    requestId,
    metadata: { nextUserStatus },
  });

  return {
    verified: true,
    userStatus: nextUserStatus,
    message: isStudent
      ? 'Email verified successfully. Welcome to ALMATRACE!'
      : 'Email verified. Your alumni affiliation is pending coordinator review.',
  };
}

export async function loginUser({ email, password, ip = null, requestId = null }) {
  const normalizedEmail = email.toLowerCase().trim();

  const userRes = await query(
    `SELECT id, email, password_hash, role, status, failed_login_count, locked_until
     FROM users
     WHERE email_normalized = $1 AND deleted_at IS NULL`,
    [normalizedEmail]
  );

  if (userRes.rows.length === 0) {
    // Timing safe dummy comparison to prevent username enumeration
    await verifyPassword(password, '$2a$12$e80yq9x9H1dYqS0n2hGg2u0q1w7r4z9t6m8k0j2l4p6s8u0v2w4y6');
    throw createError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const user = userRes.rows[0];

  // Check account lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    throw createError(
      429,
      'ACCOUNT_LOCKED',
      `Too many failed login attempts. Account is temporarily locked. Try again in ${minutesLeft} minute(s).`
    );
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    const newCount = (user.failed_login_count || 0) + 1;
    const lockUntil = newCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;

    await query(
      `UPDATE users
       SET failed_login_count = $1,
           locked_until = $2
       WHERE id = $3`,
      [newCount, lockUntil, user.id]
    );

    throw createError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (user.status === 'suspended') {
    throw createError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended by an administrator.');
  }
  if (user.status === 'deactivated') {
    throw createError(403, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated. Contact support to reactivate.');
  }

  // Successful login — reset lockouts
  await query(
    `UPDATE users
     SET failed_login_count = 0,
         locked_until = NULL,
         last_login_at = NOW(),
         last_login_ip = $1
     WHERE id = $2`,
    [ip, user.id]
  );

  await logAuditEvent({
    actorId: user.id,
    action: 'USER_LOGIN',
    targetType: 'user',
    targetId: user.id,
    requestId,
  });

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  };
}
