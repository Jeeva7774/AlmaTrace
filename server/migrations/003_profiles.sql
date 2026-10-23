-- 003_profiles.sql
-- User profiles, department/program/cohort structure, memberships,
-- interests catalog, and mentor settings.
--
-- Profiles are separate from users (authentication) to support
-- the privacy principle of separating identity from public-facing data.

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUM types
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE profile_visibility AS ENUM (
  'discoverable',       -- visible to all verified members
  'limited',            -- visible only to active mentees/mentors
  'hidden'              -- not discoverable; profile owner only
);

CREATE TYPE member_type AS ENUM (
  'student',
  'alumni'
);

CREATE TYPE meeting_mode AS ENUM (
  'online',
  'in_person',
  'either'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles
-- Public-facing profile data. Separate from users (authentication).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  user_id         UUID              PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name    TEXT              NOT NULL,
  headline        TEXT,                           -- short role/tagline
  bio             TEXT,
  current_role    TEXT,
  current_company TEXT,
  locale          TEXT              NOT NULL DEFAULT 'en',
  time_zone       TEXT              NOT NULL DEFAULT 'Asia/Kolkata',
  visibility      profile_visibility NOT NULL DEFAULT 'discoverable',
  avatar_url      TEXT,                           -- relative path only; no external URLs
  linkedin_url    TEXT,                           -- optional; user-controlled
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_profiles_display_name CHECK (char_length(display_name) BETWEEN 1 AND 100),
  CONSTRAINT chk_profiles_bio CHECK (char_length(bio) <= 1000),
  CONSTRAINT chk_profiles_headline CHECK (char_length(headline) <= 200)
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- departments
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE departments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  code          TEXT        NOT NULL,    -- e.g. 'MCA', 'ME'
  institution   TEXT        NOT NULL DEFAULT 'PSG College of Technology',
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_departments_code UNIQUE (code),
  CONSTRAINT chk_departments_code CHECK (char_length(code) BETWEEN 1 AND 20)
);

CREATE TRIGGER trg_departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- programs
-- A program belongs to a department (e.g. "MCA Full-Time")
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE programs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   UUID        NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  name            TEXT        NOT NULL,
  degree          TEXT,                    -- e.g. 'M.C.A.', 'M.Tech'
  duration_years  INT         NOT NULL DEFAULT 2 CHECK (duration_years BETWEEN 1 AND 6),
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_programs_updated_at
  BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- cohorts
-- An academic batch within a program (identified by admission year).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE cohorts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id        UUID        NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
  admission_year    INT         NOT NULL,
  graduation_year   INT         NOT NULL,
  label             TEXT        NOT NULL,    -- display label e.g. "2023–2025 MCA"
  cohort_type       TEXT        NOT NULL DEFAULT 'regular'
                                CHECK (cohort_type IN ('regular', 'lateral', 'part_time')),
  enrollment_open   BOOLEAN     NOT NULL DEFAULT TRUE,
  eligible_for_matching BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_cohorts_program_year UNIQUE (program_id, admission_year, cohort_type),
  CONSTRAINT chk_cohorts_years CHECK (graduation_year > admission_year)
);

CREATE INDEX idx_cohorts_program ON cohorts (program_id);

CREATE TRIGGER trg_cohorts_updated_at
  BEFORE UPDATE ON cohorts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- memberships
-- Links a user to a department/program/cohort with their token identifier.
-- A user may have multiple memberships (e.g. student and then alumni).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE memberships (
  id                    UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID                NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cohort_id             UUID                NOT NULL REFERENCES cohorts(id) ON DELETE RESTRICT,
  member_type           member_type         NOT NULL,
  raw_identifier        TEXT                NOT NULL,   -- as entered by user (do not log)
  normalized_token_key  TEXT                NOT NULL,   -- canonical form for matching
  identifier_rule_version TEXT,                         -- which token rule was used to normalize
  affiliation_status    verification_status NOT NULL DEFAULT 'unverified',
  affiliation_verified_at TIMESTAMPTZ,
  affiliation_reviewer_id UUID              REFERENCES users(id) ON DELETE SET NULL,
  is_primary            BOOLEAN             NOT NULL DEFAULT TRUE,
  notes                 TEXT,                           -- coordinator notes (restricted)
  created_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  -- A user should have at most one active primary membership per cohort/type
  CONSTRAINT uq_memberships_primary
    UNIQUE NULLS NOT DISTINCT (user_id, cohort_id, member_type)
    DEFERRABLE INITIALLY DEFERRED,

  -- Normalized token key must be unique within a cohort/type
  -- (CONFIRMED unique only after token rule is approved — D1)
  CONSTRAINT chk_memberships_token_key CHECK (char_length(normalized_token_key) BETWEEN 1 AND 50)
);

-- Do not create a unique constraint on normalized_token_key yet —
-- wait until D1 (token rule) is confirmed and duplicates are resolved.
-- Interim: add a partial unique index on verified memberships only.
CREATE UNIQUE INDEX idx_memberships_token_key_verified
  ON memberships (cohort_id, member_type, normalized_token_key)
  WHERE affiliation_status = 'verified';

CREATE INDEX idx_memberships_user ON memberships (user_id);
CREATE INDEX idx_memberships_cohort ON memberships (cohort_id, member_type);
CREATE INDEX idx_memberships_normalized_token ON memberships (normalized_token_key);

CREATE TRIGGER trg_memberships_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- interests
-- Curated catalog of topics/interest areas for matching.
-- Populated by coordinators; not user-generated free text.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE interests (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL,
  group_name  TEXT,                     -- optional grouping e.g. 'Software Development'
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_interests_slug UNIQUE (slug),
  CONSTRAINT chk_interests_slug CHECK (slug ~ '^[a-z0-9-]+$')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- profile_interests
-- Links a user to interests, with a direction (seeking guidance vs. offering).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE interest_direction AS ENUM (
  'seeking',    -- student wants guidance on this topic
  'offering'    -- mentor offers guidance on this topic
);

CREATE TABLE profile_interests (
  user_id     UUID                NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_id UUID                NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
  direction   interest_direction  NOT NULL,
  created_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, interest_id, direction)
);

CREATE INDEX idx_profile_interests_user ON profile_interests (user_id);
CREATE INDEX idx_profile_interests_interest ON profile_interests (interest_id, direction);

-- ─────────────────────────────────────────────────────────────────────────────
-- mentor_settings
-- Alumni/mentor availability and capacity configuration.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE mentor_settings (
  user_id               UUID          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  available             BOOLEAN       NOT NULL DEFAULT TRUE,
  max_mentees           INT           NOT NULL DEFAULT 3 CHECK (max_mentees BETWEEN 0 AND 20),
  -- active_mentee_count is derived from mentorships; not stored to avoid drift.
  -- Use SELECT COUNT(*) with FOR UPDATE in capacity checks.
  accepting_requests    BOOLEAN       NOT NULL DEFAULT TRUE,
  preferred_modes       meeting_mode  NOT NULL DEFAULT 'either',
  preferred_languages   TEXT[]        NOT NULL DEFAULT ARRAY['en'],
  schedule_note         TEXT,         -- free text e.g. "Weekends only (IST)"
  max_requests_per_month INT          NOT NULL DEFAULT 5 CHECK (max_requests_per_month >= 0),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_mentor_settings_updated_at
  BEFORE UPDATE ON mentor_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
