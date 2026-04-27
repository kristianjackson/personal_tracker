/**
 * Pure helper functions for the Medications page — extracted for testability.
 *
 * Validates: FR-DB-005
 * Design: Section 7.2
 */

/* ── Types ───────────────────────────────────────────────── */

export interface MedicationEvent {
  id: string;
  user_id: string;
  medication_definition_id: string;
  event_type: 'taken' | 'missed' | 'injected' | 'skipped';
  dose_value: number | null;
  dose_unit: string | null;
  injection_site: string | null;
  event_at: string;
  event_date: string;
  created_at: string;
  display_name: string;
  medication_code: string;
  route: string;
}

export interface AdherenceSummary {
  medicationId: string;
  displayName: string;
  code: string;
  taken: number;
  missed: number;
  injected: number;
  total: number;
  adherenceRate: number;
}

export interface MedicationsApiResponse {
  data: {
    events: MedicationEvent[];
    adherence: AdherenceSummary[];
    sideEffects: unknown[];
  };
}

/* ── Timeline types ──────────────────────────────────────── */

export interface TimelineEntry {
  date: string;
  eventType: 'taken' | 'missed' | 'injected' | 'skipped';
  doseValue: number | null;
  doseUnit: string | null;
  injectionSite: string | null;
  eventAt: string;
}

export interface MedicationTimeline {
  medicationId: string;
  displayName: string;
  code: string;
  route: string;
  entries: TimelineEntry[];
}

/* ── Weekly adherence types ──────────────────────────────── */

export interface WeeklyAdherencePoint {
  /** ISO week label, e.g. "Jan 6" (Monday of the week) */
  weekLabel: string;
  /** Start date of the week (YYYY-MM-DD) */
  weekStart: string;
  /** Adherence percentage 0–100 */
  adherencePercent: number;
  taken: number;
  missed: number;
  injected: number;
}

export interface MedicationWeeklyAdherence {
  medicationId: string;
  displayName: string;
  code: string;
  weeks: WeeklyAdherencePoint[];
}

/* ── Color palette for medications ───────────────────────── */

const MED_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#3b82f6', // blue
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
];

export function getMedicationColor(index: number): string {
  return MED_COLORS[index % MED_COLORS.length];
}

/* ── Event type styling ──────────────────────────────────── */

export const EVENT_TYPE_CONFIG: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  taken: { label: 'Taken', color: '#22c55e', icon: '✓' },
  missed: { label: 'Missed', color: '#ef4444', icon: '✗' },
  injected: { label: 'Injected', color: '#6366f1', icon: '💉' },
  skipped: { label: 'Skipped', color: '#9ca3af', icon: '–' },
};

/* ── Data transformation ─────────────────────────────────── */

/**
 * Group medication events by medication into timelines.
 */
export function buildMedicationTimelines(
  events: MedicationEvent[],
): MedicationTimeline[] {
  const map = new Map<
    string,
    {
      medicationId: string;
      displayName: string;
      code: string;
      route: string;
      entries: TimelineEntry[];
    }
  >();

  for (const ev of events) {
    const key = ev.medication_definition_id;
    if (!map.has(key)) {
      map.set(key, {
        medicationId: key,
        displayName: ev.display_name,
        code: ev.medication_code,
        route: ev.route,
        entries: [],
      });
    }
    map.get(key)!.entries.push({
      date: ev.event_date,
      eventType: ev.event_type,
      doseValue: ev.dose_value,
      doseUnit: ev.dose_unit,
      injectionSite: ev.injection_site,
      eventAt: ev.event_at,
    });
  }

  // Sort entries by date ascending within each medication
  for (const timeline of map.values()) {
    timeline.entries.sort((a, b) => a.date.localeCompare(b.date));
  }

  return Array.from(map.values());
}

/**
 * Get the Monday (ISO week start) for a given date string.
 */
export function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  // Shift Sunday (0) to 7 so Monday=1 is always the start
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Format a date as short label (e.g. "Jan 6").
 */
export function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Build weekly adherence data per medication.
 *
 * Adherence % = (taken + injected) / (taken + injected + missed) * 100
 * Skipped events are excluded from the calculation.
 */
export function buildWeeklyAdherence(
  events: MedicationEvent[],
): MedicationWeeklyAdherence[] {
  // Group by medication, then by week
  const medMap = new Map<
    string,
    {
      displayName: string;
      code: string;
      weeks: Map<string, { taken: number; missed: number; injected: number }>;
    }
  >();

  for (const ev of events) {
    const medKey = ev.medication_definition_id;
    if (!medMap.has(medKey)) {
      medMap.set(medKey, {
        displayName: ev.display_name,
        code: ev.medication_code,
        weeks: new Map(),
      });
    }

    const weekStart = getWeekStart(ev.event_date);
    const med = medMap.get(medKey)!;
    if (!med.weeks.has(weekStart)) {
      med.weeks.set(weekStart, { taken: 0, missed: 0, injected: 0 });
    }

    const week = med.weeks.get(weekStart)!;
    if (ev.event_type === 'taken') week.taken++;
    else if (ev.event_type === 'missed') week.missed++;
    else if (ev.event_type === 'injected') week.injected++;
  }

  const result: MedicationWeeklyAdherence[] = [];

  for (const [medId, med] of medMap) {
    const weeks: WeeklyAdherencePoint[] = [];
    // Sort weeks chronologically
    const sortedWeeks = Array.from(med.weeks.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    for (const [weekStart, counts] of sortedWeeks) {
      const adherent = counts.taken + counts.injected;
      const total = adherent + counts.missed;
      const percent = total > 0 ? Math.round((adherent / total) * 100) : 0;

      weeks.push({
        weekLabel: formatWeekLabel(weekStart),
        weekStart,
        adherencePercent: percent,
        taken: counts.taken,
        missed: counts.missed,
        injected: counts.injected,
      });
    }

    result.push({
      medicationId: medId,
      displayName: med.displayName,
      code: med.code,
      weeks,
    });
  }

  return result;
}

/**
 * Extract missed-dose events, sorted by date descending (most recent first).
 */
export function getMissedDoses(events: MedicationEvent[]): MedicationEvent[] {
  return events
    .filter((ev) => ev.event_type === 'missed')
    .sort((a, b) => b.event_date.localeCompare(a.event_date));
}

/**
 * Format a UTC timestamp for display.
 */
export function formatEventTime(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format a date string for short display (e.g. "Jan 15").
 */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
