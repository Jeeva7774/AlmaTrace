/**
 * auth.test.js — unit tests for authentication schemas and password hashing
 */

import { hashPassword, verifyPassword } from '../src/modules/auth/passwords.js';
import {
  registerSchema,
  loginSchema,
  mentorSettingsSchema,
  updateProfileSchema,
} from '../../shared/schemas/authSchemas.js';

describe('passwords.js', () => {
  test('hashes password and verifies successfully', async () => {
    const raw = 'SecurePassword@123';
    const hash = await hashPassword(raw);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(raw);
    expect(hash.startsWith('$2')).toBe(true); // bcrypt prefix

    const isMatch = await verifyPassword(raw, hash);
    expect(isMatch).toBe(true);

    const isWrong = await verifyPassword('WrongPassword@999', hash);
    expect(isWrong).toBe(false);
  });

  test('returns false for null or empty hash', async () => {
    expect(await verifyPassword('Password@123', null)).toBe(false);
    expect(await verifyPassword('Password@123', '')).toBe(false);
  });
});

describe('authSchemas — registerSchema', () => {
  const validData = {
    email: 'student@psgtech.ac.in',
    password: 'Password@123',
    displayName: 'Student One',
    role: 'student',
    cohortId: '00000000-0000-0000-0000-000000000003',
    rawIdentifier: '24MX001',
    consentVersion: '1.0',
  };

  test('validates correct registration payload', () => {
    const result = registerSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  test('rejects password without numbers or uppercase letters', () => {
    const resNoUpper = registerSchema.safeParse({ ...validData, password: 'password123' });
    expect(resNoUpper.success).toBe(false);

    const resNoNum = registerSchema.safeParse({ ...validData, password: 'PasswordUpper' });
    expect(resNoNum.success).toBe(false);

    const resTooShort = registerSchema.safeParse({ ...validData, password: 'Pass1' });
    expect(resTooShort.success).toBe(false);
  });

  test('rejects invalid email address', () => {
    const res = registerSchema.safeParse({ ...validData, email: 'not-an-email' });
    expect(res.success).toBe(false);
  });

  test('normalizes email to lowercase and trims', () => {
    const res = registerSchema.parse({ ...validData, email: '  STUDENT@PSGTECH.AC.IN  ' });
    expect(res.email).toBe('student@psgtech.ac.in');
  });

  test('rejects roles other than student or alumni', () => {
    const res = registerSchema.safeParse({ ...validData, role: 'sysadmin' });
    expect(res.success).toBe(false);
  });
});

describe('authSchemas — mentorSettingsSchema', () => {
  test('validates valid mentor settings', () => {
    const res = mentorSettingsSchema.safeParse({
      available: true,
      maxMentees: 5,
      acceptingRequests: true,
      preferredModes: 'online',
      preferredLanguages: ['en', 'ta'],
      scheduleNote: 'Weekends after 6 PM IST',
    });
    expect(res.success).toBe(true);
  });

  test('rejects maxMentees exceeding limit (> 20)', () => {
    const res = mentorSettingsSchema.safeParse({ maxMentees: 25 });
    expect(res.success).toBe(false);
  });
});
