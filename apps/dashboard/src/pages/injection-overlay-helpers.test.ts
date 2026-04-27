/**
 * Unit tests for injection-overlay-helpers.
 *
 * Validates: FR-DB-003
 */

import { describe, it, expect } from 'vitest';
import {
  extractInjections,
  daysBetween,
  buildInjectionOverlayData,
  formatInjectionLabel,
  type SideEffectObservation,
} from './injection-overlay-helpers.js';
import type { MedicationEvent } from './medications-helpers.js';

/* ── Fixtures ────────────────────────────────────────────── */

function makeEvent(
  overrides: Partial<MedicationEvent> & {
    event_type: MedicationEvent['event_type'];
    event_date: string;
  },
): MedicationEvent {
  return {
    id: overrides.id ?? 'evt-1',
    user_id: overrides.user_id ?? 'user-1',
    medication_definition_id: overrides.medication_definition_id ?? 'med-mounjaro',
    event_type: overrides.event_type,
    dose_value: overrides.dose_value ?? null,
    dose_unit: overrides.dose_unit ?? null,
    injection_site: overrides.injection_site ?? null,
    event_at: overrides.event_at ?? `${overrides.event_date}T08:00:00Z`,
    event_date: overrides.event_date,
    created_at: overrides.created_at ?? `${overrides.event_date}T08:00:00Z`,
    display_name: overrides.display_name ?? 'Mounjaro',
    medication_code: overrides.medication_code ?? 'mounjaro',
    route: overrides.route ?? 'injection',
  };
}

function makeSideEffect(
  overrides: Partial<SideEffectObservation> & {
    variable_code: string;
    severity: number;
    observed_date: string;
  },
): SideEffectObservation {
  return {
    id: overrides.id ?? 'se-1',
    user_id: overrides.user_id ?? 'user-1',
    linked_medication_event_id: overrides.linked_medication_event_id ?? 'evt-1',
    variable_code: overrides.variable_code,
    severity: overrides.severity,
    observed_date: overrides.observed_date,
    observed_at: overrides.observed_at ?? `${overrides.observed_date}T12:00:00Z`,
  };
}

/* ── extractInjections ───────────────────────────────────── */

describe('extractInjections', () => {
  it('filters only injected events', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: '1', event_type: 'taken', event_date: '2025-01-10' }),
      makeEvent({ id: '2', event_type: 'injected', event_date: '2025-01-10', dose_value: 5, dose_unit: 'mg', injection_site: 'abdomen' }),
      makeEvent({ id: '3', event_type: 'missed', event_date: '2025-01-11' }),
    ];

    const injections = extractInjections(events);
    expect(injections).toHaveLength(1);
    expect(injections[0].eventId).toBe('2');
    expect(injections[0].doseValue).toBe(5);
    expect(injections[0].injectionSite).toBe('abdomen');
  });

  it('sorts injections by date ascending', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: '1', event_type: 'injected', event_date: '2025-01-15' }),
      makeEvent({ id: '2', event_type: 'injected', event_date: '2025-01-08' }),
    ];

    const injections = extractInjections(events);
    expect(injections[0].date).toBe('2025-01-08');
    expect(injections[1].date).toBe('2025-01-15');
  });

  it('returns empty for no injected events', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: '1', event_type: 'taken', event_date: '2025-01-10' }),
    ];
    expect(extractInjections(events)).toEqual([]);
  });
});

/* ── daysBetween ─────────────────────────────────────────── */

describe('daysBetween', () => {
  it('returns 0 for same date', () => {
    expect(daysBetween('2025-01-10', '2025-01-10')).toBe(0);
  });

  it('returns positive for later date', () => {
    expect(daysBetween('2025-01-10', '2025-01-13')).toBe(3);
  });

  it('returns negative for earlier date', () => {
    expect(daysBetween('2025-01-13', '2025-01-10')).toBe(-3);
  });
});

/* ── buildInjectionOverlayData ───────────────────────────── */

describe('buildInjectionOverlayData', () => {
  it('returns hasData=false when no injection events', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: '1', event_type: 'taken', event_date: '2025-01-10' }),
    ];
    const result = buildInjectionOverlayData(events, []);
    expect(result.hasData).toBe(false);
    expect(result.injections).toEqual([]);
    expect(result.dayOffsetSeries).toEqual([]);
  });

  it('returns hasData=false when injections exist but no side effects', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: '1', event_type: 'injected', event_date: '2025-01-10' }),
    ];
    const result = buildInjectionOverlayData(events, []);
    expect(result.hasData).toBe(false);
    expect(result.injections).toHaveLength(1);
    expect(result.dayOffsetSeries).toHaveLength(4); // day 0, +1, +2, +3
  });

  it('computes average severity by day offset for a single injection', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: 'inj-1', event_type: 'injected', event_date: '2025-01-10' }),
    ];
    const sideEffects: SideEffectObservation[] = [
      // Day 0: nausea=3
      makeSideEffect({ id: 'se-1', variable_code: 'DAT-024', severity: 3, observed_date: '2025-01-10', linked_medication_event_id: 'inj-1' }),
      // Day +1: nausea=4
      makeSideEffect({ id: 'se-2', variable_code: 'DAT-024', severity: 4, observed_date: '2025-01-11', linked_medication_event_id: 'inj-1' }),
      // Day +2: nausea=2
      makeSideEffect({ id: 'se-3', variable_code: 'DAT-024', severity: 2, observed_date: '2025-01-12', linked_medication_event_id: 'inj-1' }),
      // Day +3: nausea=1
      makeSideEffect({ id: 'se-4', variable_code: 'DAT-024', severity: 1, observed_date: '2025-01-13', linked_medication_event_id: 'inj-1' }),
    ];

    const result = buildInjectionOverlayData(events, sideEffects);
    expect(result.hasData).toBe(true);
    expect(result.dayOffsetSeries).toHaveLength(4);

    expect(result.dayOffsetSeries[0].dayLabel).toBe('Day 0');
    expect(result.dayOffsetSeries[0].nausea).toBe(3);

    expect(result.dayOffsetSeries[1].dayLabel).toBe('+1');
    expect(result.dayOffsetSeries[1].nausea).toBe(4);

    expect(result.dayOffsetSeries[2].dayLabel).toBe('+2');
    expect(result.dayOffsetSeries[2].nausea).toBe(2);

    expect(result.dayOffsetSeries[3].dayLabel).toBe('+3');
    expect(result.dayOffsetSeries[3].nausea).toBe(1);
  });

  it('averages across multiple injections at same day offset', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: 'inj-1', event_type: 'injected', event_date: '2025-01-03' }),
      makeEvent({ id: 'inj-2', event_type: 'injected', event_date: '2025-01-10' }),
    ];
    const sideEffects: SideEffectObservation[] = [
      // Injection 1, Day 0: nausea=2
      makeSideEffect({ id: 'se-1', variable_code: 'DAT-024', severity: 2, observed_date: '2025-01-03' }),
      // Injection 2, Day 0: nausea=4
      makeSideEffect({ id: 'se-2', variable_code: 'DAT-024', severity: 4, observed_date: '2025-01-10' }),
    ];

    const result = buildInjectionOverlayData(events, sideEffects);
    // Average of 2 and 4 = 3
    expect(result.dayOffsetSeries[0].nausea).toBe(3);
  });

  it('handles multiple GI symptoms and appetite suppression', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: 'inj-1', event_type: 'injected', event_date: '2025-01-10' }),
    ];
    const sideEffects: SideEffectObservation[] = [
      makeSideEffect({ id: 'se-1', variable_code: 'DAT-024', severity: 3, observed_date: '2025-01-10' }), // nausea
      makeSideEffect({ id: 'se-2', variable_code: 'DAT-025', severity: 2, observed_date: '2025-01-10' }), // diarrhea
      makeSideEffect({ id: 'se-3', variable_code: 'DAT-027', severity: 1, observed_date: '2025-01-10' }), // constipation
      makeSideEffect({ id: 'se-4', variable_code: 'DAT-030', severity: 4, observed_date: '2025-01-10' }), // appetite suppression
    ];

    const result = buildInjectionOverlayData(events, sideEffects);
    const day0 = result.dayOffsetSeries[0];
    expect(day0.nausea).toBe(3);
    expect(day0.diarrhea).toBe(2);
    expect(day0.constipation).toBe(1);
    expect(day0.appetiteSuppression).toBe(4);
    expect(day0.vomiting).toBeNull();
    expect(day0.abdominalPain).toBeNull();
  });

  it('handles weight data on secondary axis', () => {
    const events: MedicationEvent[] = [
      makeEvent({ id: 'inj-1', event_type: 'injected', event_date: '2025-01-10' }),
    ];
    const sideEffects: SideEffectObservation[] = [
      makeSideEffect({ id: 'se-1', variable_code: 'DAT-031', severity: 185, observed_date: '2025-01-10' }),
      makeSideEffect({ id: 'se-2', variable_code: 'DAT-031', severity: 184, observed_date: '2025-01-11' }),
    ];

    const result = buildInjectionOverlayData(events, sideEffects);
    expect(result.dayOffsetSeries[0].weight).toBe(185);
    expect(result.dayOffsetSeries[1].weight).toBe(184);
    expect(result.dayOffsetSeries[2].weight).toBeNull();
  });
});

/* ── formatInjectionLabel ────────────────────────────────── */

describe('formatInjectionLabel', () => {
  it('formats with all fields', () => {
    const label = formatInjectionLabel({
      eventId: '1',
      date: '2025-01-10',
      doseValue: 5,
      doseUnit: 'mg',
      injectionSite: 'abdomen',
      eventAt: '2025-01-10T08:00:00Z',
    });
    expect(label).toBe('2025-01-10 · 5mg · abdomen');
  });

  it('formats with date only', () => {
    const label = formatInjectionLabel({
      eventId: '1',
      date: '2025-01-10',
      doseValue: null,
      doseUnit: null,
      injectionSite: null,
      eventAt: '2025-01-10T08:00:00Z',
    });
    expect(label).toBe('2025-01-10');
  });

  it('formats with dose but no site', () => {
    const label = formatInjectionLabel({
      eventId: '1',
      date: '2025-01-10',
      doseValue: 7.5,
      doseUnit: 'mg',
      injectionSite: null,
      eventAt: '2025-01-10T08:00:00Z',
    });
    expect(label).toBe('2025-01-10 · 7.5mg');
  });
});
