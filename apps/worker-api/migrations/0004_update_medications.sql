-- Migration 0004: Update medication_definition to match actual medication list
--
-- Deactivates old medications (seroquel, lithium, lamotrigine) and inserts
-- the correct ones (glipizide, metformin, abilify, trileptal).
-- Mounjaro remains unchanged.

-- Deactivate medications no longer taken
UPDATE medication_definition SET active = 0 WHERE code = 'seroquel';
UPDATE medication_definition SET active = 0 WHERE code = 'lithium';
UPDATE medication_definition SET active = 0 WHERE code = 'lamotrigine';

-- Insert new medications
INSERT OR IGNORE INTO medication_definition
  (id, code, display_name, route, default_dose_value, default_dose_unit, active, created_at)
VALUES
  ('01SEED0000GLIPIZIDE0000', 'glipizide', 'Glipizide', 'oral', 10, 'mg', 1, '2025-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO medication_definition
  (id, code, display_name, route, default_dose_value, default_dose_unit, active, created_at)
VALUES
  ('01SEED0000METFORMIN0000', 'metformin', 'Metformin', 'oral', 1000, 'mg', 1, '2025-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO medication_definition
  (id, code, display_name, route, default_dose_value, default_dose_unit, active, created_at)
VALUES
  ('01SEED0000ABILIFY00000', 'abilify', 'Abilify (aripiprazole)', 'oral', 5, 'mg', 1, '2025-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO medication_definition
  (id, code, display_name, route, default_dose_value, default_dose_unit, active, created_at)
VALUES
  ('01SEED0000TRILEPTAL000', 'trileptal', 'Trileptal (oxcarbazepine)', 'oral', 600, 'mg', 1, '2025-01-01T00:00:00.000Z');
