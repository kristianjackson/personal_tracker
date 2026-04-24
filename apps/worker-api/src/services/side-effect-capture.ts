/**
 * Side-effect capture service for post-injection monitoring.
 *
 * Manages a multi-step guided conversation for capturing side effects
 * after a Mounjaro injection. Uses KV for session state (same pattern
 * as checkin-session and injection-flow).
 *
 * Prompts for 7 side-effect variables on a 0–5 ordinal scale:
 *   1. Nausea (DAT-024)
 *   2. Diarrhea (DAT-025)
 *   3. Vomiting (DAT-026)
 *   4. Constipation (DAT-027)
 *   5. Abdominal pain (DAT-028)
 *   6. Hydration difficulty (DAT-029)
 *   7. Appetite suppression (DAT-030)
 *
 * Observations are linked to the nearest medication_event with
 * event_type=injected within a 72-hour window.
 *
 * Validates: FR-MED-003 (side-effect observations linked to nearest injection within 72h)
 * Validates: DAT-024 (Nausea), DAT-025 (Diarrhea), DAT-026 (Vomiting)
 * Validates: DAT-027 (Constipation), DAT-028 (Abdominal pain)
 * Validates: DAT-029 (Hydration difficulty), DAT-030 (Appetite suppression)
 * Design: Section 5.8 (side_effect_observation table)
 */

import {
  generateId,
  utcNow,
  localDateToday,
  CHECKIN_SESSION_TTL_SECONDS,
  ORDINAL_MIN,
  ORDINAL_MAX,
} from '@symptom-tracker/shared';

// ── Types ───────────────────────────────────────────────────────────

/** Bindings needed by the side-effect capture service. */
export interface SideEffectCaptureEnv {
  DB: D1Database;
  KV: KVNamespace;
}

/** Result returned by the side-effect capture handler. */
export interface SideEffectCaptureResult {
  /** Response message(s) to send back to the user. */
  messages: string[];
  /** Whether the side-effect capture flow is now complete. */
  completed: boolean;
  /** Number of observations persisted (0 if none saved yet). */
  savedCount: number;
}

/** A single side-effect variable definition. */
export interface SideEffectVariable {
  code: string;
  label: string;
  prompt: string;
}

/** A recorded side-effect answer within the session. */
export interface SideEffectAnswer {
  variableCode: string;
  severity: number | null; // 0–5 or null if skipped
  skipped: boolean;
  answeredAt: string; // ISO 8601 UTC
}

/** In-progress side-effect capture session stored in KV. */
export interface SideEffectSession {
  sessionId: string;
  userId: string;
  currentQuestionIndex: number; // 0-based index into SIDE_EFFECT_VARIABLES
  answers: Record<string, SideEffectAnswer>; // keyed by variable_code
  linkedMedicationEventId: string | null;
  observedDate: string; // YYYY-MM-DD local
  startedAt: string; // ISO 8601 UTC
  updatedAt: string; // ISO 8601 UTC
}

/** Row shape for a medication_event with event_type=injected. */
interface InjectionEventRow {
  id: string;
  event_at: string;
}

// ── Constants ───────────────────────────────────────────────────────

/** KV key prefix for side-effect capture sessions. */
const SIDE_EFFECT_SESSION_PREFIX = 'side-effect-session:';

/** TTL for side-effect sessions — reuse the same 4h TTL. */
const SIDE_EFFECT_SESSION_TTL_SECONDS = CHECKIN_SESSION_TTL_SECONDS;

/** 72-hour window in milliseconds for linking to injection events. */
export const WATCH_WINDOW_MS = 72 * 60 * 60 * 1000;

/** The 7 side-effect variables prompted during capture. */
export const SIDE_EFFECT_VARIABLES: SideEffectVariable[] = [
  { code: 'DAT-024', label: 'Nausea', prompt: 'Nausea? (0=none, 5=severe) or skip' },
  { code: 'DAT-025', label: 'Diarrhea', prompt: 'Diarrhea? (0=none, 5=severe) or skip' },
  { code: 'DAT-026', label: 'Vomiting', prompt: 'Vomiting? (0=none, 5=severe) or skip' },
  { code: 'DAT-027', label: 'Constipation', prompt: 'Constipation? (0=none, 5=severe) or skip' },
  { code: 'DAT-028', label: 'Abdominal pain', prompt: 'Abdominal pain? (0=none, 5=severe) or skip' },
  { code: 'DAT-029', label: 'Hydration difficulty', prompt: 'Hydration difficulty? (0=none, 5=severe) or skip' },
  { code: 'DAT-030', label: 'Appetite suppression', prompt: 'Appetite suppression? (0=none, 5=severe) or skip' },
];

// ── KV helpers ──────────────────────────────────────────────────────

/** Build the KV key for a user's active side-effect session. */
function sessionKey(userId: string): string {
  return `${SIDE_EFFECT_SESSION_PREFIX}${userId}`;
}

/** Retrieve an existing side-effect session from KV. */
export async function getSideEffectSession(
  kv: KVNamespace,
  userId: string,
): Promise<SideEffectSession | null> {
  const raw = await kv.get(sessionKey(userId), 'text');
  if (raw === null) return null;
  return JSON.parse(raw) as SideEffectSession;
}

/** Create a new side-effect session and persist it to KV. */
export async function createSideEffectSession(
  kv: KVNamespace,
  userId: string,
  linkedMedicationEventId: string | null,
  observedDate: string,
): Promise<SideEffectSession> {
  const now = utcNow();
  const session: SideEffectSession = {
    sessionId: generateId(),
    userId,
    currentQuestionIndex: 0,
    answers: {},
    linkedMedicationEventId,
    observedDate,
    startedAt: now,
    updatedAt: now,
  };

  await kv.put(sessionKey(userId), JSON.stringify(session), {
    expirationTtl: SIDE_EFFECT_SESSION_TTL_SECONDS,
  });

  return session;
}

/** Persist an updated side-effect session back to KV, refreshing the TTL. */
export async function saveSideEffectSession(
  kv: KVNamespace,
  session: SideEffectSession,
): Promise<void> {
  await kv.put(sessionKey(session.userId), JSON.stringify(session), {
    expirationTtl: SIDE_EFFECT_SESSION_TTL_SECONDS,
  });
}

/** Remove a side-effect session from KV. */
export async function deleteSideEffectSession(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await kv.delete(sessionKey(userId));
}

// ── Input parsing ───────────────────────────────────────────────────

/**
 * Parse a severity value from user input.
 * Accepts: "0"–"5", "skip", "s"
 * Returns: { severity, skipped } or null for invalid input.
 */
export function parseSeverityInput(
  text: string,
): { severity: number | null; skipped: boolean } | null {
  const trimmed = text.trim().toLowerCase();

  // Skip
  if (trimmed === 'skip' || trimmed === 's') {
    return { severity: null, skipped: true };
  }

  // Numeric value
  const value = parseInt(trimmed, 10);
  if (isNaN(value) || !isFinite(value)) return null;
  if (value < ORDINAL_MIN || value > ORDINAL_MAX) return null;
  // Ensure the input was actually an integer (reject "2.5" etc.)
  if (trimmed !== String(value)) return null;

  return { severity: value, skipped: false };
}

// ── D1 queries ──────────────────────────────────────────────────────

/**
 * Find the nearest injection medication_event within the 72h window
 * before the given timestamp.
 *
 * Returns the most recent injection event within the window, or null.
 */
export async function findNearestInjectionEvent(
  db: D1Database,
  userId: string,
  referenceTime?: string,
): Promise<InjectionEventRow | null> {
  const refTime = referenceTime ?? utcNow();
  const refDate = new Date(refTime);
  const windowStart = new Date(refDate.getTime() - WATCH_WINDOW_MS).toISOString();

  const row = await db
    .prepare(
      `SELECT id, event_at
       FROM medication_event
       WHERE user_id = ?
         AND event_type = 'injected'
         AND event_at >= ?
         AND event_at <= ?
       ORDER BY event_at DESC
       LIMIT 1`,
    )
    .bind(userId, windowStart, refTime)
    .first<InjectionEventRow>();

  return row ?? null;
}

/**
 * Persist a single side_effect_observation row to D1.
 */
export async function persistSideEffectObservation(
  db: D1Database,
  userId: string,
  linkedMedicationEventId: string | null,
  variableCode: string,
  severity: number,
  observedDate: string,
): Promise<string> {
  const id = generateId();
  const now = utcNow();

  await db
    .prepare(
      `INSERT INTO side_effect_observation
         (id, user_id, linked_medication_event_id, variable_code, severity,
          observed_date, observed_at, note_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(id, userId, linkedMedicationEventId, variableCode, severity, observedDate, now)
    .run();

  return id;
}

// ── Flow handlers ───────────────────────────────────────────────────

/**
 * Start a new side-effect capture flow.
 *
 * Looks up the nearest injection event within 72h and creates a session.
 * Called after injection completion with watch opt-in, or during follow-ups.
 */
export async function startSideEffectCapture(
  env: SideEffectCaptureEnv,
  userId: string,
  timezone: string,
): Promise<SideEffectCaptureResult> {
  // Check for existing session
  const existing = await getSideEffectSession(env.KV, userId);
  if (existing) {
    const currentVar = SIDE_EFFECT_VARIABLES[existing.currentQuestionIndex];
    return {
      messages: [
        'Resuming side-effect check.',
        currentVar ? currentVar.prompt : 'All questions answered.',
      ],
      completed: false,
      savedCount: 0,
    };
  }

  // Find nearest injection within 72h
  const nearestInjection = await findNearestInjectionEvent(env.DB, userId);
  const linkedEventId = nearestInjection?.id ?? null;
  const observedDate = localDateToday(timezone);

  await createSideEffectSession(env.KV, userId, linkedEventId, observedDate);

  const firstPrompt = SIDE_EFFECT_VARIABLES[0].prompt;
  const intro = nearestInjection
    ? '72h side-effect check. Rate each 0–5 or "skip".'
    : 'Side-effect check (no recent injection found). Rate each 0–5 or "skip".';

  return {
    messages: [intro, firstPrompt],
    completed: false,
    savedCount: 0,
  };
}

/**
 * Process a user's response during an active side-effect capture flow.
 */
export async function processSideEffectResponse(
  env: SideEffectCaptureEnv,
  userId: string,
  text: string,
): Promise<SideEffectCaptureResult> {
  const session = await getSideEffectSession(env.KV, userId);

  if (!session) {
    return {
      messages: ['No active side-effect session.'],
      completed: false,
      savedCount: 0,
    };
  }

  // Validate we haven't gone past the end
  if (session.currentQuestionIndex >= SIDE_EFFECT_VARIABLES.length) {
    return completeSideEffectCapture(env, session);
  }

  const currentVar = SIDE_EFFECT_VARIABLES[session.currentQuestionIndex];
  const parsed = parseSeverityInput(text);

  if (parsed === null) {
    return {
      messages: [`Please enter a number 0–5 or "skip". ${currentVar.prompt}`],
      completed: false,
      savedCount: 0,
    };
  }

  // Record the answer
  const now = utcNow();
  session.answers[currentVar.code] = {
    variableCode: currentVar.code,
    severity: parsed.severity,
    skipped: parsed.skipped,
    answeredAt: now,
  };
  session.currentQuestionIndex += 1;
  session.updatedAt = now;

  // Check if all questions are done
  if (session.currentQuestionIndex >= SIDE_EFFECT_VARIABLES.length) {
    await saveSideEffectSession(env.KV, session);
    return completeSideEffectCapture(env, session);
  }

  // Save session and prompt next question
  await saveSideEffectSession(env.KV, session);
  const nextVar = SIDE_EFFECT_VARIABLES[session.currentQuestionIndex];

  return {
    messages: [nextVar.prompt],
    completed: false,
    savedCount: 0,
  };
}

/**
 * Complete the side-effect capture: persist all non-skipped observations
 * to D1 and clean up the session.
 */
async function completeSideEffectCapture(
  env: SideEffectCaptureEnv,
  session: SideEffectSession,
): Promise<SideEffectCaptureResult> {
  let savedCount = 0;

  // Persist non-skipped answers
  for (const answer of Object.values(session.answers)) {
    if (!answer.skipped && answer.severity !== null) {
      await persistSideEffectObservation(
        env.DB,
        session.userId,
        session.linkedMedicationEventId,
        answer.variableCode,
        answer.severity,
        session.observedDate,
      );
      savedCount++;
    }
  }

  // Clean up session
  await deleteSideEffectSession(env.KV, session.userId);

  const skippedCount = Object.values(session.answers).filter((a) => a.skipped).length;
  const totalAnswered = SIDE_EFFECT_VARIABLES.length - skippedCount;

  const confirmation =
    savedCount > 0
      ? `✓ Side-effect check complete (${totalAnswered}/${SIDE_EFFECT_VARIABLES.length} recorded).`
      : '✓ Side-effect check complete (all skipped).';

  return {
    messages: [confirmation],
    completed: true,
    savedCount,
  };
}
