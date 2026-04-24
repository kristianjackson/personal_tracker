-- Migration 0001: Create all core entity tables
-- Requirement: NFR-MNT-002 (migration-driven schema with versioned files)
-- Requirement: FR-CAP-004 (UTC timestamps, source channel preservation)
-- Design: Sections 5.1–5.13
--
-- Conventions:
--   • All primary keys are TEXT (ULID format)
--   • All timestamps stored as ISO 8601 UTC text
--   • Local dates stored as YYYY-MM-DD text in user's timezone
--   • JSON fields stored as TEXT
--   • Booleans stored as INTEGER (0/1)

-- ─────────────────────────────────────────────────────────────────────
-- 5.1 user
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user (
  id          TEXT PRIMARY KEY,
  display_name TEXT,
  timezone    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────
-- 5.2 whatsapp_binding
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_binding (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES user(id),
  phone_number TEXT NOT NULL UNIQUE,
  verified_at  TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_binding_user_id
  ON whatsapp_binding(user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5.3 daily_checkin
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_checkin (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES user(id),
  checkin_date   TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'abandoned')),
  source         TEXT NOT NULL DEFAULT 'whatsapp',
  is_retroactive INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(user_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_checkin_user_date
  ON daily_checkin(user_id, checkin_date);

-- ─────────────────────────────────────────────────────────────────────
-- 5.4 symptom_observation
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS symptom_observation (
  id               TEXT PRIMARY KEY,
  daily_checkin_id TEXT NOT NULL REFERENCES daily_checkin(id),
  variable_code    TEXT NOT NULL,
  value_numeric    REAL,
  value_text       TEXT,
  scale_min        INTEGER,
  scale_max        INTEGER,
  skipped          INTEGER NOT NULL DEFAULT 0,
  entered_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_symptom_observation_checkin
  ON symptom_observation(daily_checkin_id);

CREATE INDEX IF NOT EXISTS idx_symptom_observation_variable
  ON symptom_observation(variable_code);

-- ─────────────────────────────────────────────────────────────────────
-- 5.5 note
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS note (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES user(id),
  daily_checkin_id TEXT REFERENCES daily_checkin(id),
  body             TEXT NOT NULL,
  tags             TEXT,
  source           TEXT NOT NULL DEFAULT 'whatsapp',
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_user_id
  ON note(user_id);

CREATE INDEX IF NOT EXISTS idx_note_user_created
  ON note(user_id, created_at);

-- ─────────────────────────────────────────────────────────────────────
-- 5.6 medication_definition
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medication_definition (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  display_name       TEXT NOT NULL,
  route              TEXT NOT NULL CHECK (route IN ('oral', 'injection')),
  default_dose_value REAL,
  default_dose_unit  TEXT,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────
-- 5.7 medication_event
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medication_event (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES user(id),
  medication_definition_id TEXT NOT NULL REFERENCES medication_definition(id),
  event_type               TEXT NOT NULL CHECK (event_type IN ('taken', 'missed', 'injected', 'skipped')),
  dose_value               REAL,
  dose_unit                TEXT,
  injection_site           TEXT,
  event_at                 TEXT NOT NULL,
  event_date               TEXT NOT NULL,
  note_id                  TEXT REFERENCES note(id),
  created_at               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_medication_event_user_date
  ON medication_event(user_id, event_date);

CREATE INDEX IF NOT EXISTS idx_medication_event_med_def
  ON medication_event(medication_definition_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5.8 side_effect_observation
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS side_effect_observation (
  id                         TEXT PRIMARY KEY,
  user_id                    TEXT NOT NULL REFERENCES user(id),
  linked_medication_event_id TEXT REFERENCES medication_event(id),
  variable_code              TEXT NOT NULL,
  severity                   INTEGER NOT NULL CHECK (severity >= 0 AND severity <= 5),
  observed_date              TEXT NOT NULL,
  observed_at                TEXT NOT NULL,
  note_id                    TEXT REFERENCES note(id)
);

CREATE INDEX IF NOT EXISTS idx_side_effect_user_date
  ON side_effect_observation(user_id, observed_date);

CREATE INDEX IF NOT EXISTS idx_side_effect_med_event
  ON side_effect_observation(linked_medication_event_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5.9 behavioral_event
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS behavioral_event (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES user(id),
  event_date         TEXT NOT NULL,
  tag                TEXT NOT NULL,
  severity           INTEGER CHECK (severity >= 0 AND severity <= 5),
  description        TEXT,
  related_checkin_id TEXT REFERENCES daily_checkin(id),
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_behavioral_event_user_date
  ON behavioral_event(user_id, event_date);

-- ─────────────────────────────────────────────────────────────────────
-- 5.10 instrument_response
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instrument_response (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES user(id),
  instrument_name    TEXT NOT NULL,
  instrument_version TEXT NOT NULL,
  response_date      TEXT NOT NULL,
  raw_responses      TEXT NOT NULL,
  calculated_score   REAL,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_instrument_response_user
  ON instrument_response(user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5.11 analytic_flag
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytic_flag (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES user(id),
  flag_code    TEXT NOT NULL,
  started_on   TEXT NOT NULL,
  ended_on     TEXT,
  severity     TEXT NOT NULL CHECK (severity IN ('weak', 'moderate', 'strong')),
  explanation  TEXT NOT NULL,
  dismissed_at TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytic_flag_user
  ON analytic_flag(user_id);

CREATE INDEX IF NOT EXISTS idx_analytic_flag_code
  ON analytic_flag(user_id, flag_code);

-- ─────────────────────────────────────────────────────────────────────
-- 5.12 summary_report
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS summary_report (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES user(id),
  report_type  TEXT NOT NULL CHECK (report_type IN ('weekly', 'monthly', 'custom')),
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  r2_pdf_key   TEXT,
  r2_csv_key   TEXT,
  generated_at TEXT NOT NULL,
  generator    TEXT NOT NULL CHECK (generator IN ('deterministic', 'llm'))
);

CREATE INDEX IF NOT EXISTS idx_summary_report_user
  ON summary_report(user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5.13 audit_event
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_event (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_event_user
  ON audit_event(user_id);

CREATE INDEX IF NOT EXISTS idx_audit_event_action
  ON audit_event(action);

CREATE INDEX IF NOT EXISTS idx_audit_event_created
  ON audit_event(created_at);
