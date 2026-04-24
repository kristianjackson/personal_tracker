/**
 * Tests for the Mounjaro injection flow service.
 *
 * Validates: FR-MED-002 (Mounjaro injections modeled with dose, site, time)
 * Validates: DAT-021 (Injection date/time)
 * Validates: DAT-022 (Injection dose enum)
 * Validates: DAT-023 (Injection site enum)
 * Design: Section 6.4 (Injection flow)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseDoseInput,
  parseTimeInput,
  parseSiteInput,
  parseWatchInput,
  formatLocalTime,
  startInjectionFlow,
  processInjectionResponse,
  getInjectionSession,
  persistInjectionEvent,
  STEP_PROMPTS,
} from './injection-flow';
import type { InjectionFlowEnv, InjectionSession } from './injection-flow';

// ── D1 mock ─────────────────────────────────────────────────────────

interface MockStatement {
  sql: string;
  params: unknown[];
}

function createSmartD1Mock(queryHandlers: {
  findByCode?: unknown;
  findByName?: unknown;
  listActive?: unknown[];
}) {
  const statements: MockStatement[] = [];

  const db: D1Database = {
    prepare: vi.fn((sql: string) => {
      const firstFn = vi.fn(async () => {
        if (sql.includes('LOWER(code)') && queryHandlers.findByCode !== undefined) {
          return queryHandlers.findByCode;
        }
        if (sql.includes('LOWER(display_name)') && queryHandlers.findByName !== undefined) {
          return queryHandlers.findByName;
        }
        return null;
      });

      const allFn = vi.fn(async () => ({
        results: queryHandlers.listActive ?? [],
        success: true,
        meta: {},
      }));

      const stmt: D1PreparedStatement = {
        bind: (...params: unknown[]) => {
          statements.push({ sql, params });
          return stmt;
        },
        first: firstFn,
        all: allFn,
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

const TEST_USER_ID = 'user-inject-test-123';
const TEST_TIMEZONE = 'America/New_York';

const MOUNJARO_ROW = {
  id: 'med-mounjaro-001',
  code: 'mounjaro',
  display_name: 'Mounjaro (tirzepatide)',
  route: 'injection',
  default_dose_value: 2.5,
  default_dose_unit: 'mg',
};

// ── parseDoseInput ──────────────────────────────────────────────────

describe('parseDoseInput', () => {
  it('parses valid dose values', () => {
    expect(parseDoseInput('2.5')).toBe(2.5);
    expect(parseDoseInput('5')).toBe(5);
    expect(parseDoseInput('7.5')).toBe(7.5);
    expect(parseDoseInput('10')).toBe(10);
    expect(parseDoseInput('12.5')).toBe(12.5);
    expect(parseDoseInput('15')).toBe(15);
  });

  it('handles "mg" suffix', () => {
    expect(parseDoseInput('2.5mg')).toBe(2.5);
    expect(parseDoseInput('10 mg')).toBe(10);
    expect(parseDoseInput('15mg')).toBe(15);
  });

  it('handles whitespace', () => {
    expect(parseDoseInput('  5  ')).toBe(5);
    expect(parseDoseInput(' 12.5 mg ')).toBe(12.5);
  });

  it('rejects invalid dose values', () => {
    expect(parseDoseInput('3')).toBeNull();
    expect(parseDoseInput('20')).toBeNull();
    expect(parseDoseInput('0')).toBeNull();
    expect(parseDoseInput('abc')).toBeNull();
    expect(parseDoseInput('')).toBeNull();
    expect(parseDoseInput('1.5')).toBeNull();
  });
});

// ── parseTimeInput ──────────────────────────────────────────────────

describe('parseTimeInput', () => {
  it('parses "now" to a valid ISO timestamp', () => {
    const result = parseTimeInput('now', TEST_TIMEZONE);
    expect(result).not.toBeNull();
    expect(new Date(result!).toISOString()).toBe(result);
  });

  it('parses 12-hour format times', () => {
    const result = parseTimeInput('8:30am', TEST_TIMEZONE);
    expect(result).not.toBeNull();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('parses 12-hour format with space', () => {
    const result = parseTimeInput('8:30 am', TEST_TIMEZONE);
    expect(result).not.toBeNull();
  });

  it('parses PM times', () => {
    const result = parseTimeInput('2:30pm', TEST_TIMEZONE);
    expect(result).not.toBeNull();
  });

  it('parses 24-hour format', () => {
    const result = parseTimeInput('14:30', TEST_TIMEZONE);
    expect(result).not.toBeNull();
  });

  it('parses midnight correctly', () => {
    const result = parseTimeInput('12:00am', TEST_TIMEZONE);
    expect(result).not.toBeNull();
  });

  it('parses noon correctly', () => {
    const result = parseTimeInput('12:00pm', TEST_TIMEZONE);
    expect(result).not.toBeNull();
  });

  it('rejects invalid times', () => {
    expect(parseTimeInput('25:00', TEST_TIMEZONE)).toBeNull();
    expect(parseTimeInput('abc', TEST_TIMEZONE)).toBeNull();
    expect(parseTimeInput('', TEST_TIMEZONE)).toBeNull();
    expect(parseTimeInput('13:00am', TEST_TIMEZONE)).toBeNull();
    expect(parseTimeInput('8:60am', TEST_TIMEZONE)).toBeNull();
  });
});

// ── parseSiteInput ──────────────────────────────────────────────────

describe('parseSiteInput', () => {
  it('parses valid injection sites', () => {
    expect(parseSiteInput('abdomen')).toBe('abdomen');
    expect(parseSiteInput('thigh-l')).toBe('thigh-L');
    expect(parseSiteInput('thigh-r')).toBe('thigh-R');
    expect(parseSiteInput('arm-l')).toBe('arm-L');
    expect(parseSiteInput('arm-r')).toBe('arm-R');
  });

  it('handles case-insensitive input', () => {
    expect(parseSiteInput('Abdomen')).toBe('abdomen');
    expect(parseSiteInput('THIGH-L')).toBe('thigh-L');
    expect(parseSiteInput('ARM-R')).toBe('arm-R');
  });

  it('maps upper-arm aliases to arm sites', () => {
    expect(parseSiteInput('upper-arm-l')).toBe('arm-L');
    expect(parseSiteInput('upper-arm-r')).toBe('arm-R');
  });

  it('maps natural language aliases', () => {
    expect(parseSiteInput('left thigh')).toBe('thigh-L');
    expect(parseSiteInput('right thigh')).toBe('thigh-R');
    expect(parseSiteInput('left arm')).toBe('arm-L');
    expect(parseSiteInput('right arm')).toBe('arm-R');
  });

  it('handles whitespace', () => {
    expect(parseSiteInput('  abdomen  ')).toBe('abdomen');
  });

  it('rejects invalid sites', () => {
    expect(parseSiteInput('back')).toBeNull();
    expect(parseSiteInput('leg')).toBeNull();
    expect(parseSiteInput('')).toBeNull();
    expect(parseSiteInput('abc')).toBeNull();
  });
});

// ── parseWatchInput ─────────────────────────────────────────────────

describe('parseWatchInput', () => {
  it('parses affirmative responses', () => {
    expect(parseWatchInput('yes')).toBe(true);
    expect(parseWatchInput('y')).toBe(true);
    expect(parseWatchInput('Yes')).toBe(true);
    expect(parseWatchInput('Y')).toBe(true);
  });

  it('parses negative responses', () => {
    expect(parseWatchInput('no')).toBe(false);
    expect(parseWatchInput('n')).toBe(false);
    expect(parseWatchInput('No')).toBe(false);
    expect(parseWatchInput('N')).toBe(false);
  });

  it('handles whitespace', () => {
    expect(parseWatchInput('  yes  ')).toBe(true);
    expect(parseWatchInput('  no  ')).toBe(false);
  });

  it('rejects invalid input', () => {
    expect(parseWatchInput('maybe')).toBeNull();
    expect(parseWatchInput('')).toBeNull();
    expect(parseWatchInput('ok')).toBeNull();
  });
});

// ── formatLocalTime ─────────────────────────────────────────────────

describe('formatLocalTime', () => {
  it('formats a UTC timestamp to local time', () => {
    const result = formatLocalTime('2025-01-15T13:30:00.000Z', 'America/New_York');
    expect(result).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/);
  });

  it('formats UTC timezone correctly', () => {
    const result = formatLocalTime('2025-01-15T08:30:00.000Z', 'UTC');
    expect(result).toMatch(/8:30\s*AM/);
  });
});

// ── startInjectionFlow ──────────────────────────────────────────────

describe('startInjectionFlow', () => {
  it('creates a new session and returns dose prompt', async () => {
    const { db } = createSmartD1Mock({ findByCode: MOUNJARO_ROW });
    const { kv } = createKVMock();
    const env: InjectionFlowEnv = { DB: db, KV: kv };

    const result = await startInjectionFlow(env, TEST_USER_ID);

    expect(result.completed).toBe(false);
    expect(result.saved).toBe(false);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain('dose');

    // Verify session was created in KV
    const session = await getInjectionSession(kv, TEST_USER_ID);
    expect(session).not.toBeNull();
    expect(session!.currentStep).toBe('dose');
    expect(session!.userId).toBe(TEST_USER_ID);
  });

  it('resumes an existing session', async () => {
    const existingSession: InjectionSession = {
      sessionId: 'existing-session-id',
      userId: TEST_USER_ID,
      currentStep: 'site',
      doseValue: 5,
      eventTime: '2025-01-15T13:00:00.000Z',
      injectionSite: null,
      watchOptIn: null,
      startedAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-15T12:05:00.000Z',
    };

    const { db } = createSmartD1Mock({ findByCode: MOUNJARO_ROW });
    const { kv } = createKVMock({
      [`injection-session:${TEST_USER_ID}`]: JSON.stringify(existingSession),
    });
    const env: InjectionFlowEnv = { DB: db, KV: kv };

    const result = await startInjectionFlow(env, TEST_USER_ID);

    expect(result.completed).toBe(false);
    expect(result.messages[0]).toContain('Resuming');
    expect(result.messages[1]).toContain('site');
  });

  it('returns error when Mounjaro is not configured', async () => {
    const { db } = createSmartD1Mock({ findByCode: null, findByName: null });
    const { kv } = createKVMock();
    const env: InjectionFlowEnv = { DB: db, KV: kv };

    const result = await startInjectionFlow(env, TEST_USER_ID);

    expect(result.completed).toBe(true);
    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('not configured');
  });
});

// ── processInjectionResponse ────────────────────────────────────────

describe('processInjectionResponse', () => {
  it('returns error when no active session', async () => {
    const { db } = createSmartD1Mock({ findByCode: MOUNJARO_ROW });
    const { kv } = createKVMock();
    const env: InjectionFlowEnv = { DB: db, KV: kv };

    const result = await processInjectionResponse(env, TEST_USER_ID, '5', TEST_TIMEZONE);

    expect(result.completed).toBe(false);
    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('No active injection session');
  });

  describe('dose step', () => {
    let env: InjectionFlowEnv;
    let kv: KVNamespace;

    beforeEach(async () => {
      const { db } = createSmartD1Mock({ findByCode: MOUNJARO_ROW });
      const kvMock = createKVMock();
      kv = kvMock.kv;
      env = { DB: db, KV: kv };

      // Start a session
      await startInjectionFlow(env, TEST_USER_ID);
    });

    it('accepts a valid dose and advances to time step', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, '5', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('When');

      const session = await getInjectionSession(kv, TEST_USER_ID);
      expect(session!.currentStep).toBe('time');
      expect(session!.doseValue).toBe(5);
    });

    it('accepts dose with mg suffix', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, '10mg', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      const session = await getInjectionSession(kv, TEST_USER_ID);
      expect(session!.doseValue).toBe(10);
    });

    it('rejects invalid dose', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, '3', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('valid dose');

      const session = await getInjectionSession(kv, TEST_USER_ID);
      expect(session!.currentStep).toBe('dose');
    });
  });

  describe('time step', () => {
    let env: InjectionFlowEnv;
    let kv: KVNamespace;

    beforeEach(async () => {
      const { db } = createSmartD1Mock({ findByCode: MOUNJARO_ROW });
      const kvMock = createKVMock();
      kv = kvMock.kv;
      env = { DB: db, KV: kv };

      await startInjectionFlow(env, TEST_USER_ID);
      await processInjectionResponse(env, TEST_USER_ID, '5', TEST_TIMEZONE);
    });

    it('accepts "now" and advances to site step', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, 'now', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('site');

      const session = await getInjectionSession(kv, TEST_USER_ID);
      expect(session!.currentStep).toBe('site');
      expect(session!.eventTime).not.toBeNull();
    });

    it('accepts a specific time', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, '8:30am', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      const session = await getInjectionSession(kv, TEST_USER_ID);
      expect(session!.currentStep).toBe('site');
      expect(session!.eventTime).not.toBeNull();
    });

    it('rejects invalid time', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, 'yesterday', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('now');

      const session = await getInjectionSession(kv, TEST_USER_ID);
      expect(session!.currentStep).toBe('time');
    });
  });

  describe('site step', () => {
    let env: InjectionFlowEnv;
    let kv: KVNamespace;

    beforeEach(async () => {
      const { db } = createSmartD1Mock({ findByCode: MOUNJARO_ROW });
      const kvMock = createKVMock();
      kv = kvMock.kv;
      env = { DB: db, KV: kv };

      await startInjectionFlow(env, TEST_USER_ID);
      await processInjectionResponse(env, TEST_USER_ID, '5', TEST_TIMEZONE);
      await processInjectionResponse(env, TEST_USER_ID, 'now', TEST_TIMEZONE);
    });

    it('accepts a valid site and advances to watch step', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, 'abdomen', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('72h');

      const session = await getInjectionSession(kv, TEST_USER_ID);
      expect(session!.currentStep).toBe('watch');
      expect(session!.injectionSite).toBe('abdomen');
    });

    it('accepts thigh-L site', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, 'thigh-l', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      const session = await getInjectionSession(kv, TEST_USER_ID);
      expect(session!.injectionSite).toBe('thigh-L');
    });

    it('rejects invalid site', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, 'back', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('valid site');

      const session = await getInjectionSession(kv, TEST_USER_ID);
      expect(session!.currentStep).toBe('site');
    });
  });

  describe('watch step and completion', () => {
    let env: InjectionFlowEnv;
    let kv: KVNamespace;
    let db: D1Database;
    let statements: MockStatement[];

    beforeEach(async () => {
      const mock = createSmartD1Mock({ findByCode: MOUNJARO_ROW });
      db = mock.db;
      statements = mock.statements;
      const kvMock = createKVMock();
      kv = kvMock.kv;
      env = { DB: db, KV: kv };

      await startInjectionFlow(env, TEST_USER_ID);
      await processInjectionResponse(env, TEST_USER_ID, '5', TEST_TIMEZONE);
      await processInjectionResponse(env, TEST_USER_ID, 'now', TEST_TIMEZONE);
      await processInjectionResponse(env, TEST_USER_ID, 'abdomen', TEST_TIMEZONE);
    });

    it('completes flow with watch opt-in and persists event', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, 'yes', TEST_TIMEZONE);

      expect(result.completed).toBe(true);
      expect(result.saved).toBe(true);
      expect(result.messages[0]).toContain('✓');
      expect(result.messages[0]).toContain('Mounjaro');
      expect(result.messages[0]).toContain('5mg');
      expect(result.messages[0]).toContain('abdomen');
      expect(result.messages[0]).toContain('Watch active for 72h.');

      // Session should be cleaned up
      const session = await getInjectionSession(kv, TEST_USER_ID);
      expect(session).toBeNull();

      // Verify D1 insert
      const insert = statements.find((s) => s.sql.includes('INSERT INTO medication_event'));
      expect(insert).toBeDefined();
      expect(insert!.params).toContain('med-mounjaro-001'); // medication_definition_id
      expect(insert!.params).toContain(5); // dose_value
      expect(insert!.params).toContain('mg'); // dose_unit
      expect(insert!.params).toContain('abdomen'); // injection_site
    });

    it('completes flow with watch opt-out', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, 'no', TEST_TIMEZONE);

      expect(result.completed).toBe(true);
      expect(result.saved).toBe(true);
      expect(result.messages[0]).toContain('No watch.');
      expect(result.messages[0]).not.toContain('Watch active');
    });

    it('rejects invalid watch input', async () => {
      const result = await processInjectionResponse(env, TEST_USER_ID, 'maybe', TEST_TIMEZONE);

      expect(result.completed).toBe(false);
      expect(result.messages[0]).toContain('yes');
      expect(result.messages[0]).toContain('no');
    });
  });
});

// ── persistInjectionEvent ───────────────────────────────────────────

describe('persistInjectionEvent', () => {
  it('inserts a medication event with injection fields', async () => {
    const { db } = createSmartD1Mock({});
    const statements: MockStatement[] = [];

    // Override prepare to capture statements
    (db.prepare as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
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
    });

    const eventId = await persistInjectionEvent(
      db,
      TEST_USER_ID,
      'med-mounjaro-001',
      5,
      'mg',
      'abdomen',
      '2025-01-15T13:30:00.000Z',
      '2025-01-15',
    );

    expect(typeof eventId).toBe('string');
    expect(eventId.length).toBeGreaterThan(0);

    const insert = statements.find((s) => s.sql.includes('INSERT INTO medication_event'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("'injected'");
    expect(insert!.params[0]).toBe(eventId); // id
    expect(insert!.params[1]).toBe(TEST_USER_ID); // user_id
    expect(insert!.params[2]).toBe('med-mounjaro-001'); // medication_definition_id
    expect(insert!.params[3]).toBe(5); // dose_value
    expect(insert!.params[4]).toBe('mg'); // dose_unit
    expect(insert!.params[5]).toBe('abdomen'); // injection_site
    expect(insert!.params[6]).toBe('2025-01-15T13:30:00.000Z'); // event_at
    expect(insert!.params[7]).toBe('2025-01-15'); // event_date
  });
});

// ── Full flow integration ───────────────────────────────────────────

describe('full injection flow', () => {
  it('completes a full injection flow with all valid inputs', async () => {
    const { db, statements } = createSmartD1Mock({ findByCode: MOUNJARO_ROW });
    const { kv } = createKVMock();
    const env: InjectionFlowEnv = { DB: db, KV: kv };

    // Step 1: Start flow
    const start = await startInjectionFlow(env, TEST_USER_ID);
    expect(start.completed).toBe(false);
    expect(start.messages[0]).toContain('dose');

    // Step 2: Enter dose
    const dose = await processInjectionResponse(env, TEST_USER_ID, '12.5', TEST_TIMEZONE);
    expect(dose.completed).toBe(false);
    expect(dose.messages[0]).toContain('When');

    // Step 3: Enter time
    const time = await processInjectionResponse(env, TEST_USER_ID, 'now', TEST_TIMEZONE);
    expect(time.completed).toBe(false);
    expect(time.messages[0]).toContain('site');

    // Step 4: Enter site
    const site = await processInjectionResponse(env, TEST_USER_ID, 'thigh-r', TEST_TIMEZONE);
    expect(site.completed).toBe(false);
    expect(site.messages[0]).toContain('72h');

    // Step 5: Opt in to watch
    const watch = await processInjectionResponse(env, TEST_USER_ID, 'yes', TEST_TIMEZONE);
    expect(watch.completed).toBe(true);
    expect(watch.saved).toBe(true);
    expect(watch.messages[0]).toContain('✓ Mounjaro 12.5mg');
    expect(watch.messages[0]).toContain('thigh-R');
    expect(watch.messages[0]).toContain('Watch active for 72h.');

    // Session should be cleaned up
    const session = await getInjectionSession(kv, TEST_USER_ID);
    expect(session).toBeNull();

    // Verify the D1 insert happened
    const insert = statements.find((s) => s.sql.includes('INSERT INTO medication_event'));
    expect(insert).toBeDefined();
  });

  it('handles invalid inputs at each step and retries', async () => {
    const { db } = createSmartD1Mock({ findByCode: MOUNJARO_ROW });
    const { kv } = createKVMock();
    const env: InjectionFlowEnv = { DB: db, KV: kv };

    await startInjectionFlow(env, TEST_USER_ID);

    // Invalid dose
    let result = await processInjectionResponse(env, TEST_USER_ID, '3', TEST_TIMEZONE);
    expect(result.messages[0]).toContain('valid dose');

    // Valid dose
    result = await processInjectionResponse(env, TEST_USER_ID, '5', TEST_TIMEZONE);
    expect(result.messages[0]).toContain('When');

    // Invalid time
    result = await processInjectionResponse(env, TEST_USER_ID, 'yesterday', TEST_TIMEZONE);
    expect(result.messages[0]).toContain('now');

    // Valid time
    result = await processInjectionResponse(env, TEST_USER_ID, '8:30am', TEST_TIMEZONE);
    expect(result.messages[0]).toContain('site');

    // Invalid site
    result = await processInjectionResponse(env, TEST_USER_ID, 'back', TEST_TIMEZONE);
    expect(result.messages[0]).toContain('valid site');

    // Valid site
    result = await processInjectionResponse(env, TEST_USER_ID, 'arm-l', TEST_TIMEZONE);
    expect(result.messages[0]).toContain('72h');

    // Invalid watch
    result = await processInjectionResponse(env, TEST_USER_ID, 'maybe', TEST_TIMEZONE);
    expect(result.messages[0]).toContain('yes');

    // Valid watch
    result = await processInjectionResponse(env, TEST_USER_ID, 'no', TEST_TIMEZONE);
    expect(result.completed).toBe(true);
    expect(result.saved).toBe(true);
    expect(result.messages[0]).toContain('No watch.');
  });
});
