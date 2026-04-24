/**
 * Check-in session state management via Workers KV.
 *
 * Stores in-progress daily check-in sessions in KV with a 4-hour TTL.
 * Completed check-ins are written to D1 by the check-in flow handler
 * (Task 15). This module only manages the ephemeral session state.
 *
 * Validates: FR-WA-006 (System shall recover gracefully if a user stops
 *            mid-check-in and resumes later. Session state resumes
 *            correctly; sessions expire after 4 hours of inactivity.)
 * Design: DD-009 (KV for session state, D1 for canonical records)
 * Design: Section 6.1 (Resume interrupted sessions with KV TTL 4h)
 */

import {
  generateId,
  utcNow,
  getEnabledQuestions,
  CHECKIN_SESSION_TTL_SECONDS,
} from '@symptom-tracker/shared';
import type { QuestionDefinition } from '@symptom-tracker/shared';

// ── Types ───────────────────────────────────────────────────────────

/** A single answer recorded during a check-in session. */
export interface CheckinAnswer {
  variableCode: string;
  valueNumeric: number | null;
  valueText: string | null;
  skipped: boolean;
  answeredAt: string; // ISO 8601 UTC
}

/** In-progress check-in session stored in KV. */
export interface CheckinSession {
  sessionId: string; // ULID
  userId: string;
  checkinDate: string; // YYYY-MM-DD local date
  currentQuestionIndex: number; // 0-based index into enabled questions
  answers: Record<string, CheckinAnswer>; // keyed by variable_code
  startedAt: string; // ISO 8601 UTC
  updatedAt: string; // ISO 8601 UTC
  isRetroactive: boolean;
}

// ── KV key helper ───────────────────────────────────────────────────

/** Build the KV key for a user's active check-in session. */
function sessionKey(userId: string): string {
  return `checkin-session:${userId}`;
}

// ── Core functions ──────────────────────────────────────────────────

/**
 * Retrieve an existing check-in session from KV.
 *
 * Returns `null` when no session exists (expired or never created).
 */
export async function getSession(
  kv: KVNamespace,
  userId: string,
): Promise<CheckinSession | null> {
  const raw = await kv.get(sessionKey(userId), 'text');
  if (raw === null) return null;
  return JSON.parse(raw) as CheckinSession;
}

/**
 * Create a new check-in session and persist it to KV with the
 * configured TTL.
 */
export async function createSession(
  kv: KVNamespace,
  userId: string,
  checkinDate: string,
  isRetroactive = false,
): Promise<CheckinSession> {
  const now = utcNow();
  const session: CheckinSession = {
    sessionId: generateId(),
    userId,
    checkinDate,
    currentQuestionIndex: 0,
    answers: {},
    startedAt: now,
    updatedAt: now,
    isRetroactive,
  };

  await kv.put(sessionKey(userId), JSON.stringify(session), {
    expirationTtl: CHECKIN_SESSION_TTL_SECONDS,
  });

  return session;
}

/**
 * Persist an updated session back to KV, refreshing the TTL.
 */
export async function saveSession(
  kv: KVNamespace,
  session: CheckinSession,
): Promise<void> {
  await kv.put(sessionKey(session.userId), JSON.stringify(session), {
    expirationTtl: CHECKIN_SESSION_TTL_SECONDS,
  });
}

/**
 * Remove a session from KV (e.g. after completing or cancelling a check-in).
 */
export async function deleteSession(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await kv.delete(sessionKey(userId));
}

/**
 * Record an answer for the current question and advance the question index.
 *
 * This is a **pure function** — it returns a new session object without
 * touching KV. The caller is responsible for calling `saveSession` afterwards.
 */
export function recordAnswer(
  session: CheckinSession,
  variableCode: string,
  value: number | string | null,
  skipped: boolean,
): CheckinSession {
  const now = utcNow();

  const answer: CheckinAnswer = {
    variableCode,
    valueNumeric: typeof value === 'number' ? value : null,
    valueText: typeof value === 'string' ? value : null,
    skipped,
    answeredAt: now,
  };

  return {
    ...session,
    currentQuestionIndex: session.currentQuestionIndex + 1,
    answers: {
      ...session.answers,
      [variableCode]: answer,
    },
    updatedAt: now,
  };
}

/**
 * Get the next unanswered question based on `currentQuestionIndex`.
 *
 * Returns `null` when all enabled questions have been asked.
 */
export function getNextQuestion(
  session: CheckinSession,
): QuestionDefinition | null {
  const questions = getEnabledQuestions();
  if (session.currentQuestionIndex >= questions.length) return null;
  return questions[session.currentQuestionIndex];
}

/**
 * Check whether every enabled question has been answered or skipped.
 */
export function isSessionComplete(session: CheckinSession): boolean {
  const total = getEnabledQuestions().length;
  return session.currentQuestionIndex >= total;
}

/**
 * Get progress statistics for the current session.
 */
export function getSessionProgress(session: CheckinSession): {
  answered: number;
  skipped: number;
  total: number;
  remaining: number;
} {
  const total = getEnabledQuestions().length;
  const answers = Object.values(session.answers);
  const skipped = answers.filter((a) => a.skipped).length;
  const answered = answers.filter((a) => !a.skipped).length;
  const remaining = total - session.currentQuestionIndex;

  return { answered, skipped, total, remaining };
}
