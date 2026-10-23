-- 004_token_rules.sql
-- Token rule configuration and token lineage links.
--
-- IMPORTANT: Token matching is UNCONFIRMED (D1).
-- These tables define the rule engine interface. No production matching
-- will be computed until the department provides and signs off the
-- official formula and gold example set.
--
-- The rule configuration is stored as JSONB to accommodate different
-- rule types (modulo, suffix-parse, lookup-table, etc.) without requiring
-- schema migrations each time the rule changes. The rule_type column
-- determines how the configuration is interpreted by the matching engine.

-- ─────────────────────────────────────────────────────────────────────────────
-- token_rules
-- Versioned, scoped matching rules. One active rule per program at a time.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE token_rule_status AS ENUM (
  'draft',       -- being configured; not yet active
  'preview',     -- active for admin preview only; not shown to users
  'active',      -- in use for matching
  'superseded',  -- replaced by a newer version; kept for audit
  'disabled'     -- manually disabled
);

CREATE TABLE token_rules (
  id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID                NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
  version         TEXT                NOT NULL,   -- e.g. '1.0', '2026-pilot'
  rule_type       TEXT                NOT NULL,   -- e.g. 'synthetic', 'modulo', 'suffix_parse'
  config          JSONB               NOT NULL,   -- rule-type-specific parameters
  description     TEXT,
  status          token_rule_status   NOT NULL DEFAULT 'draft',
  effective_from  DATE,
  effective_to    DATE,
  approved_by     UUID                REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  created_by      UUID                NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  -- Only one active rule per program at a time
  CONSTRAINT uq_token_rules_program_active
    EXCLUDE USING btree (program_id WITH =)
    WHERE (status = 'active'),

  CONSTRAINT chk_token_rules_version CHECK (char_length(version) BETWEEN 1 AND 50)
);

CREATE INDEX idx_token_rules_program ON token_rules (program_id, status);

CREATE TRIGGER trg_token_rules_updated_at
  BEFORE UPDATE ON token_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- token_links
-- Computed counterpart relationships between memberships.
-- These are historical/lineage links, NOT active mentorship relationships.
--
-- A link connects a student membership to an alumni membership that shares
-- the same canonical token key under a specific rule version.
-- Multiple links are possible if the department allows it (D1).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE token_link_status AS ENUM (
  'active',      -- confirmed link
  'unregistered',-- counterpart not yet on the platform
  'inactive',    -- counterpart's account deactivated/deleted
  'disputed',    -- under coordinator review
  'superseded',  -- replaced by a corrected link
  'synthetic'    -- generated from synthetic data (development only)
);

CREATE TABLE token_links (
  id                    UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  source_membership_id  UUID                NOT NULL REFERENCES memberships(id) ON DELETE RESTRICT,
  target_membership_id  UUID                REFERENCES memberships(id) ON DELETE SET NULL,
  -- target_membership_id is NULL when the counterpart has not yet registered
  token_key             TEXT                NOT NULL,
  rule_id               UUID                NOT NULL REFERENCES token_rules(id) ON DELETE RESTRICT,
  status                token_link_status   NOT NULL DEFAULT 'active',
  confidence            NUMERIC(5,4)        NOT NULL DEFAULT 1.0
                        CHECK (confidence BETWEEN 0 AND 1),
  override_reason       TEXT,               -- if manually corrected by coordinator
  overridden_by         UUID                REFERENCES users(id) ON DELETE SET NULL,
  computed_at           TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_token_links_not_self
    CHECK (source_membership_id != target_membership_id)
);

-- Ensure a source membership only has one active link to a given target
CREATE UNIQUE INDEX idx_token_links_source_target_active
  ON token_links (source_membership_id, target_membership_id)
  WHERE status = 'active' AND target_membership_id IS NOT NULL;

CREATE INDEX idx_token_links_source ON token_links (source_membership_id);
CREATE INDEX idx_token_links_target ON token_links (target_membership_id)
  WHERE target_membership_id IS NOT NULL;
CREATE INDEX idx_token_links_token_key ON token_links (token_key, rule_id);

CREATE TRIGGER trg_token_links_updated_at
  BEFORE UPDATE ON token_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
