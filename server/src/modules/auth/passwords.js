/**
 * passwords.js — secure password hashing and verification
 *
 * Uses bcryptjs with a cost factor of 12 for strong protection against
 * brute-force / dictionary attacks.
 */

import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plainText) {
  return bcrypt.hash(plainText, BCRYPT_ROUNDS);
}

export async function verifyPassword(plainText, hash) {
  if (!hash) return false;
  return bcrypt.compare(plainText, hash);
}
