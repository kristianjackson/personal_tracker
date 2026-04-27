/**
 * Injection overlay chart — shows injection event markers on a timeline
 * with appetite suppression, weight, and GI symptom severity curves overlaid.
 * X-axis shows day-offset from injection (Day 0, +1, +2, +3).
 *
 * Validates: FR-DB-003
 * Design: Section 7.2 — Side-effect intensity by injection day offset
 */

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type {
  InjectionOverlayData,
  InjectionDayOffsetPoint,
  InjectionMarker,
} from '../pages/injection-overlay-helpers.js';
import {
  CURVE_COLORS,
  formatInjectionLabel,
} from '../pages/injection-overlay-helpers.js';
import './InjectionOverlay.css';

interface InjectionOverlayProps {
  data: InjectionOverlayData;
}

/* ── Custom tooltip ──────────────────────────────────────── */

interface TooltipEntry {
  value: number | null;
  dataKey: string;
  name: string;
  color: string;
}

function OverlayTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  if (!active || !payload || !label) return null;

  const validEntries = payload.filter(
    (entry) => entry.value !== null && entry.value !== undefined,
  );

  if (validEntries.length === 0) return null;

  return (
    <div className="injection-overlay-tooltip">
      <p className="injection-overlay-tooltip-title">{label}</p>
      {validEntries.map((entry) => {
        const isWeight = entry.dataKey === 'weight';
        return (
          <p
            key={entry.dataKey}
            className="injection-overlay-tooltip-value"
            style={{ color: entry.color }}
          >
            {entry.name}:{' '}
            <strong>
              {entry.value}{isWeight ? ' lbs' : '/5'}
            </strong>
          </p>
        );
      })}
    </div>
  );
}

/* ── Injection list ──────────────────────────────────────── */

function InjectionList({ injections }: { injections: InjectionMarker[] }) {
  if (injections.length === 0) return null;

  return (
    <div className="injection-markers" role="list" aria-label="Injection events">
      {injections.map((inj) => (
        <div key={inj.eventId} className="injection-marker-item" role="listitem">
          <span className="injection-marker-icon" aria-hidden="true">💉</span>
          <span className="injection-marker-label">
            {formatInjectionLabel(inj)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────── */

export default function InjectionOverlay({ data }: InjectionOverlayProps) {
  if (!data.hasData && data.injections.length === 0) {
    return (
      <div className="injection-overlay-card">
        <h3 className="injection-overlay-title">Injection Side-Effect Overlay</h3>
        <div className="injection-overlay-empty">
          No injection events in this period. Log an injection to see side-effect patterns.
        </div>
      </div>
    );
  }

  // Determine if we have weight data to show a secondary y-axis
  const hasWeight = data.dayOffsetSeries.some((pt) => pt.weight !== null);

  // Determine which GI/appetite curves have data
  const hasNausea = data.dayOffsetSeries.some((pt) => pt.nausea !== null);
  const hasDiarrhea = data.dayOffsetSeries.some((pt) => pt.diarrhea !== null);
  const hasVomiting = data.dayOffsetSeries.some((pt) => pt.vomiting !== null);
  const hasConstipation = data.dayOffsetSeries.some((pt) => pt.constipation !== null);
  const hasAbdominalPain = data.dayOffsetSeries.some((pt) => pt.abdominalPain !== null);
  const hasAppetite = data.dayOffsetSeries.some((pt) => pt.appetiteSuppression !== null);

  const hasSeverityData =
    hasNausea || hasDiarrhea || hasVomiting || hasConstipation || hasAbdominalPain || hasAppetite;

  return (
    <div className="injection-overlay-card">
      <h3 className="injection-overlay-title">Injection Side-Effect Overlay</h3>
      <p className="injection-overlay-subtitle">
        Average side-effect severity by day offset from injection (across{' '}
        {data.injections.length} injection{data.injections.length !== 1 ? 's' : ''})
      </p>

      {/* Injection event markers */}
      <InjectionList injections={data.injections} />

      {/* Chart */}
      {(hasSeverityData || hasWeight) ? (
        <div className="injection-overlay-chart-container">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart
              data={data.dayOffsetSeries}
              margin={{ top: 8, right: hasWeight ? 48 : 12, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="dayLabel"
                tick={{ fontSize: 12, fill: '#6b7280' }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
              />
              {/* Left y-axis: severity 0–5 */}
              <YAxis
                yAxisId="severity"
                domain={[0, 5]}
                tick={{ fontSize: 11, fill: '#6b7280' }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                width={32}
                label={{
                  value: 'Severity (0–5)',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fontSize: 10, fill: '#9ca3af' },
                }}
              />
              {/* Right y-axis: weight (only if data exists) */}
              {hasWeight && (
                <YAxis
                  yAxisId="weight"
                  orientation="right"
                  tick={{ fontSize: 11, fill: '#3b82f6' }}
                  axisLine={{ stroke: '#3b82f6' }}
                  tickLine={false}
                  width={48}
                  label={{
                    value: 'Weight (lbs)',
                    angle: 90,
                    position: 'insideRight',
                    style: { fontSize: 10, fill: '#3b82f6' },
                  }}
                />
              )}
              <Tooltip content={<OverlayTooltip />} />
              <Legend
                verticalAlign="top"
                height={36}
                iconType="line"
                wrapperStyle={{ fontSize: '0.7rem' }}
              />

              {/* GI symptom curves */}
              {hasNausea && (
                <Line
                  yAxisId="severity"
                  type="monotone"
                  dataKey="nausea"
                  name="Nausea"
                  stroke={CURVE_COLORS.nausea}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CURVE_COLORS.nausea }}
                  connectNulls={false}
                />
              )}
              {hasDiarrhea && (
                <Line
                  yAxisId="severity"
                  type="monotone"
                  dataKey="diarrhea"
                  name="Diarrhea"
                  stroke={CURVE_COLORS.diarrhea}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CURVE_COLORS.diarrhea }}
                  connectNulls={false}
                />
              )}
              {hasVomiting && (
                <Line
                  yAxisId="severity"
                  type="monotone"
                  dataKey="vomiting"
                  name="Vomiting"
                  stroke={CURVE_COLORS.vomiting}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CURVE_COLORS.vomiting }}
                  connectNulls={false}
                />
              )}
              {hasConstipation && (
                <Line
                  yAxisId="severity"
                  type="monotone"
                  dataKey="constipation"
                  name="Constipation"
                  stroke={CURVE_COLORS.constipation}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CURVE_COLORS.constipation }}
                  connectNulls={false}
                />
              )}
              {hasAbdominalPain && (
                <Line
                  yAxisId="severity"
                  type="monotone"
                  dataKey="abdominalPain"
                  name="Abdominal pain"
                  stroke={CURVE_COLORS.abdominalPain}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CURVE_COLORS.abdominalPain }}
                  connectNulls={false}
                />
              )}

              {/* Appetite suppression curve */}
              {hasAppetite && (
                <Line
                  yAxisId="severity"
                  type="monotone"
                  dataKey="appetiteSuppression"
                  name="Appetite suppression"
                  stroke={CURVE_COLORS.appetiteSuppression}
                  strokeWidth={2.5}
                  strokeDasharray="6 3"
                  dot={{ r: 3, fill: CURVE_COLORS.appetiteSuppression }}
                  connectNulls={false}
                />
              )}

              {/* Weight curve on secondary axis */}
              {hasWeight && (
                <Line
                  yAxisId="weight"
                  type="monotone"
                  dataKey="weight"
                  name="Weight (lbs)"
                  stroke={CURVE_COLORS.weight}
                  strokeWidth={2.5}
                  strokeDasharray="4 2"
                  dot={{ r: 3, fill: CURVE_COLORS.weight }}
                  connectNulls={true}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="injection-overlay-empty">
          Injections found but no side-effect observations recorded yet.
          Log side effects after injection to see patterns here.
        </div>
      )}
    </div>
  );
}
