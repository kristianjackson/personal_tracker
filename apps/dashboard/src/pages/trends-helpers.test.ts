import { describe, it, expect } from 'vitest';
import {
  dateRange,
  computeRollingAverage,
  extractVariableValues,
  buildTrendData,
  TREND_METRICS,
} from './trends-helpers.js';
import type { CheckinRecord } from './overview-helpers.js';

/* ── Test fixtures ───────────────────────────────────────── */

function makeObservation(code: string, value: number | null, skipped = 0) {
  return {
    id: `obs-${code}`,
    variable_code: code,
    value_numeric: value,
    value_text: null,
    scale_min: 0,
    scale_max: 5,
    skipped,
    entered_at: '2025-01-15T10:00:00Z',
  };
}

function makeCheckin(
  date: string,
  observations: ReturnType<typeof makeObservation>[] = [],
): CheckinRecord {
  return {
    id: `ci-${date}`,
    user_id: 'user-1',
    checkin_date: date,
    status: 'complete',
    source: 'whatsapp',
    is_retroactive: 0,
    created_at: `${date}T10:00:00Z`,
    updated_at: `${date}T10:00:00Z`,
    observations,
  };
}

/* ── dateRange ───────────────────────────────────────────── */

describe('dateRange', () => {
  it('returns inclusive range of dates', () => {
    expect(dateRange('2025-01-01', '2025-01-03')).toEqual([
      '2025-01-01',
      '2025-01-02',
      '2025-01-03',
    ]);
  });

  it('returns single date when start equals end', () => {
    expect(dateRange('2025-06-15', '2025-06-15')).toEqual(['2025-06-15']);
  });

  it('returns empty array when start is after end', () => {
    expect(dateRange('2025-01-05', '2025-01-01')).toEqual([]);
  });
});

/* ── computeRollingAverage ───────────────────────────────── */

describe('computeRollingAverage', () => {
  it('returns null when fewer than minPoints in window', () => {
    const dates = ['2025-01-01', '2025-01-02', '2025-01-03'];
    const values = new Map<string, number | null>([
      ['2025-01-01', 3],
      ['2025-01-02', null],
      ['2025-01-03', null],
    ]);

    const result = computeRollingAverage(dates, values, 7, 2);
    // Only 1 data point in window for each date after day 1
    expect(result.get('2025-01-01')).toBeNull(); // only 1 point
    expect(result.get('2025-01-02')).toBeNull(); // only 1 point
    expect(result.get('2025-01-03')).toBeNull(); // only 1 point
  });

  it('computes average when enough data points exist', () => {
    const dates = ['2025-01-01', '2025-01-02', '2025-01-03'];
    const values = new Map<string, number | null>([
      ['2025-01-01', 4],
      ['2025-01-02', 6],
      ['2025-01-03', null],
    ]);

    const result = computeRollingAverage(dates, values, 7, 2);
    expect(result.get('2025-01-01')).toBeNull(); // only 1 point
    expect(result.get('2025-01-02')).toBe(5); // avg of 4 and 6
    expect(result.get('2025-01-03')).toBe(5); // avg of 4 and 6 (null excluded)
  });

  it('uses only the last windowSize days', () => {
    // 8 days, window of 3
    const dates = dateRange('2025-01-01', '2025-01-08');
    const values = new Map<string, number | null>([
      ['2025-01-01', 1],
      ['2025-01-02', 2],
      ['2025-01-03', 3],
      ['2025-01-04', 4],
      ['2025-01-05', 5],
      ['2025-01-06', null],
      ['2025-01-07', 3],
      ['2025-01-08', 3],
    ]);

    const result = computeRollingAverage(dates, values, 3, 2);
    // Day 3: window [1,2,3] → avg 2
    expect(result.get('2025-01-03')).toBe(2);
    // Day 4: window [2,3,4] → avg 3
    expect(result.get('2025-01-04')).toBe(3);
    // Day 6: window [4,5,null] → avg 4.5
    expect(result.get('2025-01-06')).toBe(4.5);
    // Day 8: window [null,3,3] → avg 3
    expect(result.get('2025-01-08')).toBe(3);
  });

  it('rounds to 2 decimal places', () => {
    const dates = ['2025-01-01', '2025-01-02', '2025-01-03'];
    const values = new Map<string, number | null>([
      ['2025-01-01', 1],
      ['2025-01-02', 2],
      ['2025-01-03', 3],
    ]);

    const result = computeRollingAverage(dates, values, 7, 2);
    // Day 2: avg of 1 and 2 = 1.5
    expect(result.get('2025-01-02')).toBe(1.5);
    // Day 3: avg of 1, 2, 3 = 2
    expect(result.get('2025-01-03')).toBe(2);
  });

  it('handles all-null values', () => {
    const dates = ['2025-01-01', '2025-01-02', '2025-01-03'];
    const values = new Map<string, number | null>([
      ['2025-01-01', null],
      ['2025-01-02', null],
      ['2025-01-03', null],
    ]);

    const result = computeRollingAverage(dates, values, 7, 2);
    expect(result.get('2025-01-01')).toBeNull();
    expect(result.get('2025-01-02')).toBeNull();
    expect(result.get('2025-01-03')).toBeNull();
  });

  it('handles empty dates array', () => {
    const result = computeRollingAverage([], new Map(), 7, 2);
    expect(result.size).toBe(0);
  });
});

/* ── extractVariableValues ───────────────────────────────── */

describe('extractVariableValues', () => {
  it('extracts numeric values for a given variable code', () => {
    const checkins = [
      makeCheckin('2025-01-01', [makeObservation('DAT-001', 7)]),
      makeCheckin('2025-01-02', [makeObservation('DAT-001', 6.5)]),
    ];

    const result = extractVariableValues(checkins, 'DAT-001');
    expect(result.get('2025-01-01')).toBe(7);
    expect(result.get('2025-01-02')).toBe(6.5);
  });

  it('returns null for skipped observations', () => {
    const checkins = [
      makeCheckin('2025-01-01', [makeObservation('DAT-003', null, 1)]),
    ];

    const result = extractVariableValues(checkins, 'DAT-003');
    expect(result.get('2025-01-01')).toBeNull();
  });

  it('returns null when observation is missing from checkin', () => {
    const checkins = [
      makeCheckin('2025-01-01', [makeObservation('DAT-001', 7)]),
    ];

    const result = extractVariableValues(checkins, 'DAT-003');
    expect(result.get('2025-01-01')).toBeNull();
  });

  it('handles empty checkins array', () => {
    const result = extractVariableValues([], 'DAT-001');
    expect(result.size).toBe(0);
  });
});

/* ── buildTrendData ──────────────────────────────────────── */

describe('buildTrendData', () => {
  it('builds complete trend data with values and rolling averages', () => {
    const checkins = [
      makeCheckin('2025-01-01', [makeObservation('DAT-003', 3)]),
      makeCheckin('2025-01-02', [makeObservation('DAT-003', 4)]),
      makeCheckin('2025-01-03', [makeObservation('DAT-003', 2)]),
    ];

    const result = buildTrendData(checkins, 'DAT-003', '2025-01-01', '2025-01-03');
    expect(result).toHaveLength(3);

    // Day 1: value 3, rolling avg null (only 1 point)
    expect(result[0]).toEqual({
      date: '2025-01-01',
      value: 3,
      rollingAvg: null,
    });

    // Day 2: value 4, rolling avg 3.5
    expect(result[1]).toEqual({
      date: '2025-01-02',
      value: 4,
      rollingAvg: 3.5,
    });

    // Day 3: value 2, rolling avg 3
    expect(result[2]).toEqual({
      date: '2025-01-03',
      value: 2,
      rollingAvg: 3,
    });
  });

  it('fills gaps with null values for dates without checkins', () => {
    const checkins = [
      makeCheckin('2025-01-01', [makeObservation('DAT-003', 3)]),
      // No checkin on Jan 2
      makeCheckin('2025-01-03', [makeObservation('DAT-003', 4)]),
    ];

    const result = buildTrendData(checkins, 'DAT-003', '2025-01-01', '2025-01-03');
    expect(result).toHaveLength(3);
    expect(result[0].value).toBe(3);
    expect(result[1].value).toBeNull(); // gap
    expect(result[2].value).toBe(4);
  });

  it('returns all nulls when no checkins exist', () => {
    const result = buildTrendData([], 'DAT-003', '2025-01-01', '2025-01-03');
    expect(result).toHaveLength(3);
    for (const point of result) {
      expect(point.value).toBeNull();
      expect(point.rollingAvg).toBeNull();
    }
  });
});

/* ── TREND_METRICS ───────────────────────────────────────── */

describe('TREND_METRICS', () => {
  it('defines 6 metrics', () => {
    expect(TREND_METRICS).toHaveLength(6);
  });

  it('includes sleep, mood, energy, focus, impulsivity, irritability', () => {
    const codes = TREND_METRICS.map((m) => m.variableCode);
    expect(codes).toContain('DAT-001'); // sleep
    expect(codes).toContain('DAT-003'); // mood
    expect(codes).toContain('DAT-004'); // energy
    expect(codes).toContain('DAT-007'); // focus
    expect(codes).toContain('DAT-009'); // impulsivity
    expect(codes).toContain('DAT-005'); // irritability
  });

  it('uses 0-12 domain for sleep and 0-5 for ordinal metrics', () => {
    const sleep = TREND_METRICS.find((m) => m.variableCode === 'DAT-001')!;
    expect(sleep.yDomain).toEqual([0, 12]);

    const mood = TREND_METRICS.find((m) => m.variableCode === 'DAT-003')!;
    expect(mood.yDomain).toEqual([0, 5]);
  });
});
