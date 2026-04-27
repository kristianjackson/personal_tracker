/**
 * Medications page — per-medication adherence timeline, weekly adherence
 * bar chart, and missed-dose highlights.
 *
 * Validates: FR-DB-005
 * Design: Section 7.2
 */

import { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import type { DateRangePreset } from './trends-helpers.js';
import { resolvePreset, daysAgo, todayUTC } from './trends-helpers.js';
import { formatShortDate as formatShortDateOverview } from './overview-helpers.js';
import DateRangeSelector from '../components/DateRangeSelector.js';
import {
  type MedicationsApiResponse,
  type MedicationEvent,
  type AdherenceSummary,
  buildMedicationTimelines,
  buildWeeklyAdherence,
  getMissedDoses,
  formatShortDate,
  EVENT_TYPE_CONFIG,
} from './medications-helpers.js';
import './MedicationsPage.css';

/* ── Adherence rate color helper ─────────────────────────── */

function rateClass(rate: number): string {
  if (rate >= 0.8) return 'med-summary-rate--high';
  if (rate >= 0.5) return 'med-summary-rate--medium';
  return 'med-summary-rate--low';
}

/* ── Custom tooltip for weekly adherence chart ───────────── */

function AdherenceTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload || !label) return null;

  const point = payload[0];
  if (!point) return null;

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: '0.375rem',
        padding: '0.5rem 0.75rem',
        fontSize: '0.8125rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>Week of {label}</p>
      <p style={{ margin: '0.25rem 0 0', color: point.value >= 80 ? '#22c55e' : point.value >= 50 ? '#f59e0b' : '#ef4444' }}>
        {point.value}% adherence
      </p>
    </div>
  );
}

/* ── Bar color based on adherence percentage ─────────────── */

function getBarColor(percent: number): string {
  if (percent >= 80) return '#22c55e';
  if (percent >= 50) return '#f59e0b';
  return '#ef4444';
}

export default function MedicationsPage() {
  const [preset, setPreset] = useState<DateRangePreset>('30d');
  const [customStart, setCustomStart] = useState(daysAgo(29));
  const [customEnd, setCustomEnd] = useState(todayUTC());
  const [events, setEvents] = useState<MedicationEvent[]>([]);
  const [adherence, setAdherence] = useState<AdherenceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = resolvePreset(preset, customStart, customEnd);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/medications?start=${range.start}&end=${range.end}`,
      );
      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }
      const json = (await res.json()) as MedicationsApiResponse;
      setEvents(json.data.events);
      setAdherence(json.data.adherence);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handlePresetChange(p: DateRangePreset) {
    setPreset(p);
  }

  function handleCustomRangeChange(start: string, end: string) {
    setCustomStart(start);
    setCustomEnd(end);
    setPreset('custom');
  }

  const timelines = buildMedicationTimelines(events);
  const weeklyAdherence = buildWeeklyAdherence(events);
  const missedDoses = getMissedDoses(events);

  return (
    <div className="page medications">
      <h2>Medications</h2>
      <p className="medications-subtitle">
        {formatShortDateOverview(range.start)} –{' '}
        {formatShortDateOverview(range.end)}
      </p>

      <DateRangeSelector
        preset={preset}
        customStart={customStart}
        customEnd={customEnd}
        onPresetChange={handlePresetChange}
        onCustomRangeChange={handleCustomRangeChange}
      />

      {loading && (
        <div className="medications-loading" role="status" aria-live="polite">
          Loading…
        </div>
      )}

      {error && (
        <div className="medications-error" role="alert">
          <p>{error}</p>
          <button className="medications-retry" onClick={fetchData}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="medications-empty">
          No medication events for this period. Log a medication event to see
          adherence data.
        </div>
      )}

      {!loading && !error && events.length > 0 && (
        <>
          {/* ── Adherence summary cards ──────────────────────── */}
          <div className="med-summary-cards" role="list" aria-label="Medication adherence summaries">
            {adherence.map((med) => (
              <div key={med.medicationId} className="med-summary-card" role="listitem">
                <div className="med-summary-name">
                  {med.displayName}
                </div>
                <div
                  className={`med-summary-rate ${rateClass(med.adherenceRate)}`}
                  aria-label={`${Math.round(med.adherenceRate * 100)}% adherence`}
                >
                  {Math.round(med.adherenceRate * 100)}%
                </div>
                <div className="med-summary-counts">
                  {med.taken > 0 && (
                    <span className="med-summary-count">
                      <span className="med-count-dot med-count-dot--taken" />
                      {med.taken} taken
                    </span>
                  )}
                  {med.missed > 0 && (
                    <span className="med-summary-count">
                      <span className="med-count-dot med-count-dot--missed" />
                      {med.missed} missed
                    </span>
                  )}
                  {med.injected > 0 && (
                    <span className="med-summary-count">
                      <span className="med-count-dot med-count-dot--injected" />
                      {med.injected} injected
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Per-medication timeline ──────────────────────── */}
          <div className="med-section" aria-label="Medication event timeline">
            <h3>Event Timeline</h3>
            {timelines.map((timeline) => (
              <div key={timeline.medicationId} className="med-timeline-group">
                <div className="med-timeline-label">
                  {timeline.displayName}
                  {timeline.route === 'injection' && (
                    <span className="med-summary-route" style={{ marginLeft: '0.5rem' }}>
                      injection
                    </span>
                  )}
                </div>
                <div className="med-timeline-track" role="list" aria-label={`${timeline.displayName} events`}>
                  {timeline.entries.map((entry, i) => {
                    const config = EVENT_TYPE_CONFIG[entry.eventType];
                    const title = `${formatShortDate(entry.date)}: ${config.label}${
                      entry.doseValue ? ` (${entry.doseValue}${entry.doseUnit ?? ''})` : ''
                    }${entry.injectionSite ? ` — ${entry.injectionSite}` : ''}`;

                    return (
                      <div
                        key={`${entry.date}-${entry.eventType}-${i}`}
                        className={`med-timeline-dot med-timeline-dot--${entry.eventType}`}
                        title={title}
                        role="listitem"
                        aria-label={title}
                      >
                        {config.icon}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="med-timeline-legend">
              {Object.entries(EVENT_TYPE_CONFIG).map(([key, config]) => (
                <span key={key} className="med-timeline-legend-item">
                  <span
                    className="med-timeline-legend-swatch"
                    style={{ background: config.color }}
                  />
                  {config.label}
                </span>
              ))}
            </div>
          </div>

          {/* ── Weekly adherence bar charts ──────────────────── */}
          <div className="med-section" aria-label="Weekly adherence charts">
            <h3>Weekly Adherence</h3>
            {weeklyAdherence.length === 0 ? (
              <p className="medications-empty">
                Not enough data to show weekly adherence.
              </p>
            ) : (
              <div className="med-adherence-charts">
                {weeklyAdherence.map((med) => (
                  <div key={med.medicationId} className="med-adherence-chart-card">
                    <div className="med-adherence-chart-title">
                      {med.displayName}
                    </div>
                    <div className="med-adherence-chart-container">
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart
                          data={med.weeks}
                          margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#e5e7eb"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="weekLabel"
                            tick={{ fontSize: 11, fill: '#6b7280' }}
                            axisLine={{ stroke: '#e5e7eb' }}
                            tickLine={false}
                          />
                          <YAxis
                            domain={[0, 100]}
                            tick={{ fontSize: 11, fill: '#6b7280' }}
                            axisLine={{ stroke: '#e5e7eb' }}
                            tickLine={false}
                            width={36}
                            tickFormatter={(v: number) => `${v}%`}
                          />
                          <Tooltip content={<AdherenceTooltip />} />
                          <ReferenceLine
                            y={80}
                            stroke="#22c55e"
                            strokeDasharray="4 4"
                            strokeOpacity={0.5}
                            label={{
                              value: '80%',
                              position: 'right',
                              fill: '#22c55e',
                              fontSize: 10,
                            }}
                          />
                          <Bar
                            dataKey="adherencePercent"
                            name="Adherence"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={40}
                          >
                            {med.weeks.map((week, idx) => (
                              <Cell
                                key={idx}
                                fill={getBarColor(week.adherencePercent)}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Missed-dose highlights ───────────────────────── */}
          <div className="med-section" aria-label="Missed dose highlights">
            <h3>Missed Doses</h3>
            {missedDoses.length === 0 ? (
              <div className="missed-dose-empty">
                No missed doses in this period. Great adherence! 🎉
              </div>
            ) : (
              <ul className="missed-dose-list" role="list">
                {missedDoses.slice(0, 20).map((dose) => (
                  <li key={dose.id} className="missed-dose-item" role="listitem">
                    <span className="missed-dose-icon" aria-hidden="true">
                      ✗
                    </span>
                    <div className="missed-dose-info">
                      <span className="missed-dose-med">
                        {dose.display_name}
                      </span>
                      <span className="missed-dose-date">
                        {formatShortDate(dose.event_date)}
                      </span>
                    </div>
                  </li>
                ))}
                {missedDoses.length > 20 && (
                  <li className="missed-dose-item" style={{ justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                    +{missedDoses.length - 20} more missed doses
                  </li>
                )}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
