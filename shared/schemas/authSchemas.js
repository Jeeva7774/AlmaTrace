/**
 * authSchemas.js — shared validation schemas for authentication and identity
 *
 * Enforces input constraints at the server boundary. Client can also import
 * these schemas for inline validation hints.
 */

import { z } from 'zod';

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(320, 'Email cannot exceed 320 characters'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must not exceed 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  displayName: z
    .string()
    .trim()
    .min(2, 'Display name must be at least 2 characters')
    .max(100, 'Display name cannot exceed 100 characters'),
  role: z.enum(['student', 'alumni'], {
    errorMap: () => ({ message: 'Role must be student or alumni' }),
  }),
  cohortId: z.string().uuid('Valid cohort ID required'),
  rawIdentifier: z
    .string()
    .trim()
    .min(1, 'Token or roll number identifier is required')
    .max(50, 'Identifier is too long'),
  consentVersion: z.string().min(1, 'Consent document version is required'),
});

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(6, 'Verification code or token is required'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(6, 'Reset token is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must not exceed 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  headline: z.string().trim().max(200).optional().nullable(),
  bio: z.string().trim().max(1000).optional().nullable(),
  currentRole: z.string().trim().max(100).optional().nullable(),
  currentCompany: z.string().trim().max(100).optional().nullable(),
  timeZone: z.string().min(1).max(50).optional(),
  locale: z.string().min(2).max(10).optional(),
  visibility: z.enum(['discoverable', 'limited', 'hidden']).optional(),
  linkedinUrl: z
    .string()
    .url('Must be a valid URL')
    .regex(/^https:\/\/(www\.)?linkedin\.com\//, 'Must be a valid LinkedIn profile URL')
    .optional()
    .nullable(),
});

export const mentorSettingsSchema = z.object({
  available: z.boolean().optional(),
  maxMentees: z.number().int().min(0).max(20).optional(),
  acceptingRequests: z.boolean().optional(),
  preferredModes: z.enum(['online', 'in_person', 'either']).optional(),
  preferredLanguages: z.array(z.string()).min(1).optional(),
  scheduleNote: z.string().max(500).optional().nullable(),
  maxRequestsPerMonth: z.number().int().min(0).max(50).optional(),
});
