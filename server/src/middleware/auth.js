/**
 * auth.js — authentication and authorization middleware
 *
 * Enforces role-based access control (RBAC) and ownership verification
 * on the server boundary.
 */

import { query } from '../config/db.js';
import { createError } from './errorHandler.js';

export async function authenticateSession(req, _res, next) {
  if (!req.session?.userId) {
    req.user = null;
    return next();
  }

  try {
    const result = await query(
      `SELECT id, email, email_normalized, role, status, email_verified_at, deactivated_at
       FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      // Session exists for nonexistent or deleted user
      req.session.destroy();
      req.user = null;
      return next();
    }

    const user = result.rows[0];
    if (user.status === 'suspended' || user.status === 'deactivated') {
      req.session.destroy();
      req.user = null;
      return next(createError(403, 'ACCOUNT_INACTIVE', 'This account is suspended or deactivated.'));
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.user) {
    return next(createError(401, 'UNAUTHORIZED', 'Authentication required. Please sign in.'));
  }
  next();
}

export function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(createError(401, 'UNAUTHORIZED', 'Authentication required.'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        createError(
          403,
          'FORBIDDEN',
          'You do not have permission to perform this action.'
        )
      );
    }
    next();
  };
}

export function requireVerified(req, _res, next) {
  if (!req.user) {
    return next(createError(401, 'UNAUTHORIZED', 'Authentication required.'));
  }
  if (req.user.status === 'pending_verification') {
    return next(
      createError(
        403,
        'VERIFICATION_REQUIRED',
        'Please verify your institutional email address to continue.'
      )
    );
  }
  if (req.user.status !== 'active') {
    return next(
      createError(
        403,
        'ACCOUNT_RESTRICTED',
        'Your account is currently under coordinator review or restricted.'
      )
    );
  }
  next();
}
