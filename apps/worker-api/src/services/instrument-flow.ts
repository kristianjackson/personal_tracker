/**
 * Instrument flow service for weekly screener instruments via WhatsApp.
 *
 * Manages a multi-step guided conversation for completing validated
 * screener instruments. Uses KV for session state (same pattern as
 * checkin-session, injection-flow, and side-effect-capture).
 *
 * Instrument definitions are data-driven: each instrument declares its
 * questions, scale, version, and scoring function. The flow engine is
 * generic — adding a new instrument only requires a new definition.
 *
 * The first instrument is a simplified mania screener (feature-flagged
 * behind `weekly_mania_screener` until licensing is approved).
 *
 * Validates: FR-INST-001 (weekly mania screener flow via WhatsApp)
 * Validates: FR-INST-002 (stores instrument name, version, date, raw responses, calculated score)
 * Validates: FR-INST-004 (feature-flagged until licensing approved)
 * Design: Section 5.10 (instrument_response table)
 */

import {
  generateId,
  utcNow,
  localDateToday,
  isFeatureEnabled,
  CHECKIN_SESSION_TTL_SECONDS,
} from '@symptom-tracker/shared';

// ── Instrument definition types ─────────────────────────────────────

/** A single question within an instrument. */
export interface InstrumentQuestion {
  /** Question identifier within the instrument (e.g. "Q1"). */
  id: string;
  /** Prompt text shown to the user. */
  prompt: string;
  /** Minimum scale value. */
  scaleMin: number;
  /** Maximum scale value. */
  scaleMax: number;
  /** Label for the minimum value. */
  minLabel: string;
  /** Label for the maximum value. */
  maxLabel: string;
}

/** A complete instrument definition (data-driven). */
export interface InstrumentDefinition {
  /** Unique instrument name (e.g. "mania-screener"). */
  name: string;
  /** Semantic version string (e.g. "1.0.0"). */
  version: string;
  /** Human-readable display name. */
  displayName: string;
  /** Feature flag key that must be enabled to use this instrument. */
  featureFlagKey: string;
  /** Ordered list of questions. */
  questions: InstrumentQuestion[];
  /** Scoring function: takes raw answers and returns a total score. */
  calculateScore: (answers: Record<string, number | null>) => number | null;
}

// ── Mania screener definition ───────────────────────────────────────

/**
 * Simplified mania screener instrument.
 *
 * 5 questions on a 0–4 scale covering key mania indicators.
 * Total score range: 0–20. Higher scores indicate more mania symptoms.
 *
 * This is a simplified scaffold — not a licensed clinical instrument.
 * Feature-flagged behind `weekly_mania_screener` per FR-INST-004.
 */
export const MANIA_SCREENER: InstrumentDefinition = {
  name: 'mania-screener',
  version: '1.0.0',
  displayName: 'Mania Screener',
  featureFlagKey: 'weekly_mania_screener',
  questions: [
    {
      id: 'Q1',
      prompt: 'Over the past week, how elevated or euphoric has your mood been? (0=not at all, 4=extreme)',
      scaleMin: 0,
      scaleMax: 4,
      minLabel: 'not at all',
      maxLabel: 'extreme',
    },
    {
      id: 'Q2',
      prompt: 'How much more energy than usual have you had? (0=no change, 4=extreme increase)',
      scaleMin: 0,
      scaleMax: 4,
      minLabel: 'no change',
      maxLabel: 'extreme increase',
    },
    {
      id: 'Q3',
      prompt: 'How much have racing thoughts or rapid speech affected you? (0=not at all, 4=severely)',
      scaleMin: 0,
      scaleMax: 4,
      minLabel: 'not at all',
      maxLabel: 'severely',
    },
    {
      id: 'Q4',
      prompt: 'How much less sleep than usual have you needed while still feeling rested? (0=normal sleep, 4=barely any sleep needed)',
      scaleMin: 0,
      scaleMax: 4,
      minLabel: 'normal sleep',
      maxLabel: 'barely any sleep needed',
    },
    {
      id: 'Q5',
      prompt: 'How much have impulsive or risky behaviors increased? (0=not at all, 4=extreme)',
      scaleMin: 0,
      scaleMax: 4,
      minLabel: 'not at all',
      maxLabel: 'extreme',
    },
  ],
  calculateScore: (answers: Record<string, number | null>): number | null => {
    const values = Object.values(answers);
    // If all questions were skipped, return null
    if (values.every((v) => v === null)) return null;
    // Sum non-null values
    return values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  },
};

/** Registry of all available instruments, keyed by name. */
export const INSTRUMENT_REGISTRY: Record<string, InstrumentDefinition> = {
  [MANIA_SCREENER.name]: MANIA_SCREENER,
};

// ── Session types ───────────────────────────────────────────────────

/** Bindings needed by the instrument flow service. */
export interface InstrumentFlowEnv {
  DB: D1Database;
  KV: KVNamespace;
}

/** Result returned by the instrument flow handler. */
export interface InstrumentFlowResult {
  /** Response message(s) to send back to the user. */
  messages: string[];
  /** Whether the instrument flow is now complete. */
  completed: boolean;
  /** Whether an instrument_response was persisted. */
  saved: boolean;
}

/** A recorded answer within the instrument session. */
export interface InstrumentAnswer {
  questionId: string;
  value: number | null; // null if skipped
  skipped: boolean;
  answeredAt: string; // ISO 8601 UTC
}

/** In-progress instrument session stored in KV. */
export interface InstrumentSession {
  sessionId: string;
  userId: string;
  instrumentName: string;
  instrumentVersion: string;
  currentQuestionIndex: number; // 0-based index into instrument questions
  answers: Record<string, InstrumentAnswer>; // keyed by question id
  responseDate: string; // YYYY-MM-DD local
  startedAt: string; // ISO 8601 UTC
  updatedAt: string; // ISO 8601 UTC
}

// ── Constants ───────────────────────────────────────────────────────

/** KV key prefix for instrument sessions. */
const INSTRUMENT_SESSION_PREFIX = 'instrument-session:';

/** TTL for instrument sessions — reuse the same 4h TTL. */
const INSTRUMENT_SESSION_TTL_SECONDS = CHECKIN_SESSION_TTL_SECONDS;

// ── KV helpers ──────────────────────────────────────────────────────

/** Build the KV key for a user's active instrument session. */
function sessionKey(userId: string): string {
  return `${INSTRUMENT_SESSION_PREFIX}${userId}`;
}

/** Retrieve an existing instrument session from KV. */
export async function getInstrumentSession(
  kv: KVNamespace,
  userId: string,
): Promise<InstrumentSession | null> {
  const raw = await kv.get(sessionKey(userId), 'text');
  if (raw === null) return null;
  return JSON.parse(raw) as InstrumentSession;
}

/** Create a new instrument session and persist it to KV. */
export async function createInstrumentSession(
  kv: KVNamespace,
  userId: string,
  instrument: InstrumentDefinition,
  responseDate: string,
): Promise<InstrumentSession> {
  const now = utcNow();
  const session: InstrumentSession = {
    sessionId: generateId(),
    userId,
    instrumentName: instrument.name,
    instrumentVersion: instrument.version,
    currentQuestionIndex: 0,
    answers: {},
    responseDate,
    startedAt: now,
    updatedAt: now,
  };

  await kv.put(sessionKey(userId), JSON.stringify(session), {
    expirationTtl: INSTRUMENT_SESSION_TTL_SECONDS,
  });

  return session;
}

/** Persist an updated instrument session back to KV, refreshing the TTL. */
export async function saveInstrumentSession(
  kv: KVNamespace,
  session: InstrumentSession,
): Promise<void> {
  await kv.put(sessionKey(session.userId), JSON.stringify(session), {
    expirationTtl: INSTRUMENT_SESSION_TTL_SECONDS,
  });
}

/** Remove an instrument session from KV. */
export async function deleteInstrumentSession(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await kv.delete(sessionKey(userId));
}

// ── Input parsing ───────────────────────────────────────────────────

/**
 * Parse a scale value from user input for a given instrument question.
 * Accepts: integer within [scaleMin, scaleMax], "skip", "s"
 * Returns: { value, skipped } or null for invalid input.
 */
export function parseInstrumentInput(
  text: string,
  question: InstrumentQuestion,
): { value: number | null; skipped: boolean } | null {
  const trimmed = text.trim().toLowerCase();

  // Skip
  if (trimmed === 'skip' || trimmed === 's') {
    return { value: null, skipped: true };
  }

  // Numeric value
  const num = parseInt(trimmed, 10);
  if (isNaN(num) || !isFinite(num)) return null;
  if (num < question.scaleMin || num > question.scaleMax) return null;
  // Ensure the input was actually an integer (reject "2.5" etc.)
  if (trimmed !== String(num)) return null;

  return { value: num, skipped: false };
}

// ── Feature flag check ──────────────────────────────────────────────

/**
 * Check whether an instrument is enabled via its feature flag.
 *
 * Uses the seed config feature flags. In a production system this
 * could also check a KV-based runtime override.
 */
export function isInstrumentEnabled(instrument: InstrumentDefinition): boolean {
  return isFeatureEnabled(instrument.featureFlagKey);
}

// ── D1 persistence ──────────────────────────────────────────────────

/**
 * Persist an instrument_response row to D1.
 *
 * Stores: id, user_id, instrument_name, instrument_version,
 *         response_date, raw_responses (JSON), calculated_score, created_at
 */
export async function persistInstrumentResponse(
  db: D1Database,
  userId: string,
  instrumentName: string,
  instrumentVersion: string,
  responseDate: string,
  rawResponses: Record<string, number | null>,
  calculatedScore: number | null,
): Promise<string> {
  const id = generateId();
  const now = utcNow();

  await db
    .prepare(
      `INSERT INTO instrument_response
         (id, user_id, instrument_name, instrument_version,
          response_date, raw_responses, calculated_score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      instrumentName,
      instrumentVersion,
      responseDate,
      JSON.stringify(rawResponses),
      calculatedScore,
      now,
    )
    .run();

  return id;
}

// ── Flow handlers ───────────────────────────────────────────────────

/**
 * Start a new instrument flow for the given instrument.
 *
 * Checks the feature flag before starting. Creates a KV session
 * and returns the first question prompt.
 */
export async function startInstrumentFlow(
  env: InstrumentFlowEnv,
  userId: string,
  instrumentName: string,
  timezone: string,
): Promise<InstrumentFlowResult> {
  const instrument = INSTRUMENT_REGISTRY[instrumentName];
  if (!instrument) {
    return {
      messages: [`Unknown instrument: ${instrumentName}`],
      completed: true,
      saved: false,
    };
  }

  // Check feature flag (FR-INST-004)
  if (!isInstrumentEnabled(instrument)) {
    return {
      messages: [`${instrument.displayName} is not currently enabled.`],
      completed: true,
      saved: false,
    };
  }

  // Check for existing session
  const existing = await getInstrumentSession(env.KV, userId);
  if (existing) {
    const existingInstrument = INSTRUMENT_REGISTRY[existing.instrumentName];
    if (existingInstrument) {
      const currentQ = existingInstrument.questions[existing.currentQuestionIndex];
      return {
        messages: [
          `Resuming ${existingInstrument.displayName}.`,
          currentQ ? currentQ.prompt : 'All questions answered.',
        ],
        completed: false,
        saved: false,
      };
    }
  }

  // Create new session
  const responseDate = localDateToday(timezone);
  await createInstrumentSession(env.KV, userId, instrument, responseDate);

  const firstQ = instrument.questions[0];
  const intro = `${instrument.displayName} (${instrument.questions.length} questions). Answer each on the scale shown, or "skip".`;

  return {
    messages: [intro, firstQ.prompt],
    completed: false,
    saved: false,
  };
}

/**
 * Process a user's response during an active instrument flow.
 */
export async function processInstrumentResponse(
  env: InstrumentFlowEnv,
  userId: string,
  text: string,
): Promise<InstrumentFlowResult> {
  const session = await getInstrumentSession(env.KV, userId);

  if (!session) {
    return {
      messages: ['No active instrument session.'],
      completed: false,
      saved: false,
    };
  }

  const instrument = INSTRUMENT_REGISTRY[session.instrumentName];
  if (!instrument) {
    await deleteInstrumentSession(env.KV, userId);
    return {
      messages: ['Instrument definition not found. Session cleared.'],
      completed: true,
      saved: false,
    };
  }

  // Validate we haven't gone past the end
  if (session.currentQuestionIndex >= instrument.questions.length) {
    return completeInstrumentFlow(env, session, instrument);
  }

  const currentQ = instrument.questions[session.currentQuestionIndex];
  const parsed = parseInstrumentInput(text, currentQ);

  if (parsed === null) {
    return {
      messages: [
        `Please enter a number ${currentQ.scaleMin}–${currentQ.scaleMax} or "skip". ${currentQ.prompt}`,
      ],
      completed: false,
      saved: false,
    };
  }

  // Record the answer
  const now = utcNow();
  session.answers[currentQ.id] = {
    questionId: currentQ.id,
    value: parsed.value,
    skipped: parsed.skipped,
    answeredAt: now,
  };
  session.currentQuestionIndex += 1;
  session.updatedAt = now;

  // Check if all questions are done
  if (session.currentQuestionIndex >= instrument.questions.length) {
    await saveInstrumentSession(env.KV, session);
    return completeInstrumentFlow(env, session, instrument);
  }

  // Save session and prompt next question
  await saveInstrumentSession(env.KV, session);
  const nextQ = instrument.questions[session.currentQuestionIndex];

  return {
    messages: [nextQ.prompt],
    completed: false,
    saved: false,
  };
}

/**
 * Complete the instrument flow: calculate score, persist to D1, clean up session.
 */
async function completeInstrumentFlow(
  env: InstrumentFlowEnv,
  session: InstrumentSession,
  instrument: InstrumentDefinition,
): Promise<InstrumentFlowResult> {
  // Build raw responses map: questionId → value (or null if skipped)
  const rawResponses: Record<string, number | null> = {};
  for (const q of instrument.questions) {
    const answer = session.answers[q.id];
    rawResponses[q.id] = answer?.value ?? null;
  }

  // Calculate score
  const calculatedScore = instrument.calculateScore(rawResponses);

  // Persist to D1
  await persistInstrumentResponse(
    env.DB,
    session.userId,
    session.instrumentName,
    session.instrumentVersion,
    session.responseDate,
    rawResponses,
    calculatedScore,
  );

  // Clean up session
  await deleteInstrumentSession(env.KV, session.userId);

  const answeredCount = Object.values(session.answers).filter((a) => !a.skipped).length;
  const totalCount = instrument.questions.length;
  const scoreText = calculatedScore !== null ? ` Score: ${calculatedScore}.` : '';

  const confirmation = `✓ ${instrument.displayName} complete (${answeredCount}/${totalCount} answered).${scoreText}`;

  return {
    messages: [confirmation],
    completed: true,
    saved: true,
  };
}
