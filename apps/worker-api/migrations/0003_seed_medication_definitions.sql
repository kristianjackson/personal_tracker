-- Migration 0003: Seed medication_definition table
-- The medication_definition table was created in 0001 but never populated.
-- This inserts the four active medications from the seed config so that
-- commands like "inject" and "took <med>" can find them.
--
-- IDs use a fixed ULID-style prefix so they are deterministic and
-- re-runnable (INSERT OR IGNORE).

INSERT OR IGNORE INTO medication_definition
  (id, code, display_name, route, default_dose_value, default_dose_unit, active, created_at)
VALUES
  ('01SEED0000MOUNJARO00000', 'mounjaro', 'Mounjaro (tirzepatide)', 'injection', 2.5, 'mg', 1, '2025-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO medication_definition
  (id, code, display_name, route, default_dose_value, default_dose_unit, active, created_at)
VALUES
  ('01SEED0000SEROQUEL00000', 'seroquel', 'Seroquel (quetiapine)', 'oral', NULL, 'mg', 1, '2025-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO medication_definition
  (id, code, display_name, route, default_dose_value, default_dose_unit, active, created_at)
VALUES
  ('01SEED0000LITHIUM000000', 'lithium', 'Lithium', 'oral', NULL, 'mg', 1, '2025-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO medication_definition
  (id, code, display_name, route, default_dose_value, default_dose_unit, active, created_at)
VALUES
  ('01SEED0000LAMOTRIGIN000', 'lamotrigine', 'Lamotrigine (Lamictal)', 'oral', NULL, 'mg', 1, '2025-01-01T00:00:00.000Z');
