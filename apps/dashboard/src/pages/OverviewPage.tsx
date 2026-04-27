import { useEffect, useState, useCallback } from 'react';
import {
  type OverviewData,
  type CheckinRecord,
  type DailyCompletion,
  type HeatmapData,
  type CellStatus,
  VARIABLE_LABELS,
  VARIABLE_CODES,
  dateRange,
  formatShortDate,
  formatTimestamp,
  buildDailyCompletion,
  buildHeatmapData,
  statusLabel,
} from './overview-helpers.js';
import './OverviewPage.css';

export type { OverviewData, CheckinRecord };

/* ── Helpers ─────────────────────────────────────────────── */

/** Default 30-day start date. */
function defaultStart(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ── Sub-components ──────────────────────────────────────── */

function StatCards({ data }: { data: OverviewData }) {
  return (
    <div className="stat-cards" role="list" aria-label="Overview statistics">
      <div className="stat-card" role="listitem">
        <span className="stat-card-label">Completion Rate</span>
        <span className="stat-card-value">{Math.round(data.completionRate * 100)}%</span>
        <span className="stat-card-detail">
          {data.totalCheckins} check-in{data.totalCheckins !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="stat-card" role="listitem">
        <span className="stat-card-label">Streak</span>
        <span className="stat-card-value">{data.streak}</span>
        <span className="stat-card-detail">day{data.streak !== 1 ? 's' : ''}</span>
      </div>

      <div className="stat-card" role="listitem">
        <span className="stat-card-label">Notes</span>
        <span className="stat-card-value">{data.noteCount}</span>
        <span className="stat-card-detail">in period</span>
      </div>

      <div className="stat-card" role="listitem">
        <span className="stat-card-label">Active Flags</span>
        <span className="stat-card-value">{data.activeFlagCount}</span>
        <span className="stat-card-detail">unresolved</span>
      </div>

      <div className="stat-card" role="listitem">
        <span className="stat-card-label">Last Check-in</span>
        <span className="stat-card-value" style={{ fontSize: '1rem' }}>
          {data.lastCheckinDate ? formatShortDate(data.lastCheckinDate) : '—'}
        </span>
        <span className="stat-card-detail">
          {data.lastCheckinAt ? formatTimestamp(data.lastCheckinAt) : 'No check-ins yet'}
        </span>
      </div>
    </div>
  );
}

/* ── Completion Chart (SVG) ──────────────────────────────── */

function CompletionChart({ dailyData }: { dailyData: DailyCompletion[] }) {
  if (dailyData.length === 0) {
    return <div className="completion-chart-empty">No data for this period.</div>;
  }

  const barWidth = 14;
  const barGap = 3;
  const chartHeight = 120;
  const labelHeight = 40;
  const topPadding = 16;
  const totalWidth = dailyData.length * (barWidth + barGap) + barGap;
  const svgHeight = chartHeight + labelHeight + topPadding;

  // Show date labels every ~5 days to avoid crowding
  const labelInterval = dailyData.length > 15 ? 5 : dailyData.length > 7 ? 3 : 1;

  return (
    <div className="completion-chart">
      <svg
        viewBox={`0 0 ${totalWidth} ${svgHeight}`}
        role="img"
        aria-label="Daily completion rate bar chart for the last 30 days"
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = topPadding + chartHeight - pct * chartHeight;
          return (
            <line
              key={pct}
              x1={0}
              y1={y}
              x2={totalWidth}
              y2={y}
              stroke="#e5e7eb"
              strokeWidth={0.5}
            />
          );
        })}

        {dailyData.map((d, i) => {
          const x = barGap + i * (barWidth + barGap);
          const barH = d.rate * chartHeight;
          const y = topPadding + chartHeight - barH;

          // Color: green if high, amber if partial, gray if no checkin
          let fill = '#e5e7eb';
          if (d.hasCheckin) {
            fill = d.rate >= 0.7 ? '#22c55e' : d.rate >= 0.3 ? '#facc15' : '#f87171';
          }

          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barH, 1)}
                rx={2}
                fill={fill}
              >
                <title>
                  {formatShortDate(d.date)}: {d.observationCount}/{d.totalVariables} variables (
                  {Math.round(d.rate * 100)}%)
                </title>
              </rect>

              {/* Date label */}
              {i % labelInterval === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={topPadding + chartHeight + 14}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#6b7280"
                  transform={`rotate(-45, ${x + barWidth / 2}, ${topPadding + chartHeight + 14})`}
                >
                  {formatShortDate(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Missing-data Heatmap ────────────────────────────────── */

function MissingDataHeatmap({ heatmap }: { heatmap: HeatmapData }) {
  if (heatmap.dates.length === 0) {
    return <div className="heatmap-empty">No data for this period.</div>;
  }

  // Show date headers every few days to avoid crowding
  const labelInterval = heatmap.dates.length > 15 ? 5 : heatmap.dates.length > 7 ? 3 : 1;

  return (
    <div className="heatmap-container">
      <table className="heatmap-table" role="grid" aria-label="Missing data by variable heatmap">
        <thead>
          <tr>
            <th scope="col">Variable</th>
            {heatmap.dates.map((date, i) => (
              <th key={date} scope="col">
                {i % labelInterval === 0 ? formatShortDate(date) : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {VARIABLE_CODES.map((code) => (
            <tr key={code}>
              <th scope="row">{VARIABLE_LABELS[code]}</th>
              {heatmap.dates.map((date) => {
                const status = heatmap.grid[code][date];
                const label = `${VARIABLE_LABELS[code]} on ${formatShortDate(date)}: ${statusLabel(status)}`;
                return (
                  <td key={date}>
                    <span
                      className={`heatmap-cell heatmap-cell--${status}`}
                      role="img"
                      aria-label={label}
                      title={label}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="heatmap-legend" aria-label="Heatmap legend">
        <span className="heatmap-legend-item">
          <span className="heatmap-legend-swatch" style={{ background: '#22c55e' }} />
          Has data
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-legend-swatch" style={{ background: '#facc15' }} />
          Skipped
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-legend-swatch" style={{ background: '#e5e7eb' }} />
          Missing
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-legend-swatch" style={{ background: '#f3f4f6' }} />
          No check-in
        </span>
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────── */

export default function OverviewPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [checkins, setCheckins] = useState<CheckinRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const start = defaultStart();
  const end = todayUTC();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, checkinsRes] = await Promise.all([
        fetch(`/api/overview?start=${start}&end=${end}`),
        fetch(`/api/checkins?start=${start}&end=${end}`),
      ]);

      if (!overviewRes.ok) {
        throw new Error(`Overview API returned ${overviewRes.status}`);
      }
      if (!checkinsRes.ok) {
        throw new Error(`Checkins API returned ${checkinsRes.status}`);
      }

      const overviewJson = (await overviewRes.json()) as { data: OverviewData };
      const checkinsJson = (await checkinsRes.json()) as { data: CheckinRecord[] };

      setOverview(overviewJson.data);
      setCheckins(checkinsJson.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="page overview">
        <h2>Overview</h2>
        <div className="overview-loading" role="status" aria-live="polite">
          Loading…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page overview">
        <h2>Overview</h2>
        <div className="overview-error" role="alert">
          <p>{error}</p>
          <button className="overview-retry" onClick={fetchData}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="page overview">
        <h2>Overview</h2>
        <div className="overview-empty">No data available.</div>
      </div>
    );
  }

  const dailyCompletion = buildDailyCompletion(checkins, start, end);
  const heatmap = buildHeatmapData(checkins, start, end);

  return (
    <div className="page overview">
      <h2>Overview</h2>
      <p className="overview-subtitle">
        {formatShortDate(start)} – {formatShortDate(end)}
      </p>

      <StatCards data={overview} />

      <section className="overview-section" aria-labelledby="completion-heading">
        <h3 id="completion-heading">Daily Completion Rate</h3>
        <CompletionChart dailyData={dailyCompletion} />
      </section>

      <section className="overview-section" aria-labelledby="heatmap-heading">
        <h3 id="heatmap-heading">Missing Data by Variable</h3>
        <MissingDataHeatmap heatmap={heatmap} />
      </section>
    </div>
  );
}
