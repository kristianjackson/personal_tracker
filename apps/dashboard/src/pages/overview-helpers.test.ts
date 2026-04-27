import { describe, it, expect } from 'vitest';
import {
  dateRange,
  formatShortDate,
  statusLabel,
  buildDailyCompletion,
  buildHeatmapData,
  VARIABLE_CODES,
  type CheckinRecord,
} from './overview-helpers.js';

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

function makeCheckin(date: string, observations: ReturnType<typeof makeObservation>[] = []): CheckinRecord {
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
    const result = dateRange('2025-01-01', '2025-01-03');
    expect(result).toEqual(['2025-01-01', '2025-01-02', '2025-01-03']);
  });

  it('returns single date when start equals end', () => {
    const result = dateRange('2025-06-15', '2025-06-15');
    expect(result).toEqual(['2025-06-15']);
  });

  it('returns empty array when start is after end', () => {
    const result = dateRange('2025-01-05', '2025-01-01');
    expect(result).toEqual([]);
  });

  it('handles month boundaries', () => {
    const result = dateRange('2025-01-30', '2025-02-02');
    expect(result).toEqual(['2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02']);
  });
});

/* ── formatShortDate ─────────────────────────────────────── */

describe('formatShortDate', () => {
  it('formats a date as short month + day', () => {
    const result = formatShortDate('2025-01-15');
    expect(result).toBe('Jan 15');
  });

  it('formats December date', () => {
    const result = formatShortDate('2025-12-25');
    expect(result).toBe('Dec 25');
  });
});

/* ── statusLabel ─────────────────────────────────────────── */

describe('statusLabel', () => {
  it('maps has-data to recorded', () => {
    expect(statusLabel('has-data')).toBe('recorded');
  });

  it('maps skipped to skipped', () => {
    expect(statusLabel('skipped')).toBe('skipped');
  });

  it('maps missing to missing', () => {
    expect(statusLabel('missing')).toBe('missing');
  });

  it('maps no-checkin to no check-in', () => {
    expect(statusLabel('no-checkin')).toBe('no check-in');
  });
});

/* ── buildDailyCompletion ────────────────────────────────── */

describe('buildDailyCompletion', () => {
  it('marks days without check-ins as rate 0', () => {
    const result = buildDailyCompletion([], '2025-01-01', '2025-01-03');
    expect(result).toHaveLength(3);
    for (const day of result) {
      expect(day.hasCheckin).toBe(false);
      expect(day.rate).toBe(0);
      expect(day.observationCount).toBe(0);
    }
  });

  it('computes rate based on answered variables', () => {
    const allObs = VARIABLE_CODES.map((code) => makeObservation(code, 3));
    const checkins = [makeCheckin('2025-01-02', allObs)];

    const result = buildDailyCompletion(checkins, '2025-01-01', '2025-01-03');

    // Day 1: no checkin
    expect(result[0].hasCheckin).toBe(false);
    expect(result[0].rate).toBe(0);

    // Day 2: full checkin
    expect(result[1].hasCheckin).toBe(true);
    expect(result[1].observationCount).toBe(12);
    expect(result[1].rate).toBe(1);

    // Day 3: no checkin
    expect(result[2].hasCheckin).toBe(false);
  });

  it('excludes skipped observations from count', () => {
    const obs = [
      makeObservation('DAT-001', 7),
      makeObservation('DAT-002', null, 1), // skipped
      makeObservation('DAT-003', 3),
    ];
    const checkins = [makeCheckin('2025-01-01', obs)];

    const result = buildDailyCompletion(checkins, '2025-01-01', '2025-01-01');
    expect(result[0].observationCount).toBe(2);
    expect(result[0].rate).toBeCloseTo(2 / 12);
  });

  it('handles partial check-in with some null values', () => {
    const obs = [
      makeObservation('DAT-001', 6.5),
      makeObservation('DAT-002', null, 0), // not skipped but null value
    ];
    const checkins = [makeCheckin('2025-01-01', obs)];

    const result = buildDailyCompletion(checkins, '2025-01-01', '2025-01-01');
    expect(result[0].observationCount).toBe(1); // only DAT-001 counts
  });
});

/* ── buildHeatmapData ────────────────────────────────────── */

describe('buildHeatmapData', () => {
  it('marks all cells as no-checkin when no data', () => {
    const result = buildHeatmapData([], '2025-01-01', '2025-01-02');
    expect(result.dates).toEqual(['2025-01-01', '2025-01-02']);

    for (const code of VARIABLE_CODES) {
      expect(result.grid[code]['2025-01-01']).toBe('no-checkin');
      expect(result.grid[code]['2025-01-02']).toBe('no-checkin');
    }
  });

  it('marks variables with data as has-data', () => {
    const obs = [makeObservation('DAT-001', 7), makeObservation('DAT-003', 4)];
    const checkins = [makeCheckin('2025-01-01', obs)];

    const result = buildHeatmapData(checkins, '2025-01-01', '2025-01-01');
    expect(result.grid['DAT-001']['2025-01-01']).toBe('has-data');
    expect(result.grid['DAT-003']['2025-01-01']).toBe('has-data');
  });

  it('marks skipped variables as skipped', () => {
    const obs = [makeObservation('DAT-002', null, 1)];
    const checkins = [makeCheckin('2025-01-01', obs)];

    const result = buildHeatmapData(checkins, '2025-01-01', '2025-01-01');
    expect(result.grid['DAT-002']['2025-01-01']).toBe('skipped');
  });

  it('marks variables without observations as missing when checkin exists', () => {
    const obs = [makeObservation('DAT-001', 7)];
    const checkins = [makeCheckin('2025-01-01', obs)];

    const result = buildHeatmapData(checkins, '2025-01-01', '2025-01-01');
    // DAT-001 has data, all others should be missing (not no-checkin)
    expect(result.grid['DAT-001']['2025-01-01']).toBe('has-data');
    expect(result.grid['DAT-002']['2025-01-01']).toBe('missing');
    expect(result.grid['DAT-012']['2025-01-01']).toBe('missing');
  });

  it('covers all 12 variable codes', () => {
    const result = buildHeatmapData([], '2025-01-01', '2025-01-01');
    const codes = Object.keys(result.grid);
    expect(codes).toHaveLength(12);
    expect(codes).toEqual(VARIABLE_CODES);
  });
});
