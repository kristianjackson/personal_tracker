/**
 * Pure helper functions for the injection overlay view — extracted for testability.
 *
 * Transforms injection events and side-effect observations into chart-ready
 * data showing day-offset from each injection (day 0, +1, +2, +3) with
 * appetite suppression, weight, and GI symptom severity curves overlaid.
 *
 * Validates: FR-DB-003
 * Design: Section 7.2 — Side-effect intensity by injection day offset
 */

import type { MedicationEvent } from './medications-helpers.js';

/* ── Types ───────────────────────────────────────────────── */

export interface SideEffectObservation {
  id: string;
  user_id: string;
  linked_medication_event_id: string | null;
  variable_code: string;
  severity: number;
  observed_date: string;
  observed_at: string;
}

/** A single injection event with its metadata. */
export interface InjectionMarker {
  eventId: string;
  date: string;
  doseValue: number | null;
  doseUnit: string | null;
  injectionSite: string | null;
  eventAt: string;
}

/** A data point for the injection overlay chart (one per day-offset). */
export interface InjectionDayOffsetPoint {
  /** Day offset from injection: 0, 1, 2, 3 */
  dayOffset: number;
  /** Label for x-axis: "Day 0", "+1", "+2", "+3" */
  dayLabel: string;
  /** Average nausea severity across all injections at this offset */
  nausea: number | null;
  /** Average diarrhea severity */
  diarrhea: number | null;
  /** Average vomiting severity */
  vomiting: number | null;
  /** Average constipation severity */
  constipation: number | null;
  /** Average abdominal pain severity */
  abdominalPain: number | null;
  /** Average appetite suppression severity */
  appetiteSuppression: number | null;
  /** Average weight (pounds) — may be null if no weight data */
  weight: number | null;
}

/** Full dataset for the injection overlay chart. */
export interface InjectionOverlayData {
  injections: InjectionMarker[];
  dayOffsetSeries: InjectionDayOffsetPoint[];
  hasData: boolean;
}

/* ── Variable code mapping ───────────────────────────────── */

export const GI_VARIABLE_CODES = {
  nausea: 'DAT-024',
  diarrhea: 'DAT-025',
  vomiting: 'DAT-026',
  constipation: 'DAT-027',
  abdominalPain: 'DAT-028',
} as const;

export const APPETITE_CODE = 'DAT-030';
export const WEIGHT_CODE = 'DAT-031';

export const SIDE_EFFECT_LABELS: Record<string, string> = {
  'DAT-024': 'Nausea',
  'DAT-025': 'Diarrhea',
  'DAT-026': 'Vomiting',
  'DAT-027': 'Constipation',
  'DAT-028': 'Abdominal pain',
  'DAT-030': 'Appetite suppression',
  'DAT-031': 'Weight (lbs)',
};

/* ── Curve colors ────────────────────────────────────────── */

export const CURVE_COLORS: Record<string, string> = {
  nausea: '#ef4444',       // red
  diarrhea: '#f59e0b',     // amber
  vomiting: '#ec4899',     // pink
  constipation: '#8b5cf6', // violet
  abdominalPain: '#f97316',// orange
  appetiteSuppression: '#10b981', // emerald
  weight: '#3b82f6',       // blue
};

/* ── Max day offset to show ──────────────────────────────── */

export const MAX_DAY_OFFSET = 3;

/* ── Helper functions ────────────────────────────────────── */

/**
 * Extract injection events from medication events.
 */
export function extractInjections(events: MedicationEvent[]): InjectionMarker[] {
  return events
    .filter((ev) => ev.event_type === 'injected')
    .map((ev) => ({
      eventId: ev.id,
      date: ev.event_date,
      doseValue: ev.dose_value,
      doseUnit: ev.dose_unit,
      injectionSite: ev.injection_site,
      eventAt: ev.event_at,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Compute the day offset between two YYYY-MM-DD date strings.
 * Returns the number of days from `baseDate` to `targetDate`.
 */
export function daysBetween(baseDate: string, targetDate: string): number {
  const base = new Date(baseDate + 'T00:00:00Z');
  const target = new Date(targetDate + 'T00:00:00Z');
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

/**
 * Build the injection overlay data: for each day offset (0 through MAX_DAY_OFFSET),
 * compute the average severity of each side-effect variable across all injections.
 *
 * For each injection, we look at side-effect observations on the injection date
 * (day 0), +1 day, +2 days, and +3 days. We then average across all injections
 * to produce a single curve per side-effect type.
 */
export function buildInjectionOverlayData(
  events: MedicationEvent[],
  sideEffects: SideEffectObservation[],
): InjectionOverlayData {
  const injections = extractInjections(events);

  if (injections.length === 0) {
    return {
      injections: [],
      dayOffsetSeries: [],
      hasData: false,
    };
  }

  // Build a lookup: observed_date → variable_code → severity[]
  const sideEffectMap = new Map<string, Map<string, number[]>>();
  for (const se of sideEffects) {
    if (!sideEffectMap.has(se.observed_date)) {
      sideEffectMap.set(se.observed_date, new Map());
    }
    const dateMap = sideEffectMap.get(se.observed_date)!;
    if (!dateMap.has(se.variable_code)) {
      dateMap.set(se.variable_code, []);
    }
    dateMap.get(se.variable_code)!.push(se.severity);
  }

  // For each day offset, collect severity values across all injections
  const offsetData: Array<{
    nausea: number[];
    diarrhea: number[];
    vomiting: number[];
    constipation: number[];
    abdominalPain: number[];
    appetiteSuppression: number[];
    weight: number[];
  }> = [];

  for (let offset = 0; offset <= MAX_DAY_OFFSET; offset++) {
    offsetData.push({
      nausea: [],
      diarrhea: [],
      vomiting: [],
      constipation: [],
      abdominalPain: [],
      appetiteSuppression: [],
      weight: [],
    });
  }

  for (const injection of injections) {
    for (let offset = 0; offset <= MAX_DAY_OFFSET; offset++) {
      const targetDate = addDays(injection.date, offset);
      const dateMap = sideEffectMap.get(targetDate);
      if (!dateMap) continue;

      const bucket = offsetData[offset];

      collectValues(dateMap, GI_VARIABLE_CODES.nausea, bucket.nausea);
      collectValues(dateMap, GI_VARIABLE_CODES.diarrhea, bucket.diarrhea);
      collectValues(dateMap, GI_VARIABLE_CODES.vomiting, bucket.vomiting);
      collectValues(dateMap, GI_VARIABLE_CODES.constipation, bucket.constipation);
      collectValues(dateMap, GI_VARIABLE_CODES.abdominalPain, bucket.abdominalPain);
      collectValues(dateMap, APPETITE_CODE, bucket.appetiteSuppression);
      collectValues(dateMap, WEIGHT_CODE, bucket.weight);
    }
  }

  const dayOffsetSeries: InjectionDayOffsetPoint[] = offsetData.map(
    (bucket, offset) => ({
      dayOffset: offset,
      dayLabel: offset === 0 ? 'Day 0' : `+${offset}`,
      nausea: avg(bucket.nausea),
      diarrhea: avg(bucket.diarrhea),
      vomiting: avg(bucket.vomiting),
      constipation: avg(bucket.constipation),
      abdominalPain: avg(bucket.abdominalPain),
      appetiteSuppression: avg(bucket.appetiteSuppression),
      weight: avg(bucket.weight),
    }),
  );

  const hasData = dayOffsetSeries.some(
    (pt) =>
      pt.nausea !== null ||
      pt.diarrhea !== null ||
      pt.vomiting !== null ||
      pt.constipation !== null ||
      pt.abdominalPain !== null ||
      pt.appetiteSuppression !== null ||
      pt.weight !== null,
  );

  return { injections, dayOffsetSeries, hasData };
}

/* ── Internal utilities ──────────────────────────────────── */

/** Add N days to a YYYY-MM-DD string and return YYYY-MM-DD. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Collect values from a date map for a given variable code into the target array. */
function collectValues(
  dateMap: Map<string, number[]>,
  variableCode: string,
  target: number[],
): void {
  const values = dateMap.get(variableCode);
  if (values) {
    target.push(...values);
  }
}

/** Compute the average of an array of numbers, or null if empty. */
function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

/**
 * Format an injection marker for display.
 */
export function formatInjectionLabel(marker: InjectionMarker): string {
  const parts = [marker.date];
  if (marker.doseValue) {
    parts.push(`${marker.doseValue}${marker.doseUnit ?? 'mg'}`);
  }
  if (marker.injectionSite) {
    parts.push(marker.injectionSite);
  }
  return parts.join(' · ');
}
