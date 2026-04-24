/**
 * Mounjaro injection guided flow service.
 *
 * Manages a multi-step guided conversation for logging Mounjaro injections
 * via WhatsApp. Uses KV for session state (same pattern as checkin-session).
 *
 * Flow steps:
 *   1. Dose selection (2.5 / 5 / 7.5 / 10 / 12.5 / 15 mg)
 *   2. Time (now or specific time like "8:30am")
 *   3. Injection site (abdomen / thigh-L / thigh-R / arm-L / arm-R)
 *   4. 72h symptom watch opt-in (yes/no)
 *
 * On completion, creates a medication_event with event_type=injected and
 * injection_site.
 *
 * Validates: FR-MED-002 (Mounjaro injections modeled with dose, site, time)
 * Validates: DAT-021 (Injection date/time)
 * Validates: DAT-022 (Injection dose enum)
 * Validates: DAT-023 (Injection site enum)
 * Design: Section 6.4 (Injection flow)
 */

import {
  generateId,
  utcNow,
  localDateToday,
  MOUNJARO_DOSES,
  INJECTION_SITES,
  CHECKIN_SESSION_TTL_SECONDS,
} from '@symptom-tracker/shared';
import type { InjectionSite } from '@symptom-tracker/shared';
import { findMedicationByName } from './medication-event';

// ── Types ───────────────────────────────────────────────────────────

/** Bindings needed by the injection flow. */
export interface InjectionFlowEnv {
  DB: D1Database;
  KV: KVNamespace;
}

/** Result returned by the injection flow handler. */
export interface InjectionFlowResult {
  /** Response message(s) to send back to the user. */
  messages: string[];
  /** Whether the injection flow is now complete. */
  completed: boolean;
  /** Whether a medication event was persisted. */
  saved: boolean;
}

/** Steps in the injection flow. */
export type InjectionStep = 'dose' | 'time' | 'site' | 'watch';

/** In-progress injection session stored in KV. */
export interface InjectionSession {
  sessionId: string;
  userId: string;
  currentStep: InjectionStep;
  doseValue: number | null;
  eventTime: string | null; // ISO 8601 UTC or null if not yet answered
  injectionSite: string | null;
  watchOptIn: boolean | null;
  startedAt: string; // ISO 8601 UTC
  updatedAt: string; // ISO 8601 UTC
}

// ── Constants ───────────────────────────────────────────────────────

/** KV key prefix for injection sessions. */
const INJECTION_SESSION_PREFIX = 'injection-session:';

/** TTL for injection sessions — reuse the same 4h TTL as check-in sessions. */
const INJECTION_SESSION_TTL_SECONDS = CHECKIN_SESSION_TTL_SECONDS;

/** Valid dose values as a Set for fast lookup. */
const VALID_DOSES = new Set(MOUNJARO_DOSES);

/** Valid injection sites as a Set for fast lookup. */
const VALID_SITES = new Set<string>(INJECTION_SITES);

/** Prompt messages for each step. */
export const STEP_PROMPTS: Record<InjectionStep, string> = {
  dose: 'Which dose? (2.5 / 5 / 7.5 / 10 / 12.5 / 15 mg)',
  time: 'When? (now / or enter time like 8:30am)',
  site: 'Injection site? (abdomen / thigh-L / thigh-R / arm-L / arm-R)',
  watch: 'Start 72h symptom watch? (yes/no)',
};

/** Order of steps in the flow. */
const STEP_ORDER: InjectionStep[] = ['dose', 'time', 'site', 'watch'];

// ── KV helpers ──────────────────────────────────────────────────────

/** Build the KV key for a user's active injection session. */
function sessionKey(userId: string): string {
  return `${INJECTION_SESSION_PREFIX}${userId}`;
}

/** Retrieve an existing injection session from KV. */
export async function getInjectionSession(
  kv: KVNamespace,
  userId: string,
): Promise<InjectionSession | null> {
  const raw = await kv.get(sessionKey(userId), 'text');
  if (raw === null) return null;
  return JSON.parse(raw) as InjectionSession;
}

/** Create a new injection session and persist it to KV. */
export async function createInjectionSession(
  kv: KVNamespace,
  userId: string,
): Promise<InjectionSession> {
  const now = utcNow();
  const session: InjectionSession = {
    sessionId: generateId(),
    userId,
    currentStep: 'dose',
    doseValue: null,
    eventTime: null,
    injectionSite: null,
    watchOptIn: null,
    startedAt: now,
    updatedAt: now,
  };

  await kv.put(sessionKey(userId), JSON.stringify(session), {
    expirationTtl: INJECTION_SESSION_TTL_SECONDS,
  });

  return session;
}

/** Persist an updated injection session back to KV, refreshing the TTL. */
export async function saveInjectionSession(
  kv: KVNamespace,
  session: InjectionSession,
): Promise<void> {
  await kv.put(sessionKey(session.userId), JSON.stringify(session), {
    expirationTtl: INJECTION_SESSION_TTL_SECONDS,
  });
}

/** Remove an injection session from KV. */
export async function deleteInjectionSession(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await kv.delete(sessionKey(userId));
}

// ── Input parsers ───────────────────────────────────────────────────

/**
 * Parse a dose value from user input.
 * Accepts: "2.5", "5", "10mg", "12.5 mg", etc.
 */
export function parseDoseInput(text: string): number | null {
  const trimmed = text.trim().toLowerCase().replace(/\s*mg\s*$/, '');
  const value = parseFloat(trimmed);
  if (isNaN(value) || !isFinite(value)) return null;
  if (!VALID_DOSES.has(value as (typeof MOUNJARO_DOSES)[number])) return null;
  return value;
}

/**
 * Parse a time input from the user.
 * Accepts: "now", "8:30am", "8:30 am", "14:30", "2:30pm", etc.
 * Returns an ISO 8601 UTC timestamp string.
 */
export function parseTimeInput(text: string, timezone: string): string | null {
  const trimmed = text.trim().toLowerCase();

  if (trimmed === 'now') {
    return utcNow();
  }

  // Try 12-hour format: "8:30am", "8:30 am", "12:00pm"
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const period = match12[3];

    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;

    if (period === 'am' && hours === 12) hours = 0;
    if (period === 'pm' && hours !== 12) hours += 12;

    return buildTimestamp(hours, minutes, timezone);
  }

  // Try 24-hour format: "14:30", "08:00"
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return buildTimestamp(hours, minutes, timezone);
  }

  return null;
}

/**
 * Build an ISO 8601 UTC timestamp from local hours/minutes in the given timezone.
 * Uses today's date in the user's timezone.
 */
function buildTimestamp(hours: number, minutes: number, timezone: string): string {
  const todayLocal = localDateToday(timezone);
  // Parse the local date parts
  const [year, month, day] = todayLocal.split('-').map(Number);

  // Create a date string in the user's local time and convert to UTC
  // We use a simple approach: create a Date from the local components
  const localStr = `${todayLocal}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

  // Use Intl to figure out the UTC offset for this timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Create a reference date at the desired local time
  // We approximate by creating a UTC date and adjusting
  const approxUtc = new Date(`${todayLocal}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`);

  // Get what the local time would be at this UTC time
  const parts = formatter.formatToParts(approxUtc);
  const localHour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const localMinute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);

  // Calculate the offset in minutes
  const desiredMinutes = hours * 60 + minutes;
  const actualMinutes = localHour * 60 + localMinute;
  const offsetMinutes = actualMinutes - desiredMinutes;

  // Adjust the UTC time by the offset
  const adjustedUtc = new Date(approxUtc.getTime() - offsetMinutes * 60 * 1000);

  return adjustedUtc.toISOString();
}

/**
 * Parse an injection site from user input.
 * Accepts: "abdomen", "thigh-l", "thigh-r", "arm-l", "arm-r",
 *          "upper-arm-l", "upper-arm-r" (mapped to arm-L/arm-R)
 */
export function parseSiteInput(text: string): string | null {
  const trimmed = text.trim().toLowerCase();

  // Map common aliases
  const aliases: Record<string, string> = {
    'abdomen': 'abdomen',
    'thigh-l': 'thigh-L',
    'thigh-r': 'thigh-R',
    'arm-l': 'arm-L',
    'arm-r': 'arm-R',
    'upper-arm-l': 'arm-L',
    'upper-arm-r': 'arm-R',
    'left thigh': 'thigh-L',
    'right thigh': 'thigh-R',
    'left arm': 'arm-L',
    'right arm': 'arm-R',
  };

  return aliases[trimmed] ?? null;
}

/**
 * Parse a yes/no response for the symptom watch opt-in.
 * Accepts: "yes", "y", "no", "n"
 */
export function parseWatchInput(text: string): boolean | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === 'yes' || trimmed === 'y') return true;
  if (trimmed === 'no' || trimmed === 'n') return false;
  return null;
}

// ── Time formatting ─────────────────────────────────────────────────

/**
 * Format an ISO 8601 timestamp to a user-friendly local time string.
 */
export function formatLocalTime(isoTimestamp: string, timezone: string): string {
  const date = new Date(isoTimestamp);
  return date.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ── D1 persistence ──────────────────────────────────────────────────

/**
 * Persist an injection medication event to D1.
 *
 * Creates a medication_event with event_type=injected and injection_site.
 */
export async function persistInjectionEvent(
  db: D1Database,
  userId: string,
  medicationDefinitionId: string,
  doseValue: number,
  doseUnit: string,
  injectionSite: string,
  eventAt: string,
  eventDate: string,
): Promise<string> {
  const eventId = generateId();
  const now = utcNow();

  await db
    .prepare(
      `INSERT INTO medication_event
         (id, user_id, medication_definition_id, event_type, dose_value, dose_unit,
          injection_site, event_at, event_date, note_id, created_at)
       VALUES (?, ?, ?, 'injected', ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(
      eventId,
      userId,
      medicationDefinitionId,
      doseValue,
      doseUnit,
      injectionSite,
      eventAt,
      eventDate,
      now,
    )
    .run();

  return eventId;
}

// ── Flow handlers ───────────────────────────────────────────────────

/**
 * Start a new injection flow.
 *
 * Creates a new injection session in KV and returns the first prompt.
 */
export async function startInjectionFlow(
  env: InjectionFlowEnv,
  userId: string,
): Promise<InjectionFlowResult> {
  // Check for existing injection session
  const existing = await getInjectionSession(env.KV, userId);
  if (existing) {
    // Resume existing session
    return {
      messages: [
        'Resuming injection logging.',
        STEP_PROMPTS[existing.currentStep],
      ],
      completed: false,
      saved: false,
    };
  }

  // Verify Mounjaro exists in the medication definitions
  const mounjaro = await findMedicationByName(env.DB, 'mounjaro');
  if (!mounjaro) {
    return {
      messages: ['Mounjaro is not configured as an active medication.'],
      completed: true,
      saved: false,
    };
  }

  // Create new session
  await createInjectionSession(env.KV, userId);

  return {
    messages: [STEP_PROMPTS.dose],
    completed: false,
    saved: false,
  };
}

/**
 * Process a user's response during an active injection flow.
 *
 * Parses the input for the current step, advances to the next step,
 * and completes the flow when all steps are done.
 */
export async function processInjectionResponse(
  env: InjectionFlowEnv,
  userId: string,
  text: string,
  timezone: string,
): Promise<InjectionFlowResult> {
  const session = await getInjectionSession(env.KV, userId);

  if (!session) {
    return {
      messages: ['No active injection session. Send "inject" to start one.'],
      completed: false,
      saved: false,
    };
  }

  switch (session.currentStep) {
    case 'dose': {
      const dose = parseDoseInput(text);
      if (dose === null) {
        return {
          messages: ['Please enter a valid dose: 2.5, 5, 7.5, 10, 12.5, or 15 mg.'],
          completed: false,
          saved: false,
        };
      }
      session.doseValue = dose;
      session.currentStep = 'time';
      session.updatedAt = utcNow();
      await saveInjectionSession(env.KV, session);
      return {
        messages: [STEP_PROMPTS.time],
        completed: false,
        saved: false,
      };
    }

    case 'time': {
      const eventTime = parseTimeInput(text, timezone);
      if (eventTime === null) {
        return {
          messages: ['Please enter "now" or a time like "8:30am" or "14:30".'],
          completed: false,
          saved: false,
        };
      }
      session.eventTime = eventTime;
      session.currentStep = 'site';
      session.updatedAt = utcNow();
      await saveInjectionSession(env.KV, session);
      return {
        messages: [STEP_PROMPTS.site],
        completed: false,
        saved: false,
      };
    }

    case 'site': {
      const site = parseSiteInput(text);
      if (site === null) {
        return {
          messages: ['Please enter a valid site: abdomen, thigh-L, thigh-R, arm-L, or arm-R.'],
          completed: false,
          saved: false,
        };
      }
      session.injectionSite = site;
      session.currentStep = 'watch';
      session.updatedAt = utcNow();
      await saveInjectionSession(env.KV, session);
      return {
        messages: [STEP_PROMPTS.watch],
        completed: false,
        saved: false,
      };
    }

    case 'watch': {
      const watch = parseWatchInput(text);
      if (watch === null) {
        return {
          messages: ['Please answer "yes" or "no".'],
          completed: false,
          saved: false,
        };
      }
      session.watchOptIn = watch;
      session.updatedAt = utcNow();

      // Flow complete — persist the injection event
      return await completeInjectionFlow(env, session, timezone);
    }

    default:
      return {
        messages: ['Unexpected injection flow state. Send "inject" to restart.'],
        completed: true,
        saved: false,
      };
  }
}

/**
 * Complete the injection flow: persist the medication event and clean up.
 */
async function completeInjectionFlow(
  env: InjectionFlowEnv,
  session: InjectionSession,
  timezone: string,
): Promise<InjectionFlowResult> {
  // Look up Mounjaro medication definition
  const mounjaro = await findMedicationByName(env.DB, 'mounjaro');
  if (!mounjaro) {
    await deleteInjectionSession(env.KV, session.userId);
    return {
      messages: ['Error: Mounjaro medication definition not found.'],
      completed: true,
      saved: false,
    };
  }

  const eventAt = session.eventTime!;
  const eventDate = localDateToday(timezone);

  await persistInjectionEvent(
    env.DB,
    session.userId,
    mounjaro.id,
    session.doseValue!,
    'mg',
    session.injectionSite!,
    eventAt,
    eventDate,
  );

  // Clean up session
  await deleteInjectionSession(env.KV, session.userId);

  // Build confirmation message
  const timeDisplay = formatLocalTime(eventAt, timezone);
  const watchStatus = session.watchOptIn
    ? 'Watch active for 72h.'
    : 'No watch.';

  const confirmation = `✓ Mounjaro ${session.doseValue}mg logged at ${timeDisplay}, ${session.injectionSite}. ${watchStatus}`;

  const messages = [confirmation];

  // If watch opted in, signal that side-effect capture should start
  if (session.watchOptIn) {
    messages.push('__START_SIDE_EFFECT_CAPTURE__');
  }

  return {
    messages,
    completed: true,
    saved: true,
  };
}
