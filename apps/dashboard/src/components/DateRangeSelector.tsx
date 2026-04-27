/**
 * Date range selector with presets and custom date picker.
 *
 * Validates: FR-DB-006
 */

import { useState } from 'react';
import type { DateRangePreset } from '../pages/trends-helpers.js';
import './DateRangeSelector.css';

interface DateRangeSelectorProps {
  preset: DateRangePreset;
  customStart: string;
  customEnd: string;
  onPresetChange: (preset: DateRangePreset) => void;
  onCustomRangeChange: (start: string, end: string) => void;
}

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom' },
];

export default function DateRangeSelector({
  preset,
  customStart,
  customEnd,
  onPresetChange,
  onCustomRangeChange,
}: DateRangeSelectorProps) {
  const [localStart, setLocalStart] = useState(customStart);
  const [localEnd, setLocalEnd] = useState(customEnd);

  function handlePresetClick(p: DateRangePreset) {
    onPresetChange(p);
  }

  function handleApplyCustom() {
    if (localStart && localEnd && localStart <= localEnd) {
      onCustomRangeChange(localStart, localEnd);
    }
  }

  return (
    <div className="date-range-selector" role="group" aria-label="Date range selector">
      <div className="date-range-presets">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            className={`date-range-btn${preset === p.value ? ' active' : ''}`}
            onClick={() => handlePresetClick(p.value)}
            aria-pressed={preset === p.value}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="date-range-custom">
          <label className="date-range-label">
            From
            <input
              type="date"
              className="date-range-input"
              value={localStart}
              onChange={(e) => setLocalStart(e.target.value)}
              max={localEnd}
            />
          </label>
          <label className="date-range-label">
            To
            <input
              type="date"
              className="date-range-input"
              value={localEnd}
              onChange={(e) => setLocalEnd(e.target.value)}
              min={localStart}
            />
          </label>
          <button className="date-range-apply" onClick={handleApplyCustom}>
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
