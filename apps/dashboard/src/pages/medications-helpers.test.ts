/**
 * Unit tests for medications-helpers.
 *
 * Validates: FR-DB-005
 */

import { describe, it, expect } from 'vitest';
import {
  buildMedicationTimelines,
  buildWeeklyAdherence,
  getMissedDoses,
  getWeekStart,
  formatWeekLabel,
  getMedicationColor,
  type MedicationEvent,
} from './medications-helpers.js';

/* ── Fixtures ────────────────────────────────────────────── */

function makeEvent(
  overrides: Partial<MedicationEvent> & {
    event_type: MedicationEvent['event_type'];
    event_date: string;
    display_name: string;
    medication_code: string;
  },
): MedicationEvent {
  return {
    id: overrides.id ?? 'evt-1',
    user_id: overrides.user_id ?? 'user-1',
    medication_definition_id: overrides.medication_definition_id ?? 'med-1',
    event_type: overrides.event_type,
    dose_value: overrides.dose_value ?? null,
    dose_unit: overrides.dose_unit ?? null,
    injection_site: overrides.injection_site ?? null,
    event_at: overrides.event_at ?? `${overrides.event_date}T08:00:00Z`,
    event_date: overrides.event_date,
    created_at: overrides.created_at ?? `${overrides.event_date}T08:00:00Z`,
    display_name: overrides.display_name,
    medication_code: overrides.medication_code,
    route: overrides.route ?? 'oral',
  };
}

/* ── getWeekStart ────────────────────────────────────────── */

describe('getWeekStart', () => {
  it('returns Monday for a Wednesday', () => {
    // 2025-01-08 is a Wednesday
    expect(getWeekStart('2025-01-08')).toBe('2025-01-06');
  });

  it('returns the same day for a Monday', () => {
    expect(getWeekStart('2025-01-06')).toBe('2025-01-06');
  });

  it('returns previous Monday for a Sunday', () => {
    // 2025-01-12 is a Sunday
    expect(getWeekStart('2025-01-12')).toBe('2025-01-06');
  });
});

/* ── formatWeekLabel ─────────────────────────────────────── */

describe('formatWeekLabel', () => {
  it('formats a date as short month + day', () => {
    expect(formatWeekLabel('2025-01-06')).toBe('Jan 6');
  });
});

/* ── getMedicationColor ──────────────────────────────────── */

describe('getMedicationColor', () => {
  it('returns a color for index 0', () => {
    expect(getMedicationColor(0)).toBe('#6366f1');
  });

  it('wraps around for large indices', () => {
    expect(getMedicationColor(8)).toBe(getMedicationColor(0));
  });
});

/* ── buildMedicationTimelines ────────────────────────────── */

describe('buildMedicationTimelines', () => {
  it('groups events by medication', () => {
    const events: MedicationEvent[] = [
      makeEvent({
        id: '1',
        medication_definition_id: 'med-1',
        event_type: 'taken',
        event_date: '2025-01-10',
        display_name: 'Seroquel',
        medication_code: 'seroquel',
      }),
      makeEvent({
        id: '2',
        medication_definition_id: 'med-2',
        event_type: 'injected',
        event_date: '2025-01-10',
        display_name: 'Mounjaro',
        medication_code: 'mounjaro',
        route: 'injection',
      }),
      makeEvent({
        id: '3',
        medication_definition_id: 'med-1',
        event_type: 'missed',
        event_date: '2025-01-11',
        display_name: 'Seroquel',
        medication_code: 'seroquel',
      }),
    ];

    const timelines = buildMedicationTimelines(events);
    expect(timelines).toHaveLength(2);

    const seroquel = timelines.find((t) => t.code === 'seroquel');
    expect(seroquel).toBeDefined();
    expect(seroquel!.entries).toHaveLength(2);
    expect(seroquel!.entries[0].eventType).toBe('taken');
    expect(seroquel!.entries[1].eventType).toBe('missed');

    const mounjaro = timelines.find((t) => t.code === 'mounjaro');
    expect(mounjaro).toBeDefined();
    expect(mounjaro!.entries).toHaveLength(1);
    expect(mounjaro!.route).toBe('injection');
  });

  it('sorts entries by date ascending', () => {
    const events: MedicationEvent[] = [
      makeEvent({
        id: '1',
        event_type: 'taken',
        event_date: '2025-01-12',
        display_name: 'Seroquel',
        medication_code: 'seroquel',
      }),
      makeEvent({
        id: '2',
        event_type: 'missed',
        event_date: '2025-01-10',
        display_name: 'Seroquel',
        medication_code: 'seroquel',
      }),
    ];

    const timelines = buildMedicationTimelines(events);
    expect(timelines[0].entries[0].date).toBe('2025-01-10');
    expect(timelines[0].entries[1].date).toBe('2025-01-12');
  });

  it('returns empty array for no events', () => {
    expect(buildMedicationTimelines([])).toEqual([]);
  });
});

/* ── buildWeeklyAdherence ────────────────────────────────── */

describe('buildWeeklyAdherence', () => {
  it('computes weekly adherence percentage', () => {
    const events: MedicationEvent[] = [
      // Week of Jan 6: 3 taken, 1 missed → 75%
      makeEvent({ id: '1', event_type: 'taken', event_date: '2025-01-06', display_name: 'Seroquel', medication_code: 'seroquel' }),
      makeEvent({ id: '2', event_type: 'taken', event_date: '2025-01-07', display_name: 'Seroquel', medication_code: 'seroquel' }),
      makeEvent({ id: '3', event_type: 'taken', event_date: '2025-01-08', display_name: 'Seroquel', medication_code: 'seroquel' }),
      makeEvent({ id: '4', event_type: 'missed', event_date: '2025-01-09', display_name: 'Seroquel', medication_code: 'seroquel' }),
    ];

    const result = buildWeeklyAdherence(events);
    expect(result).toHaveLength(1);
    expect(result[0].weeks).toHaveLength(1);
    expect(result[0].weeks[0].adherencePercent).toBe(75);
    expect(result[0].weeks[0].taken).toBe(3);
    expect(result[0].weeks[0].missed).toBe(1);
  });

  it('counts injected as adherent', () => {
    const events: MedicationEvent[] = [
      makeEvent({
        id: '1',
        event_type: 'injected',
        event_date: '2025-01-06',
        display_name: 'Mounjaro',
        medication_code: 'mounjaro',
        route: 'injection',
      }),
    ];

    const result = buildWeeklyAdherence(events);
    expect(result[0].weeks[0].adherencePercent).toBe(100);
    expect(result[0].weeks[0].injected).toBe(1);
  });

  it('handles multiple weeks sorted chronologically', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: '1', event_type: 'taken', event_date: '2025-01-13', display_name: 'Seroquel', medication_code: 'seroquel' }),
      makeEvent({ id: '2', event_type: 'missed', event_date: '2025-01-06', display_name: 'Seroquel', medication_code: 'seroquel' }),
    ];

    const result = buildWeeklyAdherence(events);
    expect(result[0].weeks).toHaveLength(2);
    expect(result[0].weeks[0].weekStart).toBe('2025-01-06');
    expect(result[0].weeks[1].weekStart).toBe('2025-01-13');
  });

  it('returns empty for no events', () => {
    expect(buildWeeklyAdherence([])).toEqual([]);
  });
});

/* ── getMissedDoses ──────────────────────────────────────── */

describe('getMissedDoses', () => {
  it('filters only missed events', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: '1', event_type: 'taken', event_date: '2025-01-10', display_name: 'Seroquel', medication_code: 'seroquel' }),
      makeEvent({ id: '2', event_type: 'missed', event_date: '2025-01-11', display_name: 'Seroquel', medication_code: 'seroquel' }),
      makeEvent({ id: '3', event_type: 'missed', event_date: '2025-01-09', display_name: 'Seroquel', medication_code: 'seroquel' }),
    ];

    const missed = getMissedDoses(events);
    expect(missed).toHaveLength(2);
    expect(missed.every((e) => e.event_type === 'missed')).toBe(true);
  });

  it('sorts by date descending (most recent first)', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: '1', event_type: 'missed', event_date: '2025-01-09', display_name: 'Seroquel', medication_code: 'seroquel' }),
      makeEvent({ id: '2', event_type: 'missed', event_date: '2025-01-11', display_name: 'Seroquel', medication_code: 'seroquel' }),
    ];

    const missed = getMissedDoses(events);
    expect(missed[0].event_date).toBe('2025-01-11');
    expect(missed[1].event_date).toBe('2025-01-09');
  });

  it('returns empty for no missed events', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: '1', event_type: 'taken', event_date: '2025-01-10', display_name: 'Seroquel', medication_code: 'seroquel' }),
    ];
    expect(getMissedDoses(events)).toEqual([]);
  });
});
