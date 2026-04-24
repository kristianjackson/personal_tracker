/**
 * Daily check-in question flow handler.
 *
 * Manages the guided daily check-in conversation: starts or resumes
 * a session, parses user answers for each question type, handles
 * skip commands, and persists completed check-ins to D1.
 *
 * Validates: FR-WA-003 (User can complete full check-in DAT-001 through DAT-014 via WhatsApp)
 * Validates: FR-CAP-001 (Daily record contains all prompted fields or explicit nulls with skip status)
 * Validates: FR-CAP-002 (Skipped fields remain null, session continues to next question)
 * Design: Section 6.3 (Daily check-in sequence)
 */

import {
  generateId,
  utcNow,
  getEnabledQuestions,
  NOTE_MAX_LENGTH,
} from '@symptom-tracker/shared';
import type { QuestionDefinition, QuestionType } from '@symptom-tracker/shared';
import {
  getSession,
  createSession,
  saveSession,
  deleteSession,
  recordAnswer,
  getNextQuestion,
  isSessionComplete,
  getSessionProgress,
} from './checkin-session';
import type { CheckinSession } from './checkin-session';

// ── Types ───────────────────────────────────────────────────────────

/** Bindings needed by the check-in flow. */
export interface CheckinFlowEnv {
  DB: D1Database;
  KV: KVNamespace;
}

/** Result returned by the flow handler to the caller. */
export interface CheckinFlowResult {
  /** Response message(s) to send back to the user. */
  messages: string[];
  /** Whether the check-in session is now complete. */
  completed: boolean;
}

/** Parsed answer value from user input. */
interface ParsedAnswer {
  value: number | string | null;
  skipped: boolean;
}

// ── Skip detection ──────────────────────────────────────────────────

const SKIP_TOKENS = new Set(['skip', 's', 'next']);

/** Check if the user input is a skip command. */
export function isSkipCommand(text: string): boolean {
  return SKIP_TOKENS.has(text.trim().toLowerCase());
}

// ── Input parsers ───────────────────────────────────────────────────

/**
 * Parse a numeric answer (e.g. sleep hours).
 * Accepts: "7", "6.5", "slept 4 hours", "4.5 hours"
 */
export function parseNumericAnswer(text: string): number | null {
  const trimmed = text.trim();

  // Try direct number parse first
  const direct = parseFloat(trimmed);
  if (!isNaN(direct) && isFinite(direct) && direct >= 0) {
    return direct;
  }

  // Try extracting a number from natural language
  const match = trimmed.match(/(\d+(?:\.\d+)?)/);
  if (match) {
    const val = parseFloat(match[1]);
    if (!isNaN(val) && isFinite(val) && val >= 0) {
      return val;
    }
  }

  return null;
}

/**
 * Parse an ordinal answer (0–5 scale).
 * Accepts: "3", "4/5", "mood 4", integers 0–5
 */
export function parseOrdinalAnswer(text: string, min = 0, max = 5): number | null {
  const trimmed = text.trim();

  // Try direct integer parse
  const direct = parseInt(trimmed, 10);
  if (!isNaN(direct) && direct >= min && direct <= max && String(direct) === trimmed) {
    return direct;
  }

  // Try "N/5" pattern
  const slashMatch = trimmed.match(/^(\d+)\s*\/\s*\d+$/);
  if (slashMatch) {
    const val = parseInt(slashMatch[1], 10);
    if (!isNaN(val) && val >= min && val <= max) {
      return val;
    }
  }

  // Try extracting a number from text like "mood 4" or "pretty elevated maybe 4"
  const numberMatch = trimmed.match(/(\d+)/);
  if (numberMatch) {
    const val = parseInt(numberMatch[1], 10);
    if (!isNaN(val) && val >= min && val <= max) {
      return val;
    }
  }

  return null;
}

/**
 * Parse a structured medication adherence answer.
 * Accepts: "yes", "no", "partial" → mapped to 1, 0, 0.5
 */
export function parseStructuredAnswer(text: string): number | null {
  const lower = text.trim().toLowerCase();

  if (lower === 'yes' || lower === 'y') return 1;
  if (lower === 'no' || lower === 'n') return 0;
  if (lower === 'partial' || lower === 'p') return 0.5;

  return null;
}

/**
 * Parse a text answer (side effects, notes).
 * Accepts freeform text up to NOTE_MAX_LENGTH chars.
 */
export function parseTextAnswer(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > NOTE_MAX_LENGTH) {
    return trimmed.slice(0, NOTE_MAX_LENGTH);
  }
  return trimmed;
}

/**
 * Parse user input based on the question type.
 */
export function parseAnswer(
  text: string,
  question: QuestionDefinition,
): ParsedAnswer {
  if (isSkipCommand(text)) {
    return { value: null, skipped: true };
  }

  switch (question.type) {
    case 'numeric': {
      const val = parseNumericAnswer(text);
      if (val === null) return { value: null, skipped: false };
      return { value: val, skipped: false };
    }
    case 'ordinal': {
      const min = question.scale?.min ?? 0;
      const max = question.scale?.max ?? 5;
      const val = parseOrdinalAnswer(text, min, max);
      if (val === null) return { value: null, skipped: false };
      return { value: val, skipped: false };
    }
    case 'structured': {
      const val = parseStructuredAnswer(text);
      if (val === null) return { value: null, skipped: false };
      return { value: val, skipped: false };
    }
    case 'text': {
      const val = parseTextAnswer(text);
      if (val === null) return { value: null, skipped: false };
      return { value: val, skipped: false };
    }
    default:
      return { value: null, skipped: false };
  }
}

// ── Prompt formatting ───────────────────────────────────────────────

/** Format a question prompt with progress indicator. */
function formatQuestionPrompt(
  question: QuestionDefinition,
  questionIndex: number,
  totalQuestions: number,
): string {
  const progress = `(${questionIndex + 1}/${totalQuestions})`;
  return `${progress} ${question.prompt}`;
}

/** Format the invalid input message for a question type. */
function formatInvalidInputMessage(question: QuestionDefinition): string {
  switch (question.type) {
    case 'numeric':
      return `Please enter a number (e.g. "7" or "6.5"), or type "skip" to skip.`;
    case 'ordinal': {
      const min = question.scale?.min ?? 0;
      const max = question.scale?.max ?? 5;
      return `Please enter a number from ${min} to ${max}, or type "skip" to skip.`;
    }
    case 'structured':
      return `Please answer "yes", "no", or "partial", or type "skip" to skip.`;
    case 'text':
      return `Please type your response, or type "skip" to skip.`;
    default:
      return `Invalid input. Type "skip" to skip this question.`;
  }
}

// ── D1 persistence ──────────────────────────────────────────────────

/**
 * Write a completed check-in session to D1.
 *
 * Creates a daily_checkin row and symptom_observation rows for each
 * answer (including skipped ones). Determines status as 'complete'
 * (all answered) or 'partial' (some skipped).
 */
export async function persistCheckin(
  db: D1Database,
  session: CheckinSession,
): Promise<string> {
  const now = utcNow();
  const checkinId = generateId();
  const questions = getEnabledQuestions();

  // Determine status: complete if no skips, partial otherwise
  const answers = Object.values(session.answers);
  const hasSkips = answers.some((a) => a.skipped);
  const status = hasSkips ? 'partial' : 'complete';

  // Build batch of D1 statements
  const statements: D1PreparedStatement[] = [];

  // Insert daily_checkin row
  statements.push(
    db
      .prepare(
        `INSERT INTO daily_checkin (id, user_id, checkin_date, status, source, is_retroactive, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'whatsapp', ?, ?, ?)`,
      )
      .bind(
        checkinId,
        session.userId,
        session.checkinDate,
        status,
        session.isRetroactive ? 1 : 0,
        now,
        now,
      ),
  );

  // Insert symptom_observation rows for each question
  for (const question of questions) {
    const answer = session.answers[question.variable_code];
    const obsId = generateId();

    if (answer) {
      // Question was answered or explicitly skipped
      const scaleMin = question.type === 'ordinal' ? (question.scale?.min ?? 0) : null;
      const scaleMax = question.type === 'ordinal' ? (question.scale?.max ?? 5) : null;

      statements.push(
        db
          .prepare(
            `INSERT INTO symptom_observation (id, daily_checkin_id, variable_code, value_numeric, value_text, scale_min, scale_max, skipped, entered_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            obsId,
            checkinId,
            question.variable_code,
            answer.valueNumeric,
            answer.valueText,
            scaleMin,
            scaleMax,
            answer.skipped ? 1 : 0,
            answer.answeredAt,
          ),
      );
    } else {
      // Question was never reached (shouldn't happen if session is complete,
      // but handle defensively)
      const scaleMin = question.type === 'ordinal' ? (question.scale?.min ?? 0) : null;
      const scaleMax = question.type === 'ordinal' ? (question.scale?.max ?? 5) : null;

      statements.push(
        db
          .prepare(
            `INSERT INTO symptom_observation (id, daily_checkin_id, variable_code, value_numeric, value_text, scale_min, scale_max, skipped, entered_at)
             VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?)`,
          )
          .bind(obsId, checkinId, question.variable_code, scaleMin, scaleMax, now),
      );
    }
  }

  // Execute all statements in a batch
  await db.batch(statements);

  return checkinId;
}

// ── Flow handlers ───────────────────────────────────────────────────

/**
 * Start or resume a daily check-in session.
 *
 * If an active session exists in KV, resumes from the last unanswered
 * question. Otherwise creates a new session.
 */
export async function startCheckin(
  env: CheckinFlowEnv,
  userId: string,
  checkinDate: string,
  isRetroactive = false,
): Promise<CheckinFlowResult> {
  const existingSession = await getSession(env.KV, userId);

  if (existingSession) {
    // Resume existing session
    const question = getNextQuestion(existingSession);
    if (!question) {
      // Session is complete but wasn't persisted — persist now
      const checkinId = await persistCheckin(env.DB, existingSession);
      await deleteSession(env.KV, userId);
      const progress = getSessionProgress(existingSession);
      return {
        messages: [
          `✓ Check-in saved (${progress.answered}/${progress.total} answered).`,
        ],
        completed: true,
      };
    }

    const progress = getSessionProgress(existingSession);
    const total = getEnabledQuestions().length;
    return {
      messages: [
        `Resuming your check-in (${progress.answered + progress.skipped}/${total} done).`,
        formatQuestionPrompt(question, existingSession.currentQuestionIndex, total),
      ],
      completed: false,
    };
  }

  // Create new session
  const session = await createSession(env.KV, userId, checkinDate, isRetroactive);
  const question = getNextQuestion(session);
  const total = getEnabledQuestions().length;

  if (!question) {
    return {
      messages: ['No questions configured for check-in.'],
      completed: true,
    };
  }

  const dateLabel = isRetroactive ? `${checkinDate} (retroactive)` : checkinDate;

  return {
    messages: [
      `Starting daily check-in for ${dateLabel}.`,
      formatQuestionPrompt(question, 0, total),
    ],
    completed: false,
  };
}

/**
 * Process a user's answer to the current check-in question.
 *
 * Parses the input, records the answer, advances to the next question
 * or completes the session if all questions are done.
 */
export async function processAnswer(
  env: CheckinFlowEnv,
  userId: string,
  text: string,
): Promise<CheckinFlowResult> {
  const session = await getSession(env.KV, userId);

  if (!session) {
    return {
      messages: ['No active check-in session. Send "checkin" to start one.'],
      completed: false,
    };
  }

  const currentQuestion = getNextQuestion(session);
  if (!currentQuestion) {
    // All questions already answered — persist
    const checkinId = await persistCheckin(env.DB, session);
    await deleteSession(env.KV, userId);
    const progress = getSessionProgress(session);
    return {
      messages: [
        `✓ Check-in saved (${progress.answered}/${progress.total} answered).`,
      ],
      completed: true,
    };
  }

  // Parse the answer
  const parsed = parseAnswer(text, currentQuestion);

  // If the value is null and not skipped, the input was invalid
  if (parsed.value === null && !parsed.skipped) {
    return {
      messages: [formatInvalidInputMessage(currentQuestion)],
      completed: false,
    };
  }

  // Record the answer and advance
  const updatedSession = recordAnswer(
    session,
    currentQuestion.variable_code,
    parsed.value,
    parsed.skipped,
  );
  await saveSession(env.KV, updatedSession);

  // Check if session is now complete
  if (isSessionComplete(updatedSession)) {
    const checkinId = await persistCheckin(env.DB, updatedSession);
    await deleteSession(env.KV, userId);
    const progress = getSessionProgress(updatedSession);
    return {
      messages: [
        `✓ Check-in saved (${progress.answered}/${progress.total} answered).`,
      ],
      completed: true,
    };
  }

  // Get the next question
  const nextQuestion = getNextQuestion(updatedSession);
  const total = getEnabledQuestions().length;

  if (!nextQuestion) {
    // Shouldn't happen since isSessionComplete was false, but handle defensively
    return {
      messages: ['Check-in complete.'],
      completed: true,
    };
  }

  const messages: string[] = [];

  // Add a brief confirmation for the answered question
  if (parsed.skipped) {
    messages.push('Skipped.');
  }

  messages.push(
    formatQuestionPrompt(nextQuestion, updatedSession.currentQuestionIndex, total),
  );

  return { messages, completed: false };
}
