/**
 * Medication event logging service.
 *
 * Handles `missed med`, `missed <med-name>`, and `took <med-name>` commands.
 * Looks up medication_definition by name/code from D1, creates medication_event
 * records with the appropriate event_type (missed or taken).
 *
 * Validates: FR-MED-001 (Medication dose events can be logged and summarized per medication)
 * Validates: FR-MED-005 (Missed dose appears in adherence trend)
 * Design: Section 5.7 (medication_event table), Section 6.2 (commands)
 */

import {
  generateId,
  utcNow,
  localDateToday,
  getActiveMedications,
} from '@symptom-tracker/shared';
import type { MedicationEventType } from '@symptom-tracker/shared';

// ── Types ───────────────────────────────────────────────────────────

/** Bindings needed by the medication event service. */
export interface MedicationEventEnv {
  DB: D1Database;
}

/** Result returned by medication event handlers. */
export interface MedicationEventResult {
  /** Response message(s) to send back to the user. */
  messages: string[];
  /** Whether a medication event was persisted. */
  saved: boolean;
}

/** Row shape returned when looking up a medication definition in D1. */
interface MedicationDefRow {
  id: string;
  code: string;
  display_name: string;
  route: string;
  default_dose_value: number | null;
  default_dose_unit: string | null;
}

// ── D1 lookups ──────────────────────────────────────────────────────

/**
 * Find a medication definition by name or code (case-insensitive).
 *
 * Checks the `code` column first, then falls back to a case-insensitive
 * match on `display_name`. Only active medications are considered.
 */
export async function findMedicationByName(
  db: D1Database,
  name: string,
): Promise<MedicationDefRow | null> {
  const lowerName = name.toLowerCase();

  // Try exact code match first (codes are lowercase by convention)
  const byCode = await db
    .prepare(
      `SELECT id, code, display_name, route, default_dose_value, default_dose_unit
       FROM medication_definition
       WHERE LOWER(code) = ? AND active = 1`,
    )
    .bind(lowerName)
    .first<MedicationDefRow>();

  if (byCode) return byCode;

  // Fall back to case-insensitive display_name match
  const byName = await db
    .prepare(
      `SELECT id, code, display_name, route, default_dose_value, default_dose_unit
       FROM medication_definition
       WHERE LOWER(display_name) = ? AND active = 1`,
    )
    .bind(lowerName)
    .first<MedicationDefRow>();

  return byName ?? null;
}

/**
 * List all active medication definitions from D1.
 */
export async function listActiveMedications(
  db: D1Database,
): Promise<MedicationDefRow[]> {
  const result = await db
    .prepare(
      `SELECT id, code, display_name, route, default_dose_value, default_dose_unit
       FROM medication_definition
       WHERE active = 1
       ORDER BY display_name`,
    )
    .all<MedicationDefRow>();

  return result.results ?? [];
}

// ── D1 persistence ──────────────────────────────────────────────────

/**
 * Persist a medication event to the D1 `medication_event` table.
 *
 * Returns the generated event ID.
 */
export async function persistMedicationEvent(
  db: D1Database,
  userId: string,
  medicationDefinitionId: string,
  eventType: MedicationEventType,
  doseValue: number | null,
  doseUnit: string | null,
  eventDate: string,
): Promise<string> {
  const eventId = generateId();
  const now = utcNow();

  await db
    .prepare(
      `INSERT INTO medication_event
         (id, user_id, medication_definition_id, event_type, dose_value, dose_unit,
          injection_site, event_at, event_date, note_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)`,
    )
    .bind(
      eventId,
      userId,
      medicationDefinitionId,
      eventType,
      doseValue,
      doseUnit,
      now,
      eventDate,
      now,
    )
    .run();

  return eventId;
}

// ── Formatting helpers ──────────────────────────────────────────────

/** Format a list of active medications for display. */
function formatMedicationList(meds: MedicationDefRow[]): string {
  if (meds.length === 0) {
    return 'No active medications configured.';
  }
  return meds.map((m) => `• ${m.display_name} (${m.code})`).join('\n');
}

// ── Command handlers ────────────────────────────────────────────────

/**
 * Handle a `missed med` command (no specific medication name).
 *
 * Lists active medications and asks the user to specify which one.
 */
export async function handleMissedMedGeneric(
  env: MedicationEventEnv,
  userId: string,
): Promise<MedicationEventResult> {
  const meds = await listActiveMedications(env.DB);

  if (meds.length === 0) {
    return {
      messages: ['No active medications configured. Nothing to log.'],
      saved: false,
    };
  }

  const list = formatMedicationList(meds);
  return {
    messages: [
      `Which medication did you miss? Reply "missed <name>".\n\nActive medications:\n${list}`,
    ],
    saved: false,
  };
}

/**
 * Handle a `missed <med-name>` command.
 *
 * Looks up the medication by name/code and creates a missed event.
 */
export async function handleMissedMedSpecific(
  env: MedicationEventEnv,
  userId: string,
  medicationName: string,
  timezone: string,
): Promise<MedicationEventResult> {
  const med = await findMedicationByName(env.DB, medicationName);

  if (!med) {
    const meds = await listActiveMedications(env.DB);
    const list = formatMedicationList(meds);
    return {
      messages: [
        `Medication "${medicationName}" not found. Reply "missed <name>" with one of:\n\n${list}`,
      ],
      saved: false,
    };
  }

  const eventDate = localDateToday(timezone);
  await persistMedicationEvent(
    env.DB,
    userId,
    med.id,
    'missed',
    med.default_dose_value,
    med.default_dose_unit,
    eventDate,
  );

  return {
    messages: [`✓ Missed dose logged for ${med.display_name}.`],
    saved: true,
  };
}

/**
 * Handle a `took <med-name>` command.
 *
 * Looks up the medication by name/code and creates a taken event.
 */
export async function handleTookMed(
  env: MedicationEventEnv,
  userId: string,
  medicationName: string,
  timezone: string,
): Promise<MedicationEventResult> {
  const med = await findMedicationByName(env.DB, medicationName);

  if (!med) {
    const meds = await listActiveMedications(env.DB);
    const list = formatMedicationList(meds);
    return {
      messages: [
        `Medication "${medicationName}" not found. Reply "took <name>" with one of:\n\n${list}`,
      ],
      saved: false,
    };
  }

  const eventDate = localDateToday(timezone);
  await persistMedicationEvent(
    env.DB,
    userId,
    med.id,
    'taken',
    med.default_dose_value,
    med.default_dose_unit,
    eventDate,
  );

  return {
    messages: [`✓ ${med.display_name} taken — logged.`],
    saved: true,
  };
}
