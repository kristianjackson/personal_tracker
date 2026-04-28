/**
 * Trends page — time-series charts for key symptom metrics.
 *
 * Validates: FR-DB-002, FR-DB-006
 * Design: Section 7.2
 */

import { useEffect, useState, useCallback } from 'react';
import type { CheckinRecord } from './overview-helpers.js';
import {
  type DateRangePreset,
  TREND_METRICS,
  resolvePreset,
  buildTrendData,
  daysAgo,
  todayUTC,
} from './trends-helpers.js';
import { formatShortDate } from './overview-helpers.js';
import DateRangeSelector from '../components/DateRangeSelector.js';
import TrendChart from '../components/TrendChart.js';
import { apiUrl } from '../api.js';
import './TrendsPage.css';

export default function TrendsPage() {
  const [preset, setPreset] = useState<DateRangePreset>('30d');
  const [customStart, setCustomStart] = useState(daysAgo(29));
  const [customEnd, setCustomEnd] = useState(todayUTC());
  const [checkins, setCheckins] = useState<CheckinRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = resolvePreset(preset, customStart, customEnd);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/checkins?start=${range.start}&end=${range.end}`));
      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }
      const json = (await res.json()) as { data: CheckinRecord[] };
      setCheckins(json.data);
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

  return (
    <div className="page trends">
      <h2>Trends</h2>
      <p className="trends-subtitle">
        {formatShortDate(range.start)} – {formatShortDate(range.end)}
      </p>

      <DateRangeSelector
        preset={preset}
        customStart={customStart}
        customEnd={customEnd}
        onPresetChange={handlePresetChange}
        onCustomRangeChange={handleCustomRangeChange}
      />

      {loading && (
        <div className="trends-loading" role="status" aria-live="polite">
          Loading…
        </div>
      )}

      {error && (
        <div className="trends-error" role="alert">
          <p>{error}</p>
          <button className="trends-retry" onClick={fetchData}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && checkins.length === 0 && (
        <div className="trends-empty">
          No check-in data for this period. Complete a daily check-in to see trends.
        </div>
      )}

      {!loading && !error && checkins.length > 0 && (
        <div className="trends-charts">
          {TREND_METRICS.map((metric) => (
            <TrendChart
              key={metric.variableCode}
              metric={metric}
              data={buildTrendData(checkins, metric.variableCode, range.start, range.end)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
