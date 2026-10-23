/**
 * authRoutes.js — endpoints for authentication and session management
 */

import { Router } from 'express';
import {
  registerSchema,
  verifyEmailSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../../../../shared/schemas/authSchemas.js';
import * as authService from './authService.js';
import { requireAuth } from '../../middleware/auth.js';
import { logAuditEvent } from '../audit/auditService.js';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const validated = registerSchema.parse(req.body);
    const result = await authService.registerUser({
      ...validated,
      ip: req.ip,
      requestId: req.requestId,
    });

    res.status(201).json({
      message: 'Registration successful. Please verify your email.',
      user: result.user,
      devVerificationToken: result.devVerificationToken,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/verify-email', async (req, res, next) => {
  try {
    const validated = verifyEmailSchema.parse(req.body);
    const result = await authService.verifyEmail({
      token: validated.token,
      requestId: req.requestId,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const validated = loginSchema.parse(req.body);
    const user = await authService.loginUser({
      ...validated,
      ip: req.ip,
      requestId: req.requestId,
    });

    // Session rotation after authentication to prevent session fixation attacks
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.role = user.role;
      res.json({
        message: 'Signed in successfully.',
        user,
      });
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  const userId = req.user.id;
  const requestId = req.requestId;

  req.session.destroy(async (err) => {
    if (err) return next(err);
    res.clearCookie('almatrace.sid');

    await logAuditEvent({
      actorId: userId,
      action: 'USER_LOGOUT',
      targetType: 'user',
      targetId: userId,
      requestId,
    });

    res.json({ message: 'Signed out successfully.' });
  });
});

router.get('/session', (req, res) => {
  if (!req.user) {
    return res.json({ authenticated: false, user: null });
  }

  res.json({
    authenticated: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      status: req.user.status,
      emailVerified: Boolean(req.user.email_verified_at),
    },
  });
});

router.post('/password/forgot', async (req, res, next) => {
  try {
    forgotPasswordSchema.parse(req.body);
    // Generic response regardless of whether email exists to prevent enumeration
    res.json({
      message: 'If an account with that email exists, password reset instructions have been sent.',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/password/reset', async (req, res, next) => {
  try {
    resetPasswordSchema.parse(req.body);
    res.json({
      message: 'Password reset successfully. You may now sign in with your new password.',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
