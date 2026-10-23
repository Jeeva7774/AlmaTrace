/**
 * auditService.js — append-only audit logging
 *
 * Records privileged, administrative, and security-critical actions.
 * Never logs passwords, session tokens, exact roll numbers, report narratives,
 * or unnecessary profile/request bodies.
 */

import { query } from '../../config/db.js';
import logger from '../../config/logger.js';

export async function logAuditEvent({
  actorId = null,
  action,
  targetType = null,
  targetId = null,
  requestId = null,
  metadata = {},
}) {
  try {
    await query(
      `INSERT INTO audit_events (actor_id, action, target_type, target_id, request_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorId, action, targetType, targetId ? String(targetId) : null, requestId, JSON.stringify(metadata)]
    );
  } catch (err) {
    // Audit logging failure should be noted but avoid crashing the user request
    logger.error({ err, action, targetType, targetId }, 'Failed to record audit event');
  }
}
