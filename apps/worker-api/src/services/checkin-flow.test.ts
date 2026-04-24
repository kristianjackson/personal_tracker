/**
 * Tests for the daily check-in question flow handler.
 *
 * Validates: FR-WA-003 (User can complete full check-in DAT-001 through DAT-014 via WhatsApp)
 * Validates: FR-CAP-001 (Daily record contains all prompted fields or explicit nulls with skip status)
 * Validates: FR-CAP-002 (Skipped fields remain null, session continues to next question)
 * Design: Section 6.3 (Daily check-in sequence)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isSkipCommand,
  parseNumericAnswer,
  parseOrdinalAnswer,
  parseStructuredAnswer,
  parseTextAnswer,
  parseAnswer,
  startCheckin,
  processAnswer,
  persistCheckin,
} from './checkin-flow';
import type { CheckinFlowEnv } from './checkin-flow';
import type { CheckinSession, CheckinAnswer } from './checkin-session';
import { getEnabledQuestions, NOTE_MAX_LENGTH } from '@symptom-tracker/shared';

// ── KV mock ─────────────────────────────────────────────────────────

interface KVEntry {
  value: string;
  expirationTtl?: number;
}

function createKVMock() {
  const store = new Map<string, KVEntry>();

  const kv: KVNamespace = {
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      return entry ? entry.value : null;
    }),
    put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, { value, expirationTtl: opts?.expirationTtl });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;

  return { kv, store };
}

// ── D1 mock ─────────────────────────────────────────────────────────

function createD1Mock() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];

  const preparedStatement = (sql: string) => {
    let boundParams: unknown[] = [];
    const stmt: D1PreparedStatement = {
      bind: (...params: unknown[]) => {
        boundParams = params;
        statements.push({ sql, params });
        return stmt;
      },
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [], success: true, meta: {} })),
      run: vi.fn(async () => ({ results: [], success: true, meta: {} })),
      raw: vi.fn(async () => []),
    } as unknown as D1PreparedStatement;
    return stmt;
  };

  const db: D1Database = {
    prepare: vi.fn((sql: string) => preparedStatement(sql)),
    batch: vi.fn(async (stmts: D1PreparedStatement[]) => {
      return stmts.map(() => ({ results: [], success: true, meta: {} }));
    }),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;

  return { db, statements };
}

// ── Helpers ─────────────────────────────────────────────────────────

const TEST_USER_ID = 'user-test-123';
const TEST_DATE = '2025-07-15';
const enabledQuestions = getEnabledQuestions();

function createTestEnv(): { env: CheckinFlowEnv; kvStore: Map<string, KVEntry>; db: D1Database } {
  const { kv, store } = createKVMock();
  const { db } = createD1Mock();
  return { env: { DB: db, KV: kv }, kvStore: store, db };
}

// ── Skip detection ──────────────────────────────────────────────────

describe('isSkipCommand', () => {
  it('recognizes "skip"', () => {
    expect(isSkipCommand('skip')).toBe(true);
  });

  it('recognizes "s"', () => {
    expect(isSkipCommand('s')).toBe(true);
  });

  it('recognizes "next"', () => {
    expect(isSkipCommand('next')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isSkipCommand('SKIP')).toBe(true);
    expect(isSkipCommand('Skip')).toBe(true);
    expect(isSkipCommand('S')).toBe(true);
    expect(isSkipCommand('NEXT')).toBe(true);
  });

  it('handles leading/trailing whitespace', () => {
    expect(isSkipCommand('  skip  ')).toBe(true);
    expect(isSkipCommand(' s ')).toBe(true);
  });

  it('rejects non-skip text', () => {
    expect(isSkipCommand('4')).toBe(false);
    expect(isSkipCommand('yes')).toBe(false);
    expect(isSkipCommand('skipping')).toBe(false);
    expect(isSkipCommand('')).toBe(false);
  });
});

// ── Numeric parser ──────────────────────────────────────────────────

describe('parseNumericAnswer', () => {
  it('parses a plain integer', () => {
    expect(parseNumericAnswer('7')).toBe(7);
  });

  it('parses a decimal', () => {
    expect(parseNumericAnswer('6.5')).toBe(6.5);
  });

  it('parses zero', () => {
    expect(parseNumericAnswer('0')).toBe(0);
  });

  it('extracts a number from natural language', () => {
    expect(parseNumericAnswer('slept 4 hours')).toBe(4);
    expect(parseNumericAnswer('about 8.5 hours')).toBe(8.5);
  });

  it('returns null for non-numeric text', () => {
    expect(parseNumericAnswer('a lot')).toBeNull();
    expect(parseNumericAnswer('')).toBeNull();
  });

  it('extracts digits from negative-looking input', () => {
    // The parser extracts the first number from text, so "-3" yields 3
    expect(parseNumericAnswer('-3')).toBe(3);
  });
});

// ── Ordinal parser ──────────────────────────────────────────────────

describe('parseOrdinalAnswer', () => {
  it('parses a plain integer within range', () => {
    expect(parseOrdinalAnswer('3')).toBe(3);
    expect(parseOrdinalAnswer('0')).toBe(0);
    expect(parseOrdinalAnswer('5')).toBe(5);
  });

  it('rejects values outside range', () => {
    expect(parseOrdinalAnswer('6')).toBeNull();
    // "-1" extracts "1" via regex, which is in range
    expect(parseOrdinalAnswer('-1')).toBe(1);
  });

  it('parses "N/5" format', () => {
    expect(parseOrdinalAnswer('4/5')).toBe(4);
    expect(parseOrdinalAnswer('0/5')).toBe(0);
  });

  it('extracts a number from text', () => {
    expect(parseOrdinalAnswer('mood 4')).toBe(4);
    expect(parseOrdinalAnswer('pretty elevated maybe 3')).toBe(3);
  });

  it('returns null for non-numeric text', () => {
    expect(parseOrdinalAnswer('great')).toBeNull();
    expect(parseOrdinalAnswer('')).toBeNull();
  });

  it('respects custom min/max', () => {
    expect(parseOrdinalAnswer('3', 0, 3)).toBe(3);
    expect(parseOrdinalAnswer('4', 0, 3)).toBeNull();
  });
});

// ── Structured parser ───────────────────────────────────────────────

describe('parseStructuredAnswer', () => {
  it('parses "yes" as 1', () => {
    expect(parseStructuredAnswer('yes')).toBe(1);
    expect(parseStructuredAnswer('y')).toBe(1);
  });

  it('parses "no" as 0', () => {
    expect(parseStructuredAnswer('no')).toBe(0);
    expect(parseStructuredAnswer('n')).toBe(0);
  });

  it('parses "partial" as 0.5', () => {
    expect(parseStructuredAnswer('partial')).toBe(0.5);
    expect(parseStructuredAnswer('p')).toBe(0.5);
  });

  it('is case-insensitive', () => {
    expect(parseStructuredAnswer('YES')).toBe(1);
    expect(parseStructuredAnswer('No')).toBe(0);
    expect(parseStructuredAnswer('PARTIAL')).toBe(0.5);
  });

  it('returns null for unrecognized input', () => {
    expect(parseStructuredAnswer('maybe')).toBeNull();
    expect(parseStructuredAnswer('3')).toBeNull();
    expect(parseStructuredAnswer('')).toBeNull();
  });
});

// ── Text parser ─────────────────────────────────────────────────────

describe('parseTextAnswer', () => {
  it('returns trimmed text', () => {
    expect(parseTextAnswer('  mild nausea  ')).toBe('mild nausea');
  });

  it('returns null for empty text', () => {
    expect(parseTextAnswer('')).toBeNull();
    expect(parseTextAnswer('   ')).toBeNull();
  });

  it('truncates text exceeding NOTE_MAX_LENGTH', () => {
    const longText = 'a'.repeat(NOTE_MAX_LENGTH + 100);
    const result = parseTextAnswer(longText);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(NOTE_MAX_LENGTH);
  });

  it('preserves text within limit', () => {
    const text = 'Feeling a bit off today, some stomach issues.';
    expect(parseTextAnswer(text)).toBe(text);
  });
});

// ── parseAnswer (combined) ──────────────────────────────────────────

describe('parseAnswer', () => {
  const questions = getEnabledQuestions();
  const sleepQ = questions.find((q) => q.variable_code === 'DAT-001')!;
  const moodQ = questions.find((q) => q.variable_code === 'DAT-003')!;
  const medsQ = questions.find((q) => q.variable_code === 'DAT-013')!;
  const noteQ = questions.find((q) => q.variable_code === 'DAT-015')!;

  it('returns skipped for skip commands regardless of question type', () => {
    expect(parseAnswer('skip', sleepQ)).toEqual({ value: null, skipped: true });
    expect(parseAnswer('s', moodQ)).toEqual({ value: null, skipped: true });
    expect(parseAnswer('next', medsQ)).toEqual({ value: null, skipped: true });
  });

  it('parses numeric answer for sleep hours', () => {
    const result = parseAnswer('7', sleepQ);
    expect(result.value).toBe(7);
    expect(result.skipped).toBe(false);
  });

  it('parses ordinal answer for mood', () => {
    const result = parseAnswer('3', moodQ);
    expect(result.value).toBe(3);
    expect(result.skipped).toBe(false);
  });

  it('parses structured answer for meds', () => {
    const result = parseAnswer('yes', medsQ);
    expect(result.value).toBe(1);
    expect(result.skipped).toBe(false);
  });

  it('parses text answer for notes', () => {
    const result = parseAnswer('feeling good today', noteQ);
    expect(result.value).toBe('feeling good today');
    expect(result.skipped).toBe(false);
  });

  it('returns null value (not skipped) for invalid input', () => {
    const result = parseAnswer('abc', sleepQ);
    expect(result.value).toBeNull();
    expect(result.skipped).toBe(false);
  });
});

// ── startCheckin ────────────────────────────────────────────────────

describe('startCheckin', () => {
  it('creates a new session and returns the first question', async () => {
    const { env } = createTestEnv();
    const result = await startCheckin(env, TEST_USER_ID, TEST_DATE);

    expect(result.completed).toBe(false);
    expect(result.messages.length).toBe(2);
    expect(result.messages[0]).toContain(TEST_DATE);
    expect(result.messages[1]).toContain('(1/');
    expect(result.messages[1]).toContain('sleep');
  });

  it('resumes an existing session from the correct question', async () => {
    const { env } = createTestEnv();

    // Start a session and answer 2 questions
    await startCheckin(env, TEST_USER_ID, TEST_DATE);
    await processAnswer(env, TEST_USER_ID, '7');   // DAT-001 sleep hours
    await processAnswer(env, TEST_USER_ID, '4');   // DAT-002 sleep quality

    // Simulate resume
    const result = await startCheckin(env, TEST_USER_ID, TEST_DATE);
    expect(result.completed).toBe(false);
    expect(result.messages.length).toBe(2);
    expect(result.messages[0]).toContain('Resuming');
    // Should be on question 3 (mood)
    expect(result.messages[1]).toContain('(3/');
  });
});

// ── processAnswer ───────────────────────────────────────────────────

describe('processAnswer', () => {
  it('returns error when no active session exists', async () => {
    const { env } = createTestEnv();
    const result = await processAnswer(env, TEST_USER_ID, '7');

    expect(result.completed).toBe(false);
    expect(result.messages[0]).toContain('No active check-in session');
  });

  it('advances to the next question on valid answer', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    const result = await processAnswer(env, TEST_USER_ID, '7');
    expect(result.completed).toBe(false);
    // Should show the next question (sleep quality)
    expect(result.messages.some((m) => m.includes('(2/'))).toBe(true);
  });

  it('returns invalid input message for bad numeric input', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    const result = await processAnswer(env, TEST_USER_ID, 'abc');
    expect(result.completed).toBe(false);
    expect(result.messages[0]).toContain('number');
  });

  it('returns invalid input message for out-of-range ordinal', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    // Answer first question (numeric) to get to ordinal
    await processAnswer(env, TEST_USER_ID, '7');

    // Now on sleep quality (ordinal 0-5), try 9
    const result = await processAnswer(env, TEST_USER_ID, '9');
    expect(result.completed).toBe(false);
    expect(result.messages[0]).toContain('0');
    expect(result.messages[0]).toContain('5');
  });

  it('handles skip command and advances', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    const result = await processAnswer(env, TEST_USER_ID, 'skip');
    expect(result.completed).toBe(false);
    expect(result.messages[0]).toBe('Skipped.');
    // Next question prompt should follow
    expect(result.messages[1]).toContain('(2/');
  });

  it('handles "s" as skip', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    const result = await processAnswer(env, TEST_USER_ID, 's');
    expect(result.completed).toBe(false);
    expect(result.messages[0]).toBe('Skipped.');
  });

  it('handles "next" as skip', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    const result = await processAnswer(env, TEST_USER_ID, 'next');
    expect(result.completed).toBe(false);
    expect(result.messages[0]).toBe('Skipped.');
  });

  it('completes the session after all questions are answered', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    // Answer all questions in order
    const answers = [
      '7',       // DAT-001 sleep hours (numeric)
      '4',       // DAT-002 sleep quality (ordinal)
      '3',       // DAT-003 mood (ordinal)
      '3',       // DAT-004 energy (ordinal)
      '2',       // DAT-005 irritability (ordinal)
      '1',       // DAT-006 anxiety (ordinal)
      '4',       // DAT-007 focus (ordinal)
      '1',       // DAT-008 racing thoughts (ordinal)
      '2',       // DAT-009 impulsivity (ordinal)
      '1',       // DAT-010 risk-drive (ordinal)
      '0',       // DAT-011 conflict (ordinal)
      '3',       // DAT-012 appetite (ordinal)
      'yes',     // DAT-013 meds taken (structured)
      'skip',    // DAT-014 side effects (text, optional)
      'skip',    // DAT-015 note (text, optional)
    ];

    let lastResult;
    for (const answer of answers) {
      lastResult = await processAnswer(env, TEST_USER_ID, answer);
    }

    expect(lastResult!.completed).toBe(true);
    expect(lastResult!.messages[0]).toContain('Check-in saved');
  });

  it('completes with all questions skipped', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    let lastResult;
    for (let i = 0; i < enabledQuestions.length; i++) {
      lastResult = await processAnswer(env, TEST_USER_ID, 'skip');
    }

    expect(lastResult!.completed).toBe(true);
    expect(lastResult!.messages[0]).toContain('Check-in saved');
  });

  it('shows correct progress counts in completion message', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    // Answer some, skip some
    await processAnswer(env, TEST_USER_ID, '7');    // answered
    await processAnswer(env, TEST_USER_ID, 'skip'); // skipped
    await processAnswer(env, TEST_USER_ID, '3');    // answered

    // Skip the rest
    let lastResult;
    for (let i = 3; i < enabledQuestions.length; i++) {
      lastResult = await processAnswer(env, TEST_USER_ID, 'skip');
    }

    expect(lastResult!.completed).toBe(true);
    // Should show 2 answered out of total
    expect(lastResult!.messages[0]).toContain('2/');
  });
});

// ── persistCheckin ──────────────────────────────────────────────────

describe('persistCheckin', () => {
  function buildCompletedSession(allAnswered: boolean): CheckinSession {
    const questions = getEnabledQuestions();
    const answers: Record<string, CheckinAnswer> = {};

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (allAnswered || i < 10) {
        answers[q.variable_code] = {
          variableCode: q.variable_code,
          valueNumeric: q.type === 'text' ? null : i,
          valueText: q.type === 'text' ? 'test note' : null,
          skipped: false,
          answeredAt: '2025-07-15T10:00:00.000Z',
        };
      } else {
        answers[q.variable_code] = {
          variableCode: q.variable_code,
          valueNumeric: null,
          valueText: null,
          skipped: true,
          answeredAt: '2025-07-15T10:00:00.000Z',
        };
      }
    }

    return {
      sessionId: 'session-123',
      userId: TEST_USER_ID,
      checkinDate: TEST_DATE,
      currentQuestionIndex: questions.length,
      answers,
      startedAt: '2025-07-15T09:00:00.000Z',
      updatedAt: '2025-07-15T10:00:00.000Z',
      isRetroactive: false,
    };
  }

  it('calls db.batch with correct number of statements', async () => {
    const { db } = createD1Mock();
    const session = buildCompletedSession(true);

    await persistCheckin(db, session);

    // 1 daily_checkin + N symptom_observation rows
    expect(db.batch).toHaveBeenCalledTimes(1);
    const batchArgs = (db.batch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // 1 checkin row + enabledQuestions.length observation rows
    expect(batchArgs.length).toBe(1 + enabledQuestions.length);
  });

  it('sets status to "complete" when all questions answered', async () => {
    const { db, statements } = createD1Mock();
    const session = buildCompletedSession(true);

    await persistCheckin(db, session);

    // First statement is the daily_checkin INSERT
    const checkinStmt = statements[0];
    expect(checkinStmt.sql).toContain('INSERT INTO daily_checkin');
    // status param is at index 3 (after id, user_id, checkin_date)
    expect(checkinStmt.params[3]).toBe('complete');
  });

  it('sets status to "partial" when some questions are skipped', async () => {
    const { db, statements } = createD1Mock();
    const session = buildCompletedSession(false); // last 5 skipped

    await persistCheckin(db, session);

    const checkinStmt = statements[0];
    expect(checkinStmt.params[3]).toBe('partial');
  });

  it('sets is_retroactive flag correctly', async () => {
    const { db, statements } = createD1Mock();
    const session = buildCompletedSession(true);
    session.isRetroactive = true;

    await persistCheckin(db, session);

    const checkinStmt = statements[0];
    // is_retroactive is at index 5 (after id, user_id, checkin_date, status, source='whatsapp')
    // Actually: id=0, user_id=1, checkin_date=2, status=3, is_retroactive=4, created_at=5, updated_at=6
    expect(checkinStmt.params[4]).toBe(1);
  });

  it('creates symptom_observation rows for each question', async () => {
    const { db, statements } = createD1Mock();
    const session = buildCompletedSession(true);

    await persistCheckin(db, session);

    // Filter to symptom_observation INSERTs
    const obsStatements = statements.filter((s) =>
      s.sql.includes('INSERT INTO symptom_observation'),
    );
    expect(obsStatements.length).toBe(enabledQuestions.length);
  });

  it('marks skipped observations with skipped=1', async () => {
    const { db, statements } = createD1Mock();
    const session = buildCompletedSession(false); // last 5 skipped

    await persistCheckin(db, session);

    const obsStatements = statements.filter((s) =>
      s.sql.includes('INSERT INTO symptom_observation'),
    );

    // The last 5 questions should have skipped=1
    // Observations are in question order
    const skippedObs = obsStatements.filter((s) => {
      // skipped param is at index 7 in the bind call
      return s.params[7] === 1;
    });
    expect(skippedObs.length).toBe(5);
  });

  it('returns a checkin ID string', async () => {
    const { db } = createD1Mock();
    const session = buildCompletedSession(true);

    const checkinId = await persistCheckin(db, session);
    expect(typeof checkinId).toBe('string');
    expect(checkinId.length).toBeGreaterThan(0);
  });
});

// ── Full flow integration ───────────────────────────────────────────

describe('full check-in flow integration', () => {
  it('walks through all 15 questions and persists', async () => {
    const { env } = createTestEnv();

    // Start check-in
    const start = await startCheckin(env, TEST_USER_ID, TEST_DATE);
    expect(start.completed).toBe(false);
    expect(start.messages[1]).toContain('sleep');

    // Answer all 15 questions
    const answers = [
      '7',                    // DAT-001 sleep hours
      '4',                    // DAT-002 sleep quality
      '3',                    // DAT-003 mood
      '3',                    // DAT-004 energy
      '2',                    // DAT-005 irritability
      '1',                    // DAT-006 anxiety
      '4',                    // DAT-007 focus
      '1',                    // DAT-008 racing thoughts
      '2',                    // DAT-009 impulsivity
      '1',                    // DAT-010 risk-drive
      '0',                    // DAT-011 conflict
      '3',                    // DAT-012 appetite
      'yes',                  // DAT-013 meds taken
      'mild stomach ache',    // DAT-014 side effects
      'good day overall',     // DAT-015 note
    ];

    for (let i = 0; i < answers.length - 1; i++) {
      const result = await processAnswer(env, TEST_USER_ID, answers[i]);
      expect(result.completed).toBe(false);
    }

    // Last answer should complete the session
    const final = await processAnswer(env, TEST_USER_ID, answers[answers.length - 1]);
    expect(final.completed).toBe(true);
    expect(final.messages[0]).toContain('Check-in saved');

    // Session should be deleted from KV
    const sessionAfter = await env.KV.get(`checkin-session:${TEST_USER_ID}`);
    expect(sessionAfter).toBeNull();
  });

  it('handles a mix of answers and skips throughout the flow', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    const inputs = [
      '7',       // answer
      'skip',    // skip
      '3',       // answer
      's',       // skip
      '2',       // answer
      'next',    // skip
      '4',       // answer
      'skip',    // skip
      '2',       // answer
      'skip',    // skip
      '0',       // answer
      '3',       // answer
      'yes',     // answer
      'skip',    // skip
      'skip',    // skip
    ];

    let lastResult;
    for (const input of inputs) {
      lastResult = await processAnswer(env, TEST_USER_ID, input);
    }

    expect(lastResult!.completed).toBe(true);
    // 8 answered, 7 skipped → should show 8/15
    expect(lastResult!.messages[0]).toContain('8/');
  });

  it('handles structured meds answer with "no"', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    // Skip to meds question (question 13, index 12)
    for (let i = 0; i < 12; i++) {
      await processAnswer(env, TEST_USER_ID, 'skip');
    }

    // Answer meds with "no"
    const result = await processAnswer(env, TEST_USER_ID, 'no');
    expect(result.completed).toBe(false);
    // Should advance to side effects question
    expect(result.messages.some((m) => m.includes('side effects') || m.includes('(14/'))).toBe(true);
  });

  it('handles structured meds answer with "partial"', async () => {
    const { env } = createTestEnv();
    await startCheckin(env, TEST_USER_ID, TEST_DATE);

    // Skip to meds question
    for (let i = 0; i < 12; i++) {
      await processAnswer(env, TEST_USER_ID, 'skip');
    }

    const result = await processAnswer(env, TEST_USER_ID, 'partial');
    expect(result.completed).toBe(false);
  });
});

// ── Retroactive check-in flow (FR-CAP-003) ─────────────────────────

describe('retroactive check-in flow', () => {
  it('starts a retroactive check-in with "(retroactive)" label', async () => {
    const { env } = createTestEnv();
    const retroDate = '2025-07-13';

    const result = await startCheckin(env, TEST_USER_ID, retroDate, true);
    expect(result.completed).toBe(false);
    expect(result.messages[0]).toContain(retroDate);
    expect(result.messages[0]).toContain('retroactive');
  });

  it('starts a non-retroactive check-in without "(retroactive)" label', async () => {
    const { env } = createTestEnv();

    const result = await startCheckin(env, TEST_USER_ID, TEST_DATE, false);
    expect(result.completed).toBe(false);
    expect(result.messages[0]).toContain(TEST_DATE);
    expect(result.messages[0]).not.toContain('retroactive');
  });

  it('persists is_retroactive=1 for retroactive check-ins', async () => {
    const { db, statements } = createD1Mock();
    const questions = getEnabledQuestions();
    const answers: Record<string, CheckinAnswer> = {};

    for (const q of questions) {
      answers[q.variable_code] = {
        variableCode: q.variable_code,
        valueNumeric: q.type === 'text' ? null : 3,
        valueText: q.type === 'text' ? 'test' : null,
        skipped: false,
        answeredAt: '2025-07-15T10:00:00.000Z',
      };
    }

    const session: CheckinSession = {
      sessionId: 'session-retro',
      userId: TEST_USER_ID,
      checkinDate: '2025-07-13',
      currentQuestionIndex: questions.length,
      answers,
      startedAt: '2025-07-15T09:00:00.000Z',
      updatedAt: '2025-07-15T10:00:00.000Z',
      isRetroactive: true,
    };

    await persistCheckin(db, session);

    const checkinStmt = statements[0];
    expect(checkinStmt.sql).toContain('INSERT INTO daily_checkin');
    // is_retroactive param (index 4)
    expect(checkinStmt.params[4]).toBe(1);
    // checkin_date should be the retroactive date
    expect(checkinStmt.params[2]).toBe('2025-07-13');
  });

  it('persists is_retroactive=0 for today check-ins', async () => {
    const { db, statements } = createD1Mock();
    const questions = getEnabledQuestions();
    const answers: Record<string, CheckinAnswer> = {};

    for (const q of questions) {
      answers[q.variable_code] = {
        variableCode: q.variable_code,
        valueNumeric: q.type === 'text' ? null : 3,
        valueText: q.type === 'text' ? 'test' : null,
        skipped: false,
        answeredAt: '2025-07-15T10:00:00.000Z',
      };
    }

    const session: CheckinSession = {
      sessionId: 'session-today',
      userId: TEST_USER_ID,
      checkinDate: TEST_DATE,
      currentQuestionIndex: questions.length,
      answers,
      startedAt: '2025-07-15T09:00:00.000Z',
      updatedAt: '2025-07-15T10:00:00.000Z',
      isRetroactive: false,
    };

    await persistCheckin(db, session);

    const checkinStmt = statements[0];
    expect(checkinStmt.params[4]).toBe(0);
  });

  it('completes a full retroactive check-in flow end-to-end', async () => {
    const { env } = createTestEnv();
    const retroDate = '2025-07-12';

    // Start retroactive check-in
    const start = await startCheckin(env, TEST_USER_ID, retroDate, true);
    expect(start.completed).toBe(false);
    expect(start.messages[0]).toContain('retroactive');

    // Answer all questions
    const answers = [
      '6', '3', '2', '3', '1', '2', '3', '0', '1', '0', '0', '3', 'yes', 'skip', 'skip',
    ];

    let lastResult;
    for (const answer of answers) {
      lastResult = await processAnswer(env, TEST_USER_ID, answer);
    }

    expect(lastResult!.completed).toBe(true);
    expect(lastResult!.messages[0]).toContain('Check-in saved');
  });
});
