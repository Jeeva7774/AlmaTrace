-- 005_mentorship.sql
-- Mentorship requests, relationships, goals, meetings, recommendations,
-- reports, blocks, and notification tables.

-- ─────────────────────────────────────────────────────────────────────────────
-- mentor_recommendations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE mentor_recommendations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_version    TEXT        NOT NULL,   -- recommendation algorithm version
  score           NUMERIC(6,4),
  score_components JSONB,                 -- breakdown by criterion (no PII)
  explanation_codes TEXT[],              -- e.g. ['topic_overlap', 'goal_fit']
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,           -- user dismissed this recommendation

  CONSTRAINT chk_recommendations_not_self CHECK (requester_id != candidate_id)
);

CREATE INDEX idx_recommendations_requester ON mentor_recommendations (requester_id, generated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- mentorship_requests
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE request_status AS ENUM (
  'draft',
  'sent',
  'accepted',
  'declined',
  'withdrawn',
  'expired',
  'cancelled'
);

CREATE TABLE mentorship_requests (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  mentee_id           UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mentor_id           UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status              request_status  NOT NULL DEFAULT 'draft',
  purpose             TEXT            NOT NULL,
  message             TEXT,
  preferred_mode      meeting_mode,
  idempotency_key     TEXT            NOT NULL,   -- client-supplied to prevent duplicates
  sent_at             TIMESTAMPTZ,
  decided_at          TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  decline_reason      TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_requests_not_self CHECK (mentee_id != mentor_id),
  CONSTRAINT uq_requests_idempotency UNIQUE (idempotency_key),
  CONSTRAINT chk_requests_purpose CHECK (char_length(purpose) BETWEEN 1 AND 500),
  CONSTRAINT chk_requests_message CHECK (char_length(message) <= 1000)
);

CREATE INDEX idx_requests_mentee ON mentorship_requests (mentee_id, status);
CREATE INDEX idx_requests_mentor ON mentorship_requests (mentor_id, status);
CREATE INDEX idx_requests_status ON mentorship_requests (status, expires_at);

CREATE TRIGGER trg_requests_updated_at
  BEFORE UPDATE ON mentorship_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- mentorships
-- Active/historical mentoring relationships.
-- Only created when a request is accepted.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE mentorship_status AS ENUM (
  'active',
  'paused',
  'completed',
  'ended',
  'safety_review'
);

CREATE TABLE mentorships (
  id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      UUID                NOT NULL UNIQUE REFERENCES mentorship_requests(id) ON DELETE RESTRICT,
  mentee_id       UUID                NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mentor_id       UUID                NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status          mentorship_status   NOT NULL DEFAULT 'active',
  started_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  paused_at       TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  end_reason      TEXT,               -- high-level category, not narrative
  created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_mentorships_not_self CHECK (mentee_id != mentor_id)
);

CREATE INDEX idx_mentorships_mentee ON mentorships (mentee_id, status);
CREATE INDEX idx_mentorships_mentor ON mentorships (mentor_id, status);

CREATE TRIGGER trg_mentorships_updated_at
  BEFORE UPDATE ON mentorships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- mentorship_goals (optional MVP feature)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE mentorship_goals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mentorship_id   UUID        NOT NULL REFERENCES mentorships(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT,
  status          TEXT        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'in_progress', 'completed', 'dropped')),
  due_date        DATE,
  owner_id        UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_goals_updated_at
  BEFORE UPDATE ON mentorship_goals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- meetings
-- Proposed/confirmed meetings within a mentorship.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE meeting_status AS ENUM (
  'proposed',
  'confirmed',
  'cancelled',
  'completed',
  'rescheduled'
);

CREATE TABLE meetings (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  mentorship_id     UUID            NOT NULL REFERENCES mentorships(id) ON DELETE CASCADE,
  proposed_by       UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status            meeting_status  NOT NULL DEFAULT 'proposed',
  -- Times stored in UTC; display in user's time zone at render time
  scheduled_at      TIMESTAMPTZ,
  duration_minutes  INT             CHECK (duration_minutes BETWEEN 15 AND 480),
  time_zone         TEXT            NOT NULL DEFAULT 'Asia/Kolkata',
  mode              meeting_mode    NOT NULL DEFAULT 'online',
  location_or_link  TEXT,           -- external link or venue description (user-supplied)
  agenda            TEXT,
  confirmed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancel_reason     TEXT,
  completed_at      TIMESTAMPTZ,
  reschedules_from  UUID            REFERENCES meetings(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meetings_mentorship ON meetings (mentorship_id, scheduled_at);
CREATE INDEX idx_meetings_scheduled ON meetings (scheduled_at) WHERE status = 'confirmed';

CREATE TRIGGER trg_meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- notifications
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT        NOT NULL,   -- e.g. 'request_received', 'meeting_confirmed'
  title           TEXT        NOT NULL,
  body            TEXT,
  -- Reference to the relevant entity (opaque, no sensitive data here)
  ref_type        TEXT,                   -- e.g. 'mentorship_request'
  ref_id          UUID,
  dedupe_key      TEXT,                   -- prevent duplicate notifications
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_notifications_dedupe UNIQUE (user_id, dedupe_key)
);

CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- notification_deliveries
-- Tracks email/push delivery state for each notification.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE notification_deliveries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID        NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         TEXT        NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'in_app')),
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced', 'opted_out')),
  attempts        INT         NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at   TIMESTAMPTZ,
  provider_ref    TEXT,                    -- provider message ID for tracking
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deliveries_pending
  ON notification_deliveries (next_retry_at)
  WHERE status = 'pending';

CREATE TRIGGER trg_deliveries_updated_at
  BEFORE UPDATE ON notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- reports
-- Safety reports about users or relationships.
-- Report content is restricted to coordinator access only.
-- The reporter's identity is not automatically disclosed to the reported party.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE report_status AS ENUM (
  'submitted',
  'under_review',
  'resolved',
  'dismissed',
  'escalated'
);

CREATE TABLE reports (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reported_user_id  UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mentorship_id     UUID            REFERENCES mentorships(id) ON DELETE SET NULL,
  category          TEXT            NOT NULL,  -- e.g. 'harassment', 'misinformation'
  details           TEXT,           -- restricted; not shown in coordinator list view
  status            report_status   NOT NULL DEFAULT 'submitted',
  assigned_to       UUID            REFERENCES users(id) ON DELETE SET NULL,
  resolution        TEXT,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_reports_not_self CHECK (reporter_id != reported_user_id)
);

CREATE INDEX idx_reports_status ON reports (status, created_at DESC);
CREATE INDEX idx_reports_reported ON reports (reported_user_id);

CREATE TRIGGER trg_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- blocks
-- A block immediately prevents discovery and contact between two users.
-- Directional: blocker blocks blocked.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE blocks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_blocks_not_self CHECK (blocker_id != blocked_id),
  -- One active block per directional pair
  CONSTRAINT uq_blocks_active UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX idx_blocks_blocker ON blocks (blocker_id) WHERE active = TRUE;
CREATE INDEX idx_blocks_blocked ON blocks (blocked_id) WHERE active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- imports
-- Tracks bulk import operations (CSV uploads for cohorts/memberships).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE import_status AS ENUM (
  'uploaded',
  'validating',
  'preview_ready',
  'applying',
  'applied',
  'failed',
  'rolled_back'
);

CREATE TABLE imports (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by     UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  file_name       TEXT            NOT NULL,
  file_checksum   TEXT            NOT NULL,
  import_type     TEXT            NOT NULL,   -- e.g. 'cohort_memberships'
  status          import_status   NOT NULL DEFAULT 'uploaded',
  dry_run         BOOLEAN         NOT NULL DEFAULT TRUE,
  total_rows      INT,
  valid_rows      INT,
  error_rows      INT,
  applied_at      TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE import_rows (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id   UUID        NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_number  INT         NOT NULL,
  raw_data    JSONB       NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'valid', 'invalid', 'applied', 'skipped')),
  errors      JSONB,      -- array of { field, message }
  result_id   UUID,       -- ID of created/updated record on apply
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_import_rows_import ON import_rows (import_id, status);

CREATE TRIGGER trg_imports_updated_at
  BEFORE UPDATE ON imports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
