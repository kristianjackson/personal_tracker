/**
 * Tests for the medication event logging service.
 *
 * Validates: FR-MED-001 (Medication dose events can be logged and summarized per medication)
 * Validates: FR-MED-005 (Missed dose appears in adherence trend)
 * Design: Section 5.7 (medication_event table), Section 6.2 (commands)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  findMedicationByName,
  listActiveMedications,
  persistMedicationEvent,
  handleMissedMedGeneric,
  handleMissedMedSpecific,
  handleTookMed,
} from './medication-event';
import type { MedicationEventEnv } from './medication-event';

// ── D1 mock ─────────────────────────────────────────────────────────

interface MockStatement {
  sql: string;
  params: unknown[];
}

function createD1Mock(options?: {
  firstResult?: unknown;
  allResults?: unknown[];
}) {
  const statements: MockStatement[] = [];

  const preparedStatement = (sql: string) => {
    let boundParams: unknown[] = [];
    const stmt: D1PreparedStatement = {
      bind: (...params: unknown[]) => {
        boundParams = params;
        statements.push({ sql, params });
        return stmt;
      },
      first: vi.fn(async () => options?.firstResult ?? null),
      all: vi.fn(async () => ({
        results: options?.allResults ?? [],
        success: true,
        meta: {},
      })),
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

/**
 * Create a D1 mock that returns different results for different queries.
 * Uses a query-matching approach to simulate realistic DB behavior.
 */
function createSmartD1Mock(queryHandlers: {
  findByCode?: unknown;
  findByName?: unknown;
  listActive?: unknown[];
}) {
  const statements: MockStatement[] = [];

  const db: D1Database = {
    prepare: vi.fn((sql: string) => {
      let boundParams: unknown[] = [];

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
          boundParams = params;
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

// ── Helpers ─────────────────────────────────────────────────────────

const TEST_USER_ID = 'user-med-test-123';
const TEST_TIMEZONE = 'America/New_York';

const SEROQUEL_ROW = {
  id: 'med-seroquel-001',
  code: 'seroquel',
  display_name: 'Seroquel (quetiapine)',
  route: 'oral',
  default_dose_value: null,
  default_dose_unit: 'mg',
};

const LITHIUM_ROW = {
  id: 'med-lithium-001',
  code: 'lithium',
  display_name: 'Lithium',
  route: 'oral',
  default_dose_value: null,
  default_dose_unit: 'mg',
};

const MOUNJARO_ROW = {
  id: 'med-mounjaro-001',
  code: 'mounjaro',
  display_name: 'Mounjaro (tirzepatide)',
  route: 'injection',
  default_dose_value: 2.5,
  default_dose_unit: 'mg',
};

const ALL_MEDS = [LITHIUM_ROW, MOUNJARO_ROW, SEROQUEL_ROW];

// ── findMedicationByName ────────────────────────────────────────────

describe('findMedicationByName', () => {
  it('finds medication by exact code match', async () => {
    const { db } = createSmartD1Mock({ findByCode: SEROQUEL_ROW });
    const result = await findMedicationByName(db, 'seroquel');
    expect(result).toEqual(SEROQUEL_ROW);
  });

  it('finds medication by code case-insensitively', async () => {
    const { db } = createSmartD1Mock({ findByCode: SEROQUEL_ROW });
    const result = await findMedicationByName(db, 'Seroquel');
    expect(result).toEqual(SEROQUEL_ROW);
  });

  it('falls back to display_name match when code not found', async () => {
    const { db } = createSmartD1Mock({
      findByCode: null,
      findByName: LITHIUM_ROW,
    });
    const result = await findMedicationByName(db, 'Lithium');
    expect(result).toEqual(LITHIUM_ROW);
  });

  it('returns null when no match found', async () => {
    const { db } = createSmartD1Mock({
      findByCode: null,
      findByName: null,
    });
    const result = await findMedicationByName(db, 'nonexistent');
    expect(result).toBeNull();
  });
});

// ── listActiveMedications ───────────────────────────────────────────

describe('listActiveMedications', () => {
  it('returns all active medications', async () => {
    const { db } = createSmartD1Mock({ listActive: ALL_MEDS });
    const result = await listActiveMedications(db);
    expect(result).toEqual(ALL_MEDS);
  });

  it('returns empty array when no active medications', async () => {
    const { db } = createSmartD1Mock({ listActive: [] });
    const result = await listActiveMedications(db);
    expect(result).toEqual([]);
  });
});

// ── persistMedicationEvent ──────────────────────────────────────────

describe('persistMedicationEvent', () => {
  it('inserts a medication event with correct fields', async () => {
    const { db, statements } = createD1Mock();

    const eventId = await persistMedicationEvent(
      db,
      TEST_USER_ID,
      'med-seroquel-001',
      'missed',
      null,
      'mg',
      '2025-01-15',
    );

    expect(typeof eventId).toBe('string');
    expect(eventId.length).toBeGreaterThan(0);

    const insert = statements.find((s) => s.sql.includes('INSERT INTO medication_event'));
    expect(insert).toBeDefined();
    expect(insert!.params[0]).toBe(eventId); // id
    expect(insert!.params[1]).toBe(TEST_USER_ID); // user_id
    expect(insert!.params[2]).toBe('med-seroquel-001'); // medication_definition_id
    expect(insert!.params[3]).toBe('missed'); // event_type
    expect(insert!.params[4]).toBeNull(); // dose_value
    expect(insert!.params[5]).toBe('mg'); // dose_unit
    expect(insert!.params[7]).toBe('2025-01-15'); // event_date
  });

  it('inserts a taken event with dose values', async () => {
    const { db, statements } = createD1Mock();

    await persistMedicationEvent(
      db,
      TEST_USER_ID,
      'med-mounjaro-001',
      'taken',
      2.5,
      'mg',
      '2025-01-15',
    );

    const insert = statements.find((s) => s.sql.includes('INSERT INTO medication_event'));
    expect(insert).toBeDefined();
    expect(insert!.params[3]).toBe('taken'); // event_type
    expect(insert!.params[4]).toBe(2.5); // dose_value
    expect(insert!.params[5]).toBe('mg'); // dose_unit
  });

  it('sets injection_site to NULL via SQL', async () => {
    const { db, statements } = createD1Mock();

    await persistMedicationEvent(
      db,
      TEST_USER_ID,
      'med-seroquel-001',
      'missed',
      null,
      null,
      '2025-01-15',
    );

    const insert = statements.find((s) => s.sql.includes('INSERT INTO medication_event'));
    expect(insert!.sql).toContain('NULL');
  });
});

// ── handleMissedMedGeneric ──────────────────────────────────────────

describe('handleMissedMedGeneric', () => {
  it('lists active medications and asks user to specify', async () => {
    const { db } = createSmartD1Mock({ listActive: ALL_MEDS });
    const env: MedicationEventEnv = { DB: db };

    const result = await handleMissedMedGeneric(env, TEST_USER_ID);

    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('Which medication did you miss?');
    expect(result.messages[0]).toContain('Seroquel');
    expect(result.messages[0]).toContain('Lithium');
    expect(result.messages[0]).toContain('Mounjaro');
  });

  it('returns message when no active medications exist', async () => {
    const { db } = createSmartD1Mock({ listActive: [] });
    const env: MedicationEventEnv = { DB: db };

    const result = await handleMissedMedGeneric(env, TEST_USER_ID);

    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('No active medications');
  });
});

// ── handleMissedMedSpecific ─────────────────────────────────────────

describe('handleMissedMedSpecific', () => {
  it('creates a missed event for a known medication', async () => {
    const { db, statements } = createSmartD1Mock({
      findByCode: SEROQUEL_ROW,
    });
    const env: MedicationEventEnv = { DB: db };

    const result = await handleMissedMedSpecific(
      env,
      TEST_USER_ID,
      'seroquel',
      TEST_TIMEZONE,
    );

    expect(result.saved).toBe(true);
    expect(result.messages[0]).toContain('Missed dose logged');
    expect(result.messages[0]).toContain('Seroquel');

    const insert = statements.find((s) => s.sql.includes('INSERT INTO medication_event'));
    expect(insert).toBeDefined();
    expect(insert!.params[3]).toBe('missed');
  });

  it('returns error and lists meds when medication not found', async () => {
    const { db } = createSmartD1Mock({
      findByCode: null,
      findByName: null,
      listActive: ALL_MEDS,
    });
    const env: MedicationEventEnv = { DB: db };

    const result = await handleMissedMedSpecific(
      env,
      TEST_USER_ID,
      'tylenol',
      TEST_TIMEZONE,
    );

    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('not found');
    expect(result.messages[0]).toContain('tylenol');
    expect(result.messages[0]).toContain('Lithium');
  });

  it('uses default dose values from the medication definition', async () => {
    const { db, statements } = createSmartD1Mock({
      findByCode: MOUNJARO_ROW,
    });
    const env: MedicationEventEnv = { DB: db };

    await handleMissedMedSpecific(env, TEST_USER_ID, 'mounjaro', TEST_TIMEZONE);

    const insert = statements.find((s) => s.sql.includes('INSERT INTO medication_event'));
    expect(insert).toBeDefined();
    expect(insert!.params[4]).toBe(2.5); // default_dose_value
    expect(insert!.params[5]).toBe('mg'); // default_dose_unit
  });
});

// ── handleTookMed ───────────────────────────────────────────────────

describe('handleTookMed', () => {
  it('creates a taken event for a known medication', async () => {
    const { db, statements } = createSmartD1Mock({
      findByCode: SEROQUEL_ROW,
    });
    const env: MedicationEventEnv = { DB: db };

    const result = await handleTookMed(
      env,
      TEST_USER_ID,
      'seroquel',
      TEST_TIMEZONE,
    );

    expect(result.saved).toBe(true);
    expect(result.messages[0]).toContain('Seroquel');
    expect(result.messages[0]).toContain('taken');
    expect(result.messages[0]).toContain('✓');

    const insert = statements.find((s) => s.sql.includes('INSERT INTO medication_event'));
    expect(insert).toBeDefined();
    expect(insert!.params[3]).toBe('taken');
  });

  it('returns error and lists meds when medication not found', async () => {
    const { db } = createSmartD1Mock({
      findByCode: null,
      findByName: null,
      listActive: ALL_MEDS,
    });
    const env: MedicationEventEnv = { DB: db };

    const result = await handleTookMed(
      env,
      TEST_USER_ID,
      'aspirin',
      TEST_TIMEZONE,
    );

    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('not found');
    expect(result.messages[0]).toContain('aspirin');
  });

  it('uses default dose values from the medication definition', async () => {
    const { db, statements } = createSmartD1Mock({
      findByCode: MOUNJARO_ROW,
    });
    const env: MedicationEventEnv = { DB: db };

    await handleTookMed(env, TEST_USER_ID, 'mounjaro', TEST_TIMEZONE);

    const insert = statements.find((s) => s.sql.includes('INSERT INTO medication_event'));
    expect(insert).toBeDefined();
    expect(insert!.params[4]).toBe(2.5); // default_dose_value
    expect(insert!.params[5]).toBe('mg'); // default_dose_unit
  });
});
