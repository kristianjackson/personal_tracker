/* Pure helper functions for the Overview page — extracted for testability. */

export interface OverviewData {
  totalCheckins: number;
  completionRate: number;
  streak: number;
  noteCount: number;
  activeFlagCount: number;
  lastCheckinDate: string | null;
  lastCheckinAt: string | null;
  periodStart: string;
  periodEnd: string;
}

export interface Observation {
  id: string;
  variable_code: string;
  value_numeric: number | null;
  value_text: string | null;
  scale_min: number | null;
  scale_max: number | null;
  skipped: number;
  entered_at: string;
}

export interface CheckinRecord {
  id: string;
  user_id: string;
  checkin_date: string;
  status: string;
  source: string;
  is_retroactive: number;
  created_at: string;
  updated_at: string;
  observations: Observation[];
}

export const VARIABLE_LABELS: Record<string, string> = {
  'DAT-001': 'Sleep hours',
  'DAT-002': 'Sleep quality',
  'DAT-003': 'Mood',
  'DAT-004': 'Energy',
  'DAT-005': 'Irritability',
  'DAT-006': 'Anxiety',
  'DAT-007': 'Focus',
  'DAT-008': 'Racing thoughts',
  'DAT-009': 'Impulsivity',
  'DAT-010': 'Risk-drive',
  'DAT-011': 'Conflict',
  'DAT-012': 'Appetite',
};

export const VARIABLE_CODES = Object.keys(VARIABLE_LABELS);

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

/** Format a date string for display (short month + day). */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Format a timestamp for display. */
export function formatTimestamp(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export type CellStatus = 'has-data' | 'skipped' | 'missing' | 'no-checkin';

export interface DailyCompletion {
  date: string;
  hasCheckin: boolean;
  observationCount: number;
  totalVariables: number;
  rate: number;
}

export interface HeatmapData {
  dates: string[];
  grid: Record<string, Record<string, CellStatus>>;
}

export function buildDailyCompletion(
  checkins: CheckinRecord[],
  start: string,
  end: string,
): DailyCompletion[] {
  const checkinMap = new Map<string, CheckinRecord>();
  for (const ci of checkins) {
    checkinMap.set(ci.checkin_date, ci);
  }

  const dates = dateRange(start, end);
  const totalVars = VARIABLE_CODES.length;

  return dates.map((date) => {
    const ci = checkinMap.get(date);
    if (!ci) {
      return { date, hasCheckin: false, observationCount: 0, totalVariables: totalVars, rate: 0 };
    }
    const answered = ci.observations.filter(
      (o) => VARIABLE_CODES.includes(o.variable_code) && o.skipped === 0 && o.value_numeric !== null,
    ).length;
    return {
      date,
      hasCheckin: true,
      observationCount: answered,
      totalVariables: totalVars,
      rate: totalVars > 0 ? answered / totalVars : 0,
    };
  });
}

export function buildHeatmapData(
  checkins: CheckinRecord[],
  start: string,
  end: string,
): HeatmapData {
  const dates = dateRange(start, end);
  const checkinMap = new Map<string, CheckinRecord>();
  for (const ci of checkins) {
    checkinMap.set(ci.checkin_date, ci);
  }

  const grid: Record<string, Record<string, CellStatus>> = {};
  for (const code of VARIABLE_CODES) {
    grid[code] = {};
    for (const date of dates) {
      const ci = checkinMap.get(date);
      if (!ci) {
        grid[code][date] = 'no-checkin';
        continue;
      }
      const obs = ci.observations.find((o) => o.variable_code === code);
      if (!obs) {
        grid[code][date] = 'missing';
      } else if (obs.skipped === 1) {
        grid[code][date] = 'skipped';
      } else if (obs.value_numeric !== null) {
        grid[code][date] = 'has-data';
      } else {
        grid[code][date] = 'missing';
      }
    }
  }

  return { dates, grid };
}

export function statusLabel(status: CellStatus): string {
  switch (status) {
    case 'has-data':
      return 'recorded';
    case 'skipped':
      return 'skipped';
    case 'missing':
      return 'missing';
    case 'no-checkin':
      return 'no check-in';
  }
}
