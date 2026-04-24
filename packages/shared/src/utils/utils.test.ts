import { describe, it, expect } from 'vitest';
import {
  generateId,
  utcNow,
  localDateToday,
  parseCheckinDate,
  isCheckinDateError,
  diffCalendarDays,
  RETROACTIVE_LOOKBACK_DAYS,
} from './index.js';
import type { ParsedCheckinDate, CheckinDateError } from './index.js';

describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns unique values on successive calls', () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });
});

describe('utcNow', () => {
  it('returns a valid ISO 8601 string', () => {
    const now = utcNow();
    expect(new Date(now).toISOString()).toBe(now);
  });
});

describe('localDateToday', () => {
  it('returns a YYYY-MM-DD formatted string', () => {
    const date = localDateToday('America/New_York');
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── diffCalendarDays ────────────────────────────────────────────────

describe('diffCalendarDays', () => {
  it('returns 0 for the same date', () => {
    expect(diffCalendarDays('2025-07-15', '2025-07-15')).toBe(0);
  });

  it('returns positive when from is before to', () => {
    expect(diffCalendarDays('2025-07-10', '2025-07-15')).toBe(5);
  });

  it('returns negative when from is after to', () => {
    expect(diffCalendarDays('2025-07-20', '2025-07-15')).toBe(-5);
  });

  it('handles month boundaries', () => {
    expect(diffCalendarDays('2025-06-30', '2025-07-01')).toBe(1);
  });

  it('handles year boundaries', () => {
    expect(diffCalendarDays('2024-12-31', '2025-01-01')).toBe(1);
  });
});

// ── parseCheckinDate ────────────────────────────────────────────────

describe('parseCheckinDate', () => {
  // Use a fixed reference date: 2025-07-15 at noon UTC
  const refDate = new Date('2025-07-15T12:00:00Z');
  const tz = 'America/New_York';

  describe('no date argument (defaults to today)', () => {
    it('returns today when dateArg is null', () => {
      const result = parseCheckinDate(null, tz, refDate);
      expect(isCheckinDateError(result)).toBe(false);
      const parsed = result as ParsedCheckinDate;
      expect(parsed.date).toBe('2025-07-15');
      expect(parsed.isRetroactive).toBe(false);
    });

    it('returns today when dateArg is undefined', () => {
      const result = parseCheckinDate(undefined, tz, refDate);
      expect(isCheckinDateError(result)).toBe(false);
      const parsed = result as ParsedCheckinDate;
      expect(parsed.isRetroactive).toBe(false);
    });

    it('returns today when dateArg is empty string', () => {
      const result = parseCheckinDate('', tz, refDate);
      expect(isCheckinDateError(result)).toBe(false);
      const parsed = result as ParsedCheckinDate;
      expect(parsed.isRetroactive).toBe(false);
    });
  });

  describe('"yesterday" keyword', () => {
    it('returns yesterday as retroactive', () => {
      const result = parseCheckinDate('yesterday', tz, refDate);
      expect(isCheckinDateError(result)).toBe(false);
      const parsed = result as ParsedCheckinDate;
      expect(parsed.date).toBe('2025-07-14');
      expect(parsed.isRetroactive).toBe(true);
    });

    it('is case-insensitive', () => {
      const result = parseCheckinDate('Yesterday', tz, refDate);
      expect(isCheckinDateError(result)).toBe(false);
      const parsed = result as ParsedCheckinDate;
      expect(parsed.date).toBe('2025-07-14');
      expect(parsed.isRetroactive).toBe(true);
    });

    it('handles leading/trailing whitespace', () => {
      const result = parseCheckinDate('  yesterday  ', tz, refDate);
      expect(isCheckinDateError(result)).toBe(false);
      const parsed = result as ParsedCheckinDate;
      expect(parsed.isRetroactive).toBe(true);
    });
  });

  describe('specific YYYY-MM-DD date', () => {
    it('accepts today as non-retroactive', () => {
      const result = parseCheckinDate('2025-07-15', tz, refDate);
      expect(isCheckinDateError(result)).toBe(false);
      const parsed = result as ParsedCheckinDate;
      expect(parsed.date).toBe('2025-07-15');
      expect(parsed.isRetroactive).toBe(false);
    });

    it('accepts a date within the 7-day lookback as retroactive', () => {
      const result = parseCheckinDate('2025-07-10', tz, refDate);
      expect(isCheckinDateError(result)).toBe(false);
      const parsed = result as ParsedCheckinDate;
      expect(parsed.date).toBe('2025-07-10');
      expect(parsed.isRetroactive).toBe(true);
    });

    it('accepts exactly 7 days ago', () => {
      const result = parseCheckinDate('2025-07-08', tz, refDate);
      expect(isCheckinDateError(result)).toBe(false);
      const parsed = result as ParsedCheckinDate;
      expect(parsed.date).toBe('2025-07-08');
      expect(parsed.isRetroactive).toBe(true);
    });

    it('rejects a date older than 7 days', () => {
      const result = parseCheckinDate('2025-07-07', tz, refDate);
      expect(isCheckinDateError(result)).toBe(true);
      const err = result as CheckinDateError;
      expect(err.error).toContain('7 days');
    });

    it('rejects a future date', () => {
      const result = parseCheckinDate('2025-07-16', tz, refDate);
      expect(isCheckinDateError(result)).toBe(true);
      const err = result as CheckinDateError;
      expect(err.error).toContain('future');
    });
  });

  describe('invalid formats', () => {
    it('rejects non-date text', () => {
      const result = parseCheckinDate('last week', tz, refDate);
      expect(isCheckinDateError(result)).toBe(true);
      const err = result as CheckinDateError;
      expect(err.error).toContain('Invalid date format');
    });

    it('rejects partial date', () => {
      const result = parseCheckinDate('2025-07', tz, refDate);
      expect(isCheckinDateError(result)).toBe(true);
    });

    it('rejects invalid calendar date (Feb 30)', () => {
      const result = parseCheckinDate('2025-02-30', tz, refDate);
      expect(isCheckinDateError(result)).toBe(true);
      const err = result as CheckinDateError;
      expect(err.error).toContain('valid calendar date');
    });

    it('rejects invalid month', () => {
      const result = parseCheckinDate('2025-13-01', tz, refDate);
      expect(isCheckinDateError(result)).toBe(true);
    });
  });

  describe('isCheckinDateError type guard', () => {
    it('returns true for error results', () => {
      const result = parseCheckinDate('2099-01-01', tz, refDate);
      expect(isCheckinDateError(result)).toBe(true);
    });

    it('returns false for success results', () => {
      const result = parseCheckinDate(null, tz, refDate);
      expect(isCheckinDateError(result)).toBe(false);
    });
  });

  describe('RETROACTIVE_LOOKBACK_DAYS constant', () => {
    it('is 7', () => {
      expect(RETROACTIVE_LOOKBACK_DAYS).toBe(7);
    });
  });
});
