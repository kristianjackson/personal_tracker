/**
 * Tests for the instrument flow service.
 *
 * Validates: FR-INST-001 (weekly mania screener flow via WhatsApp)
 * Validates: FR-INST-002 (stores instrument name, version, date, raw responses, calculated score)
 * Validates: FR-INST-004 (feature-flagged until licensing approved)
 * Design: Section 5.10 (instrument_response table)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseInstrumentInput,
  isInstrumentEnabled,
  startInstrumentFlow,
  processInstrumentResponse,
  getInstrumentSession,
  persistInstrumentResponse,
  MANIA_SCREENER,
  INSTRUMENT_REGISTRY,
} from './instrument-flow';
import type {
  InstrumentFlowEnv,
  InstrumentSession,
  InstrumentQuestion,
} from './instrument-flow';

// ── D1 mock ─────────────────────────────────────────────────────────

interface MockStatement {
  sql: string;
  params: unknown[];
}

function createD1Mock() {
  const statements: MockStatement[] = [];

  const db: D1Database = {
    prepare: vi.fn((sql: string) => {
      const stmt: D1PreparedStatement = {
        bind: (...params: unknown[]) => {
          statements.push({ sql, params });
          return stmt;
        },
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({ results: [], success: true, meta: {} })),
        run: vi.fn(async () => ({ results: [], success: true, meta: {} })),
        raw: vi.fn(async () => []),
      } as unknown as D1PreparedStatement;
      return stmt;
    }),
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;

  return { db, statements };
}

// ── KV mock ─────────────────────────────────────────────────────────

function createKVMock(initialData: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initialData));

  const kv: KVNamespace = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;

  return { kv, store };
}

// ── Helpers ─────────────────────────────────────────────────────────

const TEST_USER_ID = 'user-inst-test-123';
const TEST_TIMEZONE = 'America/New_York';

// ── MANIA_SCREENER definition ───────────────────────────────────────

describe('MANIA_SCREENER', () => {
  it('has exactly 5 questions', () => {
    expect(MANIA_SCREENER.questions).toHaveLength(5);
  });

  it('has questions with 0–4 scale', () => {
    for (const q of MANIA_SCREENER.questions) {
      expect(q.scaleMin).toBe(0);
      expect(q.scaleMax).toBe(4);
    }
  });

  it('has unique question IDs', () => {
    const ids = MANIA_SCREENER.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each question has a prompt and labels', () => {
    for (const q of MANIA_SCREENER.questions) {
      expect(q.prompt.length).toBeGreaterThan(0);
      expect(q.minLabel.length).toBeGreaterThan(0);
      expect(q.maxLabel.length).toBeGreaterThan(0);
    }
  });

  it('is registered in INSTRUMENT_REGISTRY', () => {
    expect(INSTRUMENT_REGISTRY['mania-screener']).toBe(MANIA_SCREENER);
  });

  it('has name, version, displayName, and featureFlagKey', () => {
    expect(MANIA_SCREENER.name).toBe('mania-screener');
    expect(MANIA_SCREENER.version).toBe('1.0.0');
    expect(MANIA_SCREENER.displayName).toBe('Mania Screener');
    expect(MANIA_SCREENER.featureFlagKey).toBe('weekly_mania_screener');
  });
});

// ── calculateScore ──────────────────────────────────────────────────

describe('MANIA_SCREENER.calculateScore', () => {
  it('sums all non-null values', () => {
    const answers = { Q1: 2, Q2: 3, Q3: 1, Q4: 4, Q5: 0 };
    expect(MANIA_SCREENER.calculateScore(answers)).toBe(10);
  });

  it('treats null (skipped) values as 0 in the sum', () => {
    const answers = { Q1: 2, Q2: null, Q3: 1, Q4: null, Q5: 3 };
    expect(MANIA_SCREENER.calculateScore(answers)).toBe(6);
  });

  it('returns null when all values are null', () => {
    const answers = { Q1: null, Q2: null, Q3: null, Q4: null, Q5: null };
    expect(MANIA_SCREENER.calculateScore(answers)).toBeNull();
  });

  it('returns 0 when all values are 0', () => {
    const answers = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, Q5: 0 };
    expect(MANIA_SCREENER.calculateScore(answers)).toBe(0);
  });

  it('returns max score of 20 when all values are 4', () => {
    const answers = { Q1: 4, Q2: 4, Q3: 4, Q4: 4, Q5: 4 };
    expect(MANIA_SCREENER.calculateScore(answers)).toBe(20);
  });
});

// ── parseInstrumentInput ────────────────────────────────────────────

describe('parseInstrumentInput', () => {
  const question: InstrumentQuestion = {
    id: 'Q1',
    prompt: 'Test question',
    scaleMin: 0,
    scaleMax: 4,
    minLabel: 'none',
    maxLabel: 'extreme',
  };

  it('parses valid values within scale range', () => {
    for (let i = 0; i <= 4; i++) {
      const result = parseInstrumentInput(String(i), question);
      expect(result).toEqual({ value: i, skipped: false });
    }
  });

  it('handles whitespace', () => {
    expect(parseInstrumentInput('  2  ', question)).toEqual({ value: 2, skipped: false });
  });

  it('parses "skip" and "s"', () => {
    expect(parseInstrumentInput('skip', question)).toEqual({ value: null, skipped: true });
    expect(parseInstrumentInput('s', question)).toEqual({ value: null, skipped: true });
    expect(parseInstrumentInput('Skip', question)).toEqual({ value: null, skipped: true });
    expect(parseInstrumentInput('S', question)).toEqual({ value: null, skipped: true });
  });

  it('rejects values above scale max', () => {
    expect(parseInstrumentInput('5', question)).toBeNull();
    expect(parseInstrumentInput('10', question)).toBeNull();
  });

  it('rejects negative values', () => {
    expect(parseInstrumentInput('-1', question)).toBeNull();
  });

  it('rejects non-integer values', () => {
    expect(parseInstrumentInput('2.5', question)).toBeNull();
    expect(parseInstrumentInput('3.0', question)).toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(parseInstrumentInput('abc', question)).toBeNull();
    expect(parseInstrumentInput('', question)).toBeNull();
    expect(parseInstrumentInput('moderate', question)).toBeNull();
  });

  it('works with different scale ranges', () => {
    const q05: InstrumentQuestion = {
      id: 'Q1',
      prompt: 'Test',
      scaleMin: 0,
      scaleMax: 5,
      minLabel: 'none',
      maxLabel: 'extreme',
    };
    expect(parseInstrumentInput('5', q05)).toEqual({ value: 5, skipped: false });
    expect(parseInstrumentInput('6', q05)).toBeNull();
  });
});

// ── isInstrumentEnabled ─────────────────────────────────────────────

describe('isInstrumentEnabled', () => {
  it('returns false for mania screener (default_enabled is false)', () => {
    // The weekly_mania_screener flag is default_enabled: false in feature-flags.json
    expect(isInstrumentEnabled(MANIA_SCREENER)).toBe(false);
  });
});

// ── persistInstrumentResponse ───────────────────────────────────────

describe('persistInstrumentResponse', () => {
  it('inserts an instrument_response row with all fields', async () => {
    const { db, statements } = createD1Mock();
    const rawResponses = { Q1: 2, Q2: 3, Q3: null, Q4: 1, Q5: 4 };

    const id = await persistInstrumentResponse(
      db,
      TEST_USER_ID,
      'mania-screener',
      '1.0.0',
      '2025-01-15',
      rawResponses,
      10,
    );

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const insert = statements.find((s) =>
      s.sql.includes('INSERT INTO instrument_response'),
    );
    expect(insert).toBeDefined();
    expect(insert!.params[0]).toBe(id); // id
    expect(insert!.params[1]).toBe(TEST_USER_ID); // user_id
    expect(insert!.params[2]).toBe('mania-screener'); // instrument_name
    expect(insert!.params[3]).toBe('1.0.0'); // instrument_version
    expect(insert!.params[4]).toBe('2025-01-15'); // response_date
    expect(insert!.params[5]).toBe(JSON.stringify(rawResponses)); // raw_responses
    expect(insert!.params[6]).toBe(10); // calculated_score
  });

  it('handles null calculated_score', async () => {
    const { db, statements } = createD1Mock();

    await persistInstrumentResponse(
      db,
      TEST_USER_ID,
      'mania-screener',
      '1.0.0',
      '2025-01-15',
      { Q1: null, Q2: null, Q3: null, Q4: null, Q5: null },
      null,
    );

    const insert = statements.find((s) =>
      s.sql.includes('INSERT INTO instrument_response'),
    );
    expect(insert).toBeDefined();
    expect(insert!.params[6]).toBeNull(); // calculated_score
  });
});

// ── startInstrumentFlow ─────────────────────────────────────────────

describe('startInstrumentFlow', () => {
  it('returns error for unknown instrument', async () => {
    const { db } = createD1Mock();
    const { kv } = createKVMock();
    const env: InstrumentFlowEnv = { DB: db, KV: kv };

    const result = await startInstrumentFlow(env, TEST_USER_ID, 'nonexistent', TEST_TIMEZONE);

    expect(result.completed).toBe(true);
    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('Unknown instrument');
  });

  it('returns disabled message when feature flag is off', async () => {
    const { db } = createD1Mock();
    const { kv } = createKVMock();
    const env: InstrumentFlowEnv = { DB: db, KV: kv };

    // weekly_mania_screener is default_enabled: false
    const result = await startInstrumentFlow(env, TEST_USER_ID, 'mania-screener', TEST_TIMEZONE);

    expect(result.completed).toBe(true);
    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('not currently enabled');
  });

  it('creates session and returns intro + first prompt when enabled', async () => {
    const { db } = createD1Mock();
    const { kv } = createKVMock();
    const env: InstrumentFlowEnv = { DB: db, KV: kv };

    // Mock isFeatureEnabled to return true for this test
    const shared = await import('@symptom-tracker/shared');
    const spy = vi.spyOn(shared, 'isFeatureEnabled').mockReturnValue(true);

    try {
      const result = await startInstrumentFlow(env, TEST_USER_ID, 'mania-screener', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      expect(result.saved).toBe(false);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toContain('Mania Screener');
      expect(result.messages[0]).toContain('5 questions');
      expect(result.messages[1]).toContain('elevated or euphoric');

      // Verify session was created in KV
      const session = await getInstrumentSession(kv, TEST_USER_ID);
      expect(session).not.toBeNull();
      expect(session!.instrumentName).toBe('mania-screener');
      expect(session!.instrumentVersion).toBe('1.0.0');
      expect(session!.currentQuestionIndex).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('resumes an existing session', async () => {
    const existingSession: InstrumentSession = {
      sessionId: 'existing-inst-session',
      userId: TEST_USER_ID,
      instrumentName: 'mania-screener',
      instrumentVersion: '1.0.0',
      currentQuestionIndex: 2,
      answers: {},
      responseDate: '2025-01-15',
      startedAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-15T12:05:00.000Z',
    };

    const { db } = createD1Mock();
    const { kv } = createKVMock({
      [`instrument-session:${TEST_USER_ID}`]: JSON.stringify(existingSession),
    });
    const env: InstrumentFlowEnv = { DB: db, KV: kv };

    const shared = await import('@symptom-tracker/shared');
    const spy = vi.spyOn(shared, 'isFeatureEnabled').mockReturnValue(true);

    try {
      const result = await startInstrumentFlow(env, TEST_USER_ID, 'mania-screener', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('Resuming');
      expect(result.messages[0]).toContain('Mania Screener');
      // Should show the prompt for question index 2 (Q3)
      expect(result.messages[1]).toContain('racing thoughts');
    } finally {
      spy.mockRestore();
    }
  });
});

// ── processInstrumentResponse ───────────────────────────────────────

describe('processInstrumentResponse', () => {
  it('returns error when no active session', async () => {
    const { db } = createD1Mock();
    const { kv } = createKVMock();
    const env: InstrumentFlowEnv = { DB: db, KV: kv };

    const result = await processInstrumentResponse(env, TEST_USER_ID, '3');

    expect(result.completed).toBe(false);
    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('No active instrument session');
  });

  describe('step-by-step flow', () => {
    let env: InstrumentFlowEnv;
    let kv: KVNamespace;

    beforeEach(async () => {
      const { db } = createD1Mock();
      const kvMock = createKVMock();
      kv = kvMock.kv;
      env = { DB: db, KV: kv };

      const shared = await import('@symptom-tracker/shared');
      vi.spyOn(shared, 'isFeatureEnabled').mockReturnValue(true);

      await startInstrumentFlow(env, TEST_USER_ID, 'mania-screener', TEST_TIMEZONE);
    });

    it('accepts a valid value and advances to next question', async () => {
      const result = await processInstrumentResponse(env, TEST_USER_ID, '3');

      expect(result.completed).toBe(false);
      // Should prompt for Q2 (energy)
      expect(result.messages[0]).toContain('energy');

      const session = await getInstrumentSession(kv, TEST_USER_ID);
      expect(session!.currentQuestionIndex).toBe(1);
      expect(session!.answers['Q1']).toBeDefined();
      expect(session!.answers['Q1'].value).toBe(3);
      expect(session!.answers['Q1'].skipped).toBe(false);
    });

    it('accepts "skip" and advances to next question', async () => {
      const result = await processInstrumentResponse(env, TEST_USER_ID, 'skip');

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('energy');

      const session = await getInstrumentSession(kv, TEST_USER_ID);
      expect(session!.answers['Q1'].skipped).toBe(true);
      expect(session!.answers['Q1'].value).toBeNull();
    });

    it('accepts "s" as skip shorthand', async () => {
      const result = await processInstrumentResponse(env, TEST_USER_ID, 's');

      expect(result.completed).toBe(false);
      const session = await getInstrumentSession(kv, TEST_USER_ID);
      expect(session!.answers['Q1'].skipped).toBe(true);
    });

    it('rejects invalid input and re-prompts', async () => {
      const result = await processInstrumentResponse(env, TEST_USER_ID, 'abc');

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('0–4');
      expect(result.messages[0]).toContain('skip');

      // Session should not advance
      const session = await getInstrumentSession(kv, TEST_USER_ID);
      expect(session!.currentQuestionIndex).toBe(0);
    });

    it('rejects out-of-range values (5 on a 0–4 scale)', async () => {
      const result = await processInstrumentResponse(env, TEST_USER_ID, '5');

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('0–4');
    });

    it('accepts value 0', async () => {
      const result = await processInstrumentResponse(env, TEST_USER_ID, '0');

      expect(result.completed).toBe(false);
      const session = await getInstrumentSession(kv, TEST_USER_ID);
      expect(session!.answers['Q1'].value).toBe(0);
      expect(session!.answers['Q1'].skipped).toBe(false);
    });

    it('accepts max value 4', async () => {
      const result = await processInstrumentResponse(env, TEST_USER_ID, '4');

      expect(result.completed).toBe(false);
      const session = await getInstrumentSession(kv, TEST_USER_ID);
      expect(session!.answers['Q1'].value).toBe(4);
    });
  });
});

// ── Full flow integration ───────────────────────────────────────────

describe('full instrument flow', () => {
  let featureSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const shared = await import('@symptom-tracker/shared');
    featureSpy = vi.spyOn(shared, 'isFeatureEnabled').mockReturnValue(true);
  });

  it('completes a full flow with all values and persists instrument_response', async () => {
    const { db, statements } = createD1Mock();
    const { kv } = createKVMock();
    const env: InstrumentFlowEnv = { DB: db, KV: kv };

    // Start flow
    const start = await startInstrumentFlow(env, TEST_USER_ID, 'mania-screener', TEST_TIMEZONE);
    expect(start.completed).toBe(false);
    expect(start.messages[0]).toContain('Mania Screener');

    // Answer all 5 questions
    const values = ['2', '3', '1', '4', '0'];
    for (let i = 0; i < 4; i++) {
      const result = await processInstrumentResponse(env, TEST_USER_ID, values[i]);
      expect(result.completed).toBe(false);
    }

    // Last answer completes the flow
    const final = await processInstrumentResponse(env, TEST_USER_ID, values[4]);
    expect(final.completed).toBe(true);
    expect(final.saved).toBe(true);
    expect(final.messages[0]).toContain('✓');
    expect(final.messages[0]).toContain('5/5');
    // Score: 2+3+1+4+0 = 10
    expect(final.messages[0]).toContain('Score: 10');

    // Session should be cleaned up
    const session = await getInstrumentSession(kv, TEST_USER_ID);
    expect(session).toBeNull();

    // Verify D1 insert
    const inserts = statements.filter((s) =>
      s.sql.includes('INSERT INTO instrument_response'),
    );
    expect(inserts).toHaveLength(1);

    const insert = inserts[0];
    expect(insert.params[1]).toBe(TEST_USER_ID); // user_id
    expect(insert.params[2]).toBe('mania-screener'); // instrument_name
    expect(insert.params[3]).toBe('1.0.0'); // instrument_version
    // raw_responses should be JSON with all answers
    const rawResponses = JSON.parse(insert.params[5] as string);
    expect(rawResponses).toEqual({ Q1: 2, Q2: 3, Q3: 1, Q4: 4, Q5: 0 });
    expect(insert.params[6]).toBe(10); // calculated_score
  });

  it('completes a flow with some skipped questions', async () => {
    const { db, statements } = createD1Mock();
    const { kv } = createKVMock();
    const env: InstrumentFlowEnv = { DB: db, KV: kv };

    await startInstrumentFlow(env, TEST_USER_ID, 'mania-screener', TEST_TIMEZONE);

    // Answer: 2, skip, 1, skip, 3
    const inputs = ['2', 'skip', '1', 's', '3'];
    for (let i = 0; i < 4; i++) {
      await processInstrumentResponse(env, TEST_USER_ID, inputs[i]);
    }

    const final = await processInstrumentResponse(env, TEST_USER_ID, inputs[4]);
    expect(final.completed).toBe(true);
    expect(final.saved).toBe(true);
    expect(final.messages[0]).toContain('3/5');
    // Score: 2+0+1+0+3 = 6 (skipped treated as 0)
    expect(final.messages[0]).toContain('Score: 6');

    const session = await getInstrumentSession(kv, TEST_USER_ID);
    expect(session).toBeNull();

    const inserts = statements.filter((s) =>
      s.sql.includes('INSERT INTO instrument_response'),
    );
    expect(inserts).toHaveLength(1);

    const rawResponses = JSON.parse(inserts[0].params[5] as string);
    expect(rawResponses).toEqual({ Q1: 2, Q2: null, Q3: 1, Q4: null, Q5: 3 });
  });

  it('completes a flow with all questions skipped (null score)', async () => {
    const { db, statements } = createD1Mock();
    const { kv } = createKVMock();
    const env: InstrumentFlowEnv = { DB: db, KV: kv };

    await startInstrumentFlow(env, TEST_USER_ID, 'mania-screener', TEST_TIMEZONE);

    for (let i = 0; i < 4; i++) {
      await processInstrumentResponse(env, TEST_USER_ID, 'skip');
    }

    const final = await processInstrumentResponse(env, TEST_USER_ID, 'skip');
    expect(final.completed).toBe(true);
    expect(final.saved).toBe(true);
    expect(final.messages[0]).toContain('0/5');
    // Score should not appear when null
    expect(final.messages[0]).not.toContain('Score:');

    const inserts = statements.filter((s) =>
      s.sql.includes('INSERT INTO instrument_response'),
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[6]).toBeNull(); // calculated_score
  });

  it('handles invalid inputs at each step and retries', async () => {
    const { db } = createD1Mock();
    const { kv } = createKVMock();
    const env: InstrumentFlowEnv = { DB: db, KV: kv };

    await startInstrumentFlow(env, TEST_USER_ID, 'mania-screener', TEST_TIMEZONE);

    // Invalid input
    let result = await processInstrumentResponse(env, TEST_USER_ID, 'abc');
    expect(result.messages[0]).toContain('0–4');

    // Valid input after retry
    result = await processInstrumentResponse(env, TEST_USER_ID, '2');
    expect(result.messages[0]).toContain('energy');

    // Out of range
    result = await processInstrumentResponse(env, TEST_USER_ID, '8');
    expect(result.messages[0]).toContain('0–4');

    // Valid skip
    result = await processInstrumentResponse(env, TEST_USER_ID, 'skip');
    expect(result.messages[0]).toContain('racing thoughts');
  });

  it('stores correct response_date from user timezone', async () => {
    const { db, statements } = createD1Mock();
    const { kv } = createKVMock();
    const env: InstrumentFlowEnv = { DB: db, KV: kv };

    await startInstrumentFlow(env, TEST_USER_ID, 'mania-screener', TEST_TIMEZONE);

    // Complete all questions quickly
    for (let i = 0; i < 4; i++) {
      await processInstrumentResponse(env, TEST_USER_ID, '1');
    }
    await processInstrumentResponse(env, TEST_USER_ID, '1');

    const inserts = statements.filter((s) =>
      s.sql.includes('INSERT INTO instrument_response'),
    );
    expect(inserts).toHaveLength(1);

    // response_date should be a YYYY-MM-DD string
    const responseDate = inserts[0].params[4] as string;
    expect(responseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
