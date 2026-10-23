-- 002_users.sql
-- Core users table and supporting tables for authentication, sessions,
-- consent records, and the audit event trail.
--
-- Design notes:
--   • UUIDs as PKs for all externally referenced entities (plan requirement).
--   • Email stored lowercase-normalized to prevent duplicate accounts.
--   • Password hash stored separately from profile data (defence in depth).
--   • Never store plaintext passwords or reversible tokens.
--   • Audit events use SERIAL for ordered append-only inserts; they are never
--     updated or deleted (enforced by restricted database role permissions in
--     production, not just application logic).
--   • user_sessions is managed by connect-pg-simple; the schema matches its
--     expected format.

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUM types
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM (
  'student',
  'alumni',
  'coordinator',
  'sysadmin'
);

CREATE TYPE user_status AS ENUM (
  'pending_verification',  -- email not yet verified
  'active',                -- normal active account
  'pending_review',        -- flagged for coordinator review
  'suspended',             -- temporarily restricted by coordinator
  'deactivated',           -- user-requested deactivation
  'deleted'                -- anonymised; kept for referential integrity
);

CREATE TYPE verification_status AS ENUM (
  'unverified',            -- not yet reviewed
  'pending',               -- submitted, awaiting coordinator review
  'verified',              -- approved by coordinator
  'rejected',              -- rejected; user may resubmit
  'expired'                -- verification evidence lapsed
);

-- ─────────────────────────────────────────────────────────────────────────────
-- users
-- ─────────────────────────────────────────────────────────────────────────────
-- Authentication identity. Keep separate from the public-facing profile.
-- Role may expand: a person can hold both student and alumni roles
-- via the memberships table; the primary role here is for global access control.

CREATE TABLE users (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT          NOT NULL,
  email_normalized    TEXT          NOT NULL,  -- lowercase, trimmed
  role                user_role     NOT NULL DEFAULT 'student',
  status              user_status   NOT NULL DEFAULT 'pending_verification',
  password_hash       TEXT,                    -- NULL if using SSO (D2)
  email_verified_at   TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  last_login_ip       INET,                    -- hashed or masked in prod
  failed_login_count  INT           NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deactivated_at      TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,

  -- Prevent multiple accounts for the same email
  CONSTRAINT uq_users_email_normalized UNIQUE (email_normalized),
  -- Deleted accounts lose email uniqueness to allow re-registration
  -- (handled at application layer with soft delete)
  CONSTRAINT chk_users_email_length CHECK (char_length(email_normalized) <= 320)
);

-- Index for login lookup
CREATE INDEX idx_users_email_normalized ON users (email_normalized);
-- Index for coordinator verification queue and status filters
CREATE INDEX idx_users_status ON users (status);
CREATE INDEX idx_users_role ON users (role);

-- ─────────────────────────────────────────────────────────────────────────────
-- email_verifications
-- One-time tokens for email verification and password reset.
-- Tokens are hashed on storage so a DB read does not reveal a usable value.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE verification_purpose AS ENUM (
  'email_verification',
  'password_reset'
);

CREATE TABLE email_verifications (
  id          UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID                  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     verification_purpose  NOT NULL,
  token_hash  TEXT                  NOT NULL,  -- SHA-256 of the raw token
  expires_at  TIMESTAMPTZ           NOT NULL,
  used_at     TIMESTAMPTZ,                     -- NULL = not yet used
  created_at  TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

  -- At most one active (unused) token per user per purpose
  CONSTRAINT chk_email_verifications_expiry CHECK (expires_at > created_at)
);

CREATE INDEX idx_email_verifications_user_purpose
  ON email_verifications (user_id, purpose)
  WHERE used_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- user_sessions
-- Managed by connect-pg-simple. Schema must match the library's expectations.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE user_sessions (
  sid     TEXT          NOT NULL PRIMARY KEY,
  sess    JSONB         NOT NULL,
  expire  TIMESTAMPTZ   NOT NULL
);

CREATE INDEX idx_user_sessions_expire ON user_sessions (expire);

-- ─────────────────────────────────────────────────────────────────────────────
-- consent_records
-- Record when a user accepted/withdrew consent for a specific document version.
-- Required for GDPR/privacy compliance audit trail.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE consent_records (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document_type   TEXT        NOT NULL,  -- e.g. 'privacy_notice', 'code_of_conduct'
  document_version TEXT       NOT NULL,  -- e.g. '1.0', '2026-10'
  action          TEXT        NOT NULL CHECK (action IN ('accepted', 'withdrawn')),
  accepted_at     TIMESTAMPTZ,
  withdrawn_at    TIMESTAMPTZ,
  source          TEXT        NOT NULL,  -- e.g. 'registration_wizard', 'settings_page'
  ip_address      INET,                  -- masked or hashed in production
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_consent_records_user ON consent_records (user_id, document_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_events
-- Append-only log of privileged and security-relevant actions.
-- In production, the application DB role should NOT have UPDATE/DELETE on this table.
-- Use a separate audit role for reads.
--
-- Logged: role changes, verification decisions, account suspension/deletion,
--         token rule changes, imports, report resolutions, session termination.
-- NOT logged: passwords, session tokens, roll numbers, report narratives,
--             private meeting notes, or unnecessary request bodies.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE audit_events (
  id            BIGSERIAL     PRIMARY KEY,  -- ordered insert for reliable log ordering
  actor_id      UUID          REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT          NOT NULL,     -- e.g. 'USER_VERIFIED', 'ROLE_CHANGED'
  target_type   TEXT,                       -- e.g. 'user', 'membership', 'token_rule'
  target_id     TEXT,                       -- opaque string ID of the target record
  request_id    TEXT,                       -- from X-Request-ID header
  metadata      JSONB,                      -- safe key/value pairs (no PII)
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index for coordinator audit log queries
CREATE INDEX idx_audit_events_actor ON audit_events (actor_id, created_at DESC);
CREATE INDEX idx_audit_events_target ON audit_events (target_type, target_id, created_at DESC);
CREATE INDEX idx_audit_events_action ON audit_events (action, created_at DESC);

-- Prevent application role from deleting audit events
-- (This REVOKE must be run by a superuser after table creation in production)
-- REVOKE DELETE ON audit_events FROM almatrace_app;
-- REVOKE UPDATE ON audit_events FROM almatrace_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger helper
-- Automatically keeps updated_at current for tables that include it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
