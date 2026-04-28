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
  parseNaturalNumber,
  parseNaturalStructured,
} from './natural-language-parser';
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

// ── OutboundMessage types ───────────────────────────────────────────

/** Base fields shared by all outbound message types. */
export interface OutboundMessageBase {
  body: string;
}

/** A plain text message — used for numeric questions, text questions, and non-question messages. */
export interface TextOutboundMessage extends OutboundMessageBase {
  type: 'text';
}

/** A button option for interactive button messages. */
export interface ButtonOption {
  id: string;    // Reply ID sent back when user taps (max 256 chars)
  title: string; // Button label displayed to user (max 20 chars)
}

/** An interactive button message — used for structured questions (yes/no/partial). */
export interface ButtonsOutboundMessage extends OutboundMessageBase {
  type: 'buttons';
  buttons: ButtonOption[]; // 1–3 buttons
}

/** A list row for interactive list messages. */
export interface ListRow {
  id: string;          // Reply ID sent back when user taps (max 200 chars)
  title: string;       // Row label displayed to user (max 24 chars)
  description?: string; // Optional description below the title (max 72 chars)
}

/** An interactive list message — used for ordinal questions (0–5 scale). */
export interface ListOutboundMessage extends OutboundMessageBase {
  type: 'list';
  buttonLabel: string;  // Label on the button that opens the list (max 20 chars)
  sections: Array<{
    title?: string;     // Optional section header
    rows: ListRow[];    // 1–10 rows per section
  }>;
}

/** Discriminated union of all outbound message types. */
export type OutboundMessage = TextOutboundMessage | ButtonsOutboundMessage | ListOutboundMessage;

// ── OutboundMessage helpers ─────────────────────────────────────────

/** Wrap plain strings as TextOutboundMessage objects. */
export function textMessages(strings: string[]): OutboundMessage[] {
  return strings.map((s) => ({ type: 'text' as const, body: s }));
}

/** Result returned by the flow handler to the caller. */
export interface CheckinFlowResult {
  /** Response message(s) to send back to the user. */
  messages: OutboundMessage[];
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
 *
 * Uses the natural-language parser as a fallback for conversational
 * patterns when strict parsing fails (FR-WA-009).
 */
export function parseNumericAnswer(text: string): number | null {
  const trimmed = text.trim();

  // Try direct number parse first (strict)
  const direct = parseFloat(trimmed);
  if (!isNaN(direct) && isFinite(direct) && direct >= 0) {
    return direct;
  }

  // Fallback to natural-language parser for conversational patterns
  const nlResult = parseNaturalNumber(trimmed);
  if (nlResult) {
    return nlResult.value;
  }

  return null;
}

/**
 * Parse an ordinal answer (0–5 scale).
 * Accepts: "3", "4/5", "mood 4", integers 0–5
 *
 * Uses the natural-language parser as a fallback for conversational
 * patterns when strict parsing fails (FR-WA-009).
 */
export function parseOrdinalAnswer(text: string, min = 0, max = 5): number | null {
  const trimmed = text.trim();

  // Try direct integer parse (strict)
  const direct = parseInt(trimmed, 10);
  if (!isNaN(direct) && direct >= min && direct <= max && String(direct) === trimmed) {
    return direct;
  }

  // Try "N/5" pattern (strict)
  const slashMatch = trimmed.match(/^(\d+)\s*\/\s*\d+$/);
  if (slashMatch) {
    const val = parseInt(slashMatch[1], 10);
    if (!isNaN(val) && val >= min && val <= max) {
      return val;
    }
  }

  // Fallback to natural-language parser for conversational patterns
  const nlResult = parseNaturalNumber(trimmed, min, max);
  if (nlResult) {
    return nlResult.value;
  }

  return null;
}

/**
 * Parse a structured medication adherence answer.
 * Accepts: "yes", "no", "partial" → mapped to 1, 0, 0.5
 *
 * Falls back to natural-language parser for conversational patterns
 * like "yeah", "nope", "took them", "forgot" (FR-WA-009).
 */
export function parseStructuredAnswer(text: string): number | null {
  const lower = text.trim().toLowerCase();

  // Strict matches first
  if (lower === 'yes' || lower === 'y') return 1;
  if (lower === 'no' || lower === 'n') return 0;
  if (lower === 'partial' || lower === 'p') return 0.5;

  // Fallback to natural-language parser
  const nlResult = parseNaturalStructured(text);
  if (nlResult) {
    return nlResult.value;
  }

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

/**
 * Build an OutboundMessage for a check-in question based on its type.
 * Includes the progress indicator in the body text.
 *
 * - ordinal → ListOutboundMessage with rows from scale.min to scale.max
 * - structured → ButtonsOutboundMessage with Yes/No/Partial buttons
 * - numeric, text → TextOutboundMessage
 *
 * Validates: Requirements 3.2, 3.3, 3.4, 3.5
 */
export function buildQuestionMessage(
  question: QuestionDefinition,
  questionIndex: number,
  totalQuestions: number,
): OutboundMessage {
  const progress = `(${questionIndex + 1}/${totalQuestions})`;
  const body = `${progress} ${question.prompt}`;

  switch (question.type) {
    case 'ordinal': {
      const min = question.scale?.min ?? 0;
      const max = question.scale?.max ?? 5;
      const rows: ListRow[] = [];
      for (let i = min; i <= max; i++) {
        let title = `${i}`;
        if (i === min && question.scale?.labels?.min) {
          title = `${i} — ${question.scale.labels.min}`;
        } else if (i === max && question.scale?.labels?.max) {
          title = `${i} — ${question.scale.labels.max}`;
        }
        rows.push({ id: String(i), title });
      }
      return {
        type: 'list',
        body,
        buttonLabel: 'Choose a value',
        sections: [{ rows }],
      };
    }

    case 'structured':
      return {
        type: 'buttons',
        body,
        buttons: [
          { id: 'yes', title: 'Yes' },
          { id: 'no', title: 'No' },
          { id: 'partial', title: 'Partial' },
        ],
      };

    case 'numeric':
    case 'text':
    default:
      return { type: 'text', body };
  }
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
        messages: textMessages([
          `✓ Check-in saved (${progress.answered}/${progress.total} answered).`,
        ]),
        completed: true,
      };
    }

    const progress = getSessionProgress(existingSession);
    const total = getEnabledQuestions().length;
    return {
      messages: [
        ...textMessages([
          `Resuming your check-in (${progress.answered + progress.skipped}/${total} done).`,
        ]),
        buildQuestionMessage(question, existingSession.currentQuestionIndex, total),
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
      messages: textMessages(['No questions configured for check-in.']),
      completed: true,
    };
  }

  const dateLabel = isRetroactive ? `${checkinDate} (retroactive)` : checkinDate;

  return {
    messages: [
      ...textMessages([`Starting daily check-in for ${dateLabel}.`]),
      buildQuestionMessage(question, 0, total),
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
      messages: textMessages(['No active check-in session. Send "checkin" to start one.']),
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
      messages: textMessages([
        `✓ Check-in saved (${progress.answered}/${progress.total} answered).`,
      ]),
      completed: true,
    };
  }

  // Parse the answer
  const parsed = parseAnswer(text, currentQuestion);

  // If the value is null and not skipped, the input was invalid
  if (parsed.value === null && !parsed.skipped) {
    return {
      messages: textMessages([formatInvalidInputMessage(currentQuestion)]),
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
      messages: textMessages([
        `✓ Check-in saved (${progress.answered}/${progress.total} answered).`,
      ]),
      completed: true,
    };
  }

  // Get the next question
  const nextQuestion = getNextQuestion(updatedSession);
  const total = getEnabledQuestions().length;

  if (!nextQuestion) {
    // Shouldn't happen since isSessionComplete was false, but handle defensively
    return {
      messages: textMessages(['Check-in complete.']),
      completed: true,
    };
  }

  const messages: OutboundMessage[] = [];

  // Add a brief confirmation for the answered question
  if (parsed.skipped) {
    messages.push(...textMessages(['Skipped.']));
  }

  messages.push(
    buildQuestionMessage(nextQuestion, updatedSession.currentQuestionIndex, total),
  );

  return { messages, completed: false };
}
