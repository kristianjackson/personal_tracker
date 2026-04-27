/**
 * Reusable line chart for a single trend metric.
 * Shows raw daily data and a 7-day rolling average overlay.
 *
 * Validates: FR-DB-002
 * Design: Section 7.2
 */

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { TrendDataPoint, TrendMetric } from '../pages/trends-helpers.js';
import './TrendChart.css';

interface TrendChartProps {
  metric: TrendMetric;
  data: TrendDataPoint[];
}

/** Format YYYY-MM-DD to short display (e.g. "Jan 15"). */
function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Custom tooltip content. */
function CustomTooltip({
  active,
  payload,
  label,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ value: number | null; dataKey: string; color: string }>;
  label?: string;
  metric: TrendMetric;
}) {
  if (!active || !payload || !label) return null;

  return (
    <div className="trend-tooltip">
      <p className="trend-tooltip-date">{formatDateLabel(label)}</p>
      {payload.map((entry) => {
        if (entry.value === null || entry.value === undefined) return null;
        const isAvg = entry.dataKey === 'rollingAvg';
        return (
          <p key={entry.dataKey} className="trend-tooltip-value" style={{ color: entry.color }}>
            {isAvg ? '7-day avg' : 'Daily'}:{' '}
            <strong>
              {entry.value}
              {metric.unit ? ` ${metric.unit}` : ''}
            </strong>
          </p>
        );
      })}
    </div>
  );
}

export default function TrendChart({ metric, data }: TrendChartProps) {
  const hasAnyData = data.some((d) => d.value !== null);

  if (!hasAnyData) {
    return (
      <div className="trend-chart-card">
        <h3 className="trend-chart-title">{metric.label}</h3>
        <div className="trend-chart-empty">No data for this period.</div>
      </div>
    );
  }

  // Compute tick interval based on data length
  const tickInterval = data.length > 60 ? 13 : data.length > 30 ? 6 : data.length > 14 ? 3 : 1;

  return (
    <div className="trend-chart-card">
      <h3 className="trend-chart-title">{metric.label}</h3>
      <div className="trend-chart-container">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateLabel}
              interval={tickInterval}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
            />
            <YAxis
              domain={metric.yDomain}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
              width={32}
            />
            <Tooltip
              content={<CustomTooltip metric={metric} />}
            />
            <Legend
              verticalAlign="top"
              height={28}
              iconType="line"
              wrapperStyle={{ fontSize: '0.75rem' }}
            />
            {/* Raw daily data — connectNulls=false to show gaps */}
            <Line
              type="monotone"
              dataKey="value"
              name="Daily"
              stroke={metric.color}
              strokeWidth={2}
              dot={{ r: 2.5, fill: metric.color }}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
            {/* 7-day rolling average overlay */}
            <Line
              type="monotone"
              dataKey="rollingAvg"
              name="7-day avg"
              stroke={metric.rollingAvgColor}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              connectNulls={true}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
