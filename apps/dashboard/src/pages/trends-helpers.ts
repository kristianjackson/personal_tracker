/**
 * Pure helper functions for the Trends page — extracted for testability.
 *
 * Validates: FR-DB-002, FR-DB-006
 * Design: Section 7.2
 */

import type { CheckinRecord, Observation } from './overview-helpers.js';

/* ── Types ───────────────────────────────────────────────── */

export interface TrendDataPoint {
  /** YYYY-MM-DD */
  date: string;
  /** Raw value for the day, or null if missing/skipped */
  value: number | null;
  /** 7-day rolling average, or null if fewer than 2 data points in window */
  rollingAvg: number | null;
}

export type DateRangePreset = '7d' | '30d' | '90d' | 'custom';

export interface DateRange {
  preset: DateRangePreset;
  start: string;
  end: string;
}

/** Chart metric definition */
export interface TrendMetric {
  variableCode: string;
  label: string;
  /** Y-axis domain: [min, max] */
  yDomain: [number, number];
  /** Unit label for the y-axis */
  unit: string;
  color: string;
  rollingAvgColor: string;
}

/* ── Metric definitions ──────────────────────────────────── */

export const TREND_METRICS: TrendMetric[] = [
  {
    variableCode: 'DAT-001',
    label: 'Sleep (hours)',
    yDomain: [0, 12],
    unit: 'hrs',
    color: '#6366f1',
    rollingAvgColor: '#a5b4fc',
  },
  {
    variableCode: 'DAT-003',
    label: 'Mood',
    yDomain: [0, 5],
    unit: '',
    color: '#f59e0b',
    rollingAvgColor: '#fcd34d',
  },
  {
    variableCode: 'DAT-004',
    label: 'Energy',
    yDomain: [0, 5],
    unit: '',
    color: '#10b981',
    rollingAvgColor: '#6ee7b7',
  },
  {
    variableCode: 'DAT-007',
    label: 'Focus',
    yDomain: [0, 5],
    unit: '',
    color: '#3b82f6',
    rollingAvgColor: '#93c5fd',
  },
  {
    variableCode: 'DAT-009',
    label: 'Impulsivity',
    yDomain: [0, 5],
    unit: '',
    color: '#ef4444',
    rollingAvgColor: '#fca5a5',
  },
  {
    variableCode: 'DAT-005',
    label: 'Irritability',
    yDomain: [0, 5],
    unit: '',
    color: '#ec4899',
    rollingAvgColor: '#f9a8d4',
  },
];

/* ── Date helpers ────────────────────────────────────────── */

/** Generate an array of YYYY-MM-DD strings between start and end (inclusive). */
export function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (d <= endDate) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

/** Get YYYY-MM-DD for N days ago from today (UTC). */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Get today's date as YYYY-MM-DD (UTC). */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Resolve a preset to a concrete date range. */
export function resolvePreset(preset: DateRangePreset, customStart?: string, customEnd?: string): DateRange {
  const end = todayUTC();
  switch (preset) {
    case '7d':
      return { preset, start: daysAgo(6), end };
    case '30d':
      return { preset, start: daysAgo(29), end };
    case '90d':
      return { preset, start: daysAgo(89), end };
    case 'custom':
      return { preset, start: customStart || daysAgo(29), end: customEnd || end };
  }
}

/* ── Data extraction ─────────────────────────────────────── */

/**
 * Extract a single variable's daily values from check-in records.
 * Returns a Map of date → numeric value (or null if missing/skipped).
 */
export function extractVariableValues(
  checkins: CheckinRecord[],
  variableCode: string,
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const ci of checkins) {
    const obs = ci.observations.find(
      (o: Observation) => o.variable_code === variableCode,
    );
    if (!obs || obs.skipped === 1) {
      map.set(ci.checkin_date, null);
    } else {
      map.set(ci.checkin_date, obs.value_numeric);
    }
  }
  return map;
}

/* ── Rolling average ─────────────────────────────────────── */

/**
 * Compute a 7-day rolling average for a series of daily values.
 *
 * For each date, looks back 7 days (including the current day) and computes
 * the arithmetic mean of non-null values. Returns null if fewer than 2
 * data points exist in the window.
 *
 * @param dates - Ordered array of YYYY-MM-DD strings (the full date range)
 * @param values - Map of date → value (null for missing)
 * @param windowSize - Rolling window size (default 7)
 * @param minPoints - Minimum non-null points required (default 2)
 */
export function computeRollingAverage(
  dates: string[],
  values: Map<string, number | null>,
  windowSize = 7,
  minPoints = 2,
): Map<string, number | null> {
  const result = new Map<string, number | null>();

  for (let i = 0; i < dates.length; i++) {
    const windowStart = Math.max(0, i - windowSize + 1);
    const windowDates = dates.slice(windowStart, i + 1);

    const windowValues: number[] = [];
    for (const d of windowDates) {
      const v = values.get(d);
      if (v !== null && v !== undefined) {
        windowValues.push(v);
      }
    }

    if (windowValues.length >= minPoints) {
      const sum = windowValues.reduce((a, b) => a + b, 0);
      result.set(dates[i], Math.round((sum / windowValues.length) * 100) / 100);
    } else {
      result.set(dates[i], null);
    }
  }

  return result;
}

/* ── Build trend data ────────────────────────────────────── */

/**
 * Build the full trend data series for a single variable.
 */
export function buildTrendData(
  checkins: CheckinRecord[],
  variableCode: string,
  start: string,
  end: string,
): TrendDataPoint[] {
  const dates = dateRange(start, end);
  const values = extractVariableValues(checkins, variableCode);
  const rollingAvg = computeRollingAverage(dates, values);

  return dates.map((date) => ({
    date,
    value: values.get(date) ?? null,
    rollingAvg: rollingAvg.get(date) ?? null,
  }));
}
