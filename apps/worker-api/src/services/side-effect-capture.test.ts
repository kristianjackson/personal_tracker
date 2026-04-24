/**
 * Tests for the side-effect capture service.
 *
 * Validates: FR-MED-003 (side-effect observations linked to nearest injection within 72h)
 * Validates: DAT-024 (Nausea), DAT-025 (Diarrhea), DAT-026 (Vomiting)
 * Validates: DAT-027 (Constipation), DAT-028 (Abdominal pain)
 * Validates: DAT-029 (Hydration difficulty), DAT-030 (Appetite suppression)
 * Design: Section 5.8 (side_effect_observation table)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseSeverityInput,
  startSideEffectCapture,
  processSideEffectResponse,
  getSideEffectSession,
  findNearestInjectionEvent,
  persistSideEffectObservation,
  SIDE_EFFECT_VARIABLES,
  WATCH_WINDOW_MS,
} from './side-effect-capture';
import type { SideEffectCaptureEnv, SideEffectSession } from './side-effect-capture';

// ── D1 mock ─────────────────────────────────────────────────────────

interface MockStatement {
  sql: string;
  params: unknown[];
}

function createD1Mock(options: {
  nearestInjection?: { id: string; event_at: string } | null;
} = {}) {
  const statements: MockStatement[] = [];

  const db: D1Database = {
    prepare: vi.fn((sql: string) => {
      const firstFn = vi.fn(async () => {
        if (sql.includes('medication_event') && sql.includes('injected')) {
          return options.nearestInjection ?? null;
        }
        return null;
      });

      const stmt: D1PreparedStatement = {
        bind: (...params: unknown[]) => {
          statements.push({ sql, params });
          return stmt;
        },
        first: firstFn,
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

const TEST_USER_ID = 'user-se-test-123';
const TEST_TIMEZONE = 'America/New_York';
const TEST_INJECTION_EVENT = {
  id: 'med-event-inject-001',
  event_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
};

// ── parseSeverityInput ──────────────────────────────────────────────

describe('parseSeverityInput', () => {
  it('parses valid severity values 0–5', () => {
    for (let i = 0; i <= 5; i++) {
      const result = parseSeverityInput(String(i));
      expect(result).toEqual({ severity: i, skipped: false });
    }
  });

  it('handles whitespace', () => {
    expect(parseSeverityInput('  3  ')).toEqual({ severity: 3, skipped: false });
  });

  it('parses "skip" and "s"', () => {
    expect(parseSeverityInput('skip')).toEqual({ severity: null, skipped: true });
    expect(parseSeverityInput('s')).toEqual({ severity: null, skipped: true });
    expect(parseSeverityInput('Skip')).toEqual({ severity: null, skipped: true });
    expect(parseSeverityInput('S')).toEqual({ severity: null, skipped: true });
  });

  it('rejects out-of-range values', () => {
    expect(parseSeverityInput('-1')).toBeNull();
    expect(parseSeverityInput('6')).toBeNull();
    expect(parseSeverityInput('10')).toBeNull();
  });

  it('rejects non-integer values', () => {
    expect(parseSeverityInput('2.5')).toBeNull();
    expect(parseSeverityInput('3.0')).toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(parseSeverityInput('abc')).toBeNull();
    expect(parseSeverityInput('')).toBeNull();
    expect(parseSeverityInput('moderate')).toBeNull();
  });
});

// ── SIDE_EFFECT_VARIABLES ───────────────────────────────────────────

describe('SIDE_EFFECT_VARIABLES', () => {
  it('has exactly 7 variables', () => {
    expect(SIDE_EFFECT_VARIABLES).toHaveLength(7);
  });

  it('covers DAT-024 through DAT-030', () => {
    const codes = SIDE_EFFECT_VARIABLES.map((v) => v.code);
    expect(codes).toEqual([
      'DAT-024',
      'DAT-025',
      'DAT-026',
      'DAT-027',
      'DAT-028',
      'DAT-029',
      'DAT-030',
    ]);
  });

  it('each variable has a label and prompt', () => {
    for (const v of SIDE_EFFECT_VARIABLES) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.prompt.length).toBeGreaterThan(0);
      expect(v.prompt).toContain('0=none');
      expect(v.prompt).toContain('5=severe');
    }
  });
});

// ── findNearestInjectionEvent ───────────────────────────────────────

describe('findNearestInjectionEvent', () => {
  it('returns the nearest injection event within 72h', async () => {
    const { db } = createD1Mock({ nearestInjection: TEST_INJECTION_EVENT });

    const result = await findNearestInjectionEvent(db, TEST_USER_ID);

    expect(result).toEqual(TEST_INJECTION_EVENT);
  });

  it('returns null when no injection found', async () => {
    const { db } = createD1Mock({ nearestInjection: null });

    const result = await findNearestInjectionEvent(db, TEST_USER_ID);

    expect(result).toBeNull();
  });

  it('passes correct time window parameters', async () => {
    const { db, statements } = createD1Mock({ nearestInjection: null });
    const refTime = '2025-01-15T12:00:00.000Z';

    await findNearestInjectionEvent(db, TEST_USER_ID, refTime);

    const query = statements.find((s) => s.sql.includes('medication_event'));
    expect(query).toBeDefined();
    expect(query!.params[0]).toBe(TEST_USER_ID);
    // Window start should be 72h before reference time
    const windowStart = new Date(
      new Date(refTime).getTime() - WATCH_WINDOW_MS,
    ).toISOString();
    expect(query!.params[1]).toBe(windowStart);
    expect(query!.params[2]).toBe(refTime);
  });
});

// ── persistSideEffectObservation ────────────────────────────────────

describe('persistSideEffectObservation', () => {
  it('inserts a side_effect_observation row', async () => {
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

    const id = await persistSideEffectObservation(
      db,
      TEST_USER_ID,
      'med-event-001',
      'DAT-024',
      3,
      '2025-01-15',
    );

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const insert = statements.find((s) =>
      s.sql.includes('INSERT INTO side_effect_observation'),
    );
    expect(insert).toBeDefined();
    expect(insert!.params[0]).toBe(id); // id
    expect(insert!.params[1]).toBe(TEST_USER_ID); // user_id
    expect(insert!.params[2]).toBe('med-event-001'); // linked_medication_event_id
    expect(insert!.params[3]).toBe('DAT-024'); // variable_code
    expect(insert!.params[4]).toBe(3); // severity
    expect(insert!.params[5]).toBe('2025-01-15'); // observed_date
  });

  it('handles null linked_medication_event_id', async () => {
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

    await persistSideEffectObservation(
      db,
      TEST_USER_ID,
      null,
      'DAT-025',
      2,
      '2025-01-15',
    );

    const insert = statements.find((s) =>
      s.sql.includes('INSERT INTO side_effect_observation'),
    );
    expect(insert).toBeDefined();
    expect(insert!.params[2]).toBeNull(); // linked_medication_event_id
  });
});

// ── startSideEffectCapture ──────────────────────────────────────────

describe('startSideEffectCapture', () => {
  it('creates a new session and returns intro + first prompt', async () => {
    const { db } = createD1Mock({ nearestInjection: TEST_INJECTION_EVENT });
    const { kv } = createKVMock();
    const env: SideEffectCaptureEnv = { DB: db, KV: kv };

    const result = await startSideEffectCapture(env, TEST_USER_ID, TEST_TIMEZONE);

    expect(result.completed).toBe(false);
    expect(result.savedCount).toBe(0);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toContain('72h side-effect check');
    expect(result.messages[1]).toContain('Nausea');

    // Verify session was created in KV
    const session = await getSideEffectSession(kv, TEST_USER_ID);
    expect(session).not.toBeNull();
    expect(session!.currentQuestionIndex).toBe(0);
    expect(session!.linkedMedicationEventId).toBe(TEST_INJECTION_EVENT.id);
  });

  it('shows different intro when no injection found', async () => {
    const { db } = createD1Mock({ nearestInjection: null });
    const { kv } = createKVMock();
    const env: SideEffectCaptureEnv = { DB: db, KV: kv };

    const result = await startSideEffectCapture(env, TEST_USER_ID, TEST_TIMEZONE);

    expect(result.messages[0]).toContain('no recent injection found');

    const session = await getSideEffectSession(kv, TEST_USER_ID);
    expect(session!.linkedMedicationEventId).toBeNull();
  });

  it('resumes an existing session', async () => {
    const existingSession: SideEffectSession = {
      sessionId: 'existing-se-session',
      userId: TEST_USER_ID,
      currentQuestionIndex: 3,
      answers: {},
      linkedMedicationEventId: 'med-event-001',
      observedDate: '2025-01-15',
      startedAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-15T12:05:00.000Z',
    };

    const { db } = createD1Mock({ nearestInjection: TEST_INJECTION_EVENT });
    const { kv } = createKVMock({
      [`side-effect-session:${TEST_USER_ID}`]: JSON.stringify(existingSession),
    });
    const env: SideEffectCaptureEnv = { DB: db, KV: kv };

    const result = await startSideEffectCapture(env, TEST_USER_ID, TEST_TIMEZONE);

    expect(result.completed).toBe(false);
    expect(result.messages[0]).toContain('Resuming');
    // Should show the prompt for question index 3 (Constipation)
    expect(result.messages[1]).toContain('Constipation');
  });
});

// ── processSideEffectResponse ───────────────────────────────────────

describe('processSideEffectResponse', () => {
  it('returns error when no active session', async () => {
    const { db } = createD1Mock();
    const { kv } = createKVMock();
    const env: SideEffectCaptureEnv = { DB: db, KV: kv };

    const result = await processSideEffectResponse(env, TEST_USER_ID, '3');

    expect(result.completed).toBe(false);
    expect(result.savedCount).toBe(0);
    expect(result.messages[0]).toContain('No active side-effect session');
  });

  describe('step-by-step flow', () => {
    let env: SideEffectCaptureEnv;
    let kv: KVNamespace;

    beforeEach(async () => {
      const { db } = createD1Mock({ nearestInjection: TEST_INJECTION_EVENT });
      const kvMock = createKVMock();
      kv = kvMock.kv;
      env = { DB: db, KV: kv };

      await startSideEffectCapture(env, TEST_USER_ID, TEST_TIMEZONE);
    });

    it('accepts a valid severity and advances to next question', async () => {
      const result = await processSideEffectResponse(env, TEST_USER_ID, '3');

      expect(result.completed).toBe(false);
      // Should prompt for Diarrhea (DAT-025)
      expect(result.messages[0]).toContain('Diarrhea');

      const session = await getSideEffectSession(kv, TEST_USER_ID);
      expect(session!.currentQuestionIndex).toBe(1);
      expect(session!.answers['DAT-024']).toBeDefined();
      expect(session!.answers['DAT-024'].severity).toBe(3);
      expect(session!.answers['DAT-024'].skipped).toBe(false);
    });

    it('accepts "skip" and advances to next question', async () => {
      const result = await processSideEffectResponse(env, TEST_USER_ID, 'skip');

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('Diarrhea');

      const session = await getSideEffectSession(kv, TEST_USER_ID);
      expect(session!.answers['DAT-024'].skipped).toBe(true);
      expect(session!.answers['DAT-024'].severity).toBeNull();
    });

    it('accepts "s" as skip shorthand', async () => {
      const result = await processSideEffectResponse(env, TEST_USER_ID, 's');

      expect(result.completed).toBe(false);
      const session = await getSideEffectSession(kv, TEST_USER_ID);
      expect(session!.answers['DAT-024'].skipped).toBe(true);
    });

    it('rejects invalid input and re-prompts', async () => {
      const result = await processSideEffectResponse(env, TEST_USER_ID, 'abc');

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('0–5');
      expect(result.messages[0]).toContain('skip');

      // Session should not advance
      const session = await getSideEffectSession(kv, TEST_USER_ID);
      expect(session!.currentQuestionIndex).toBe(0);
    });

    it('rejects out-of-range values', async () => {
      const result = await processSideEffectResponse(env, TEST_USER_ID, '7');

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('0–5');
    });

    it('accepts severity 0 (none)', async () => {
      const result = await processSideEffectResponse(env, TEST_USER_ID, '0');

      expect(result.completed).toBe(false);
      const session = await getSideEffectSession(kv, TEST_USER_ID);
      expect(session!.answers['DAT-024'].severity).toBe(0);
      expect(session!.answers['DAT-024'].skipped).toBe(false);
    });

    it('accepts severity 5 (severe)', async () => {
      const result = await processSideEffectResponse(env, TEST_USER_ID, '5');

      expect(result.completed).toBe(false);
      const session = await getSideEffectSession(kv, TEST_USER_ID);
      expect(session!.answers['DAT-024'].severity).toBe(5);
    });
  });
});

// ── Full flow integration ───────────────────────────────────────────

describe('full side-effect capture flow', () => {
  it('completes a full flow with all values and persists observations', async () => {
    const { db, statements } = createD1Mock({
      nearestInjection: TEST_INJECTION_EVENT,
    });
    const { kv } = createKVMock();
    const env: SideEffectCaptureEnv = { DB: db, KV: kv };

    // Start flow
    const start = await startSideEffectCapture(env, TEST_USER_ID, TEST_TIMEZONE);
    expect(start.completed).toBe(false);
    expect(start.messages[0]).toContain('72h side-effect check');

    // Answer all 7 questions with different severities
    const severities = ['2', '1', '0', '3', '4', '1', '5'];
    for (let i = 0; i < 6; i++) {
      const result = await processSideEffectResponse(
        env,
        TEST_USER_ID,
        severities[i],
      );
      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain(SIDE_EFFECT_VARIABLES[i + 1].label);
    }

    // Last answer completes the flow
    const final = await processSideEffectResponse(env, TEST_USER_ID, severities[6]);
    expect(final.completed).toBe(true);
    expect(final.savedCount).toBe(7);
    expect(final.messages[0]).toContain('✓');
    expect(final.messages[0]).toContain('7/7');

    // Session should be cleaned up
    const session = await getSideEffectSession(kv, TEST_USER_ID);
    expect(session).toBeNull();

    // Verify D1 inserts
    const inserts = statements.filter((s) =>
      s.sql.includes('INSERT INTO side_effect_observation'),
    );
    expect(inserts).toHaveLength(7);

    // Verify linked_medication_event_id is set on all inserts
    for (const insert of inserts) {
      expect(insert.params[2]).toBe(TEST_INJECTION_EVENT.id);
    }
  });

  it('completes a flow with some skipped questions', async () => {
    const { db, statements } = createD1Mock({
      nearestInjection: TEST_INJECTION_EVENT,
    });
    const { kv } = createKVMock();
    const env: SideEffectCaptureEnv = { DB: db, KV: kv };

    await startSideEffectCapture(env, TEST_USER_ID, TEST_TIMEZONE);

    // Answer: 3, skip, 2, skip, skip, 1, 4
    const inputs = ['3', 'skip', '2', 's', 'skip', '1', '4'];
    for (let i = 0; i < 6; i++) {
      await processSideEffectResponse(env, TEST_USER_ID, inputs[i]);
    }

    const final = await processSideEffectResponse(env, TEST_USER_ID, inputs[6]);
    expect(final.completed).toBe(true);
    expect(final.savedCount).toBe(4); // 3 skipped, 4 recorded
    expect(final.messages[0]).toContain('4/7');

    const session = await getSideEffectSession(kv, TEST_USER_ID);
    expect(session).toBeNull();

    const inserts = statements.filter((s) =>
      s.sql.includes('INSERT INTO side_effect_observation'),
    );
    expect(inserts).toHaveLength(4);
  });

  it('completes a flow with all questions skipped', async () => {
    const { db, statements } = createD1Mock({
      nearestInjection: TEST_INJECTION_EVENT,
    });
    const { kv } = createKVMock();
    const env: SideEffectCaptureEnv = { DB: db, KV: kv };

    await startSideEffectCapture(env, TEST_USER_ID, TEST_TIMEZONE);

    for (let i = 0; i < 6; i++) {
      await processSideEffectResponse(env, TEST_USER_ID, 'skip');
    }

    const final = await processSideEffectResponse(env, TEST_USER_ID, 'skip');
    expect(final.completed).toBe(true);
    expect(final.savedCount).toBe(0);
    expect(final.messages[0]).toContain('all skipped');

    const inserts = statements.filter((s) =>
      s.sql.includes('INSERT INTO side_effect_observation'),
    );
    expect(inserts).toHaveLength(0);
  });

  it('handles invalid inputs at each step and retries', async () => {
    const { db } = createD1Mock({ nearestInjection: TEST_INJECTION_EVENT });
    const { kv } = createKVMock();
    const env: SideEffectCaptureEnv = { DB: db, KV: kv };

    await startSideEffectCapture(env, TEST_USER_ID, TEST_TIMEZONE);

    // Invalid input
    let result = await processSideEffectResponse(env, TEST_USER_ID, 'abc');
    expect(result.messages[0]).toContain('0–5');

    // Valid input after retry
    result = await processSideEffectResponse(env, TEST_USER_ID, '3');
    expect(result.messages[0]).toContain('Diarrhea');

    // Out of range
    result = await processSideEffectResponse(env, TEST_USER_ID, '8');
    expect(result.messages[0]).toContain('0–5');

    // Valid skip
    result = await processSideEffectResponse(env, TEST_USER_ID, 'skip');
    expect(result.messages[0]).toContain('Vomiting');
  });

  it('links to null when no injection found within 72h', async () => {
    const { db, statements } = createD1Mock({ nearestInjection: null });
    const { kv } = createKVMock();
    const env: SideEffectCaptureEnv = { DB: db, KV: kv };

    await startSideEffectCapture(env, TEST_USER_ID, TEST_TIMEZONE);

    // Answer all with value 1
    for (let i = 0; i < 6; i++) {
      await processSideEffectResponse(env, TEST_USER_ID, '1');
    }
    const final = await processSideEffectResponse(env, TEST_USER_ID, '1');
    expect(final.completed).toBe(true);
    expect(final.savedCount).toBe(7);

    // All inserts should have null linked_medication_event_id
    const inserts = statements.filter((s) =>
      s.sql.includes('INSERT INTO side_effect_observation'),
    );
    for (const insert of inserts) {
      expect(insert.params[2]).toBeNull();
    }
  });
});
