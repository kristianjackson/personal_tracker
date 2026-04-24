/**
 * Shared utility functions.
 */

/**
 * Generate a ULID-style unique identifier.
 * Uses crypto.randomUUID() as a simple stand-in; a proper ULID library
 * can be swapped in later if time-sortable IDs are needed.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Return the current UTC timestamp as an ISO 8601 string.
 */
export function utcNow(): string {
  return new Date().toISOString();
}

/**
 * Return today's date (YYYY-MM-DD) in the given IANA timezone.
 */
export function localDateToday(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

// ── Retroactive date parsing (FR-CAP-003) ───────────────────────

/** Maximum number of days in the past allowed for retroactive check-ins. */
export const RETROACTIVE_LOOKBACK_DAYS = 7;

/** Result of parsing a checkin date argument. */
export interface ParsedCheckinDate {
  /** The resolved YYYY-MM-DD date string. */
  date: string;
  /** Whether this date is retroactive (not today). */
  isRetroactive: boolean;
}

/** Error result when the date argument is invalid. */
export interface CheckinDateError {
  /** Human-readable error message for the user. */
  error: string;
}

/** Union result type for checkin date parsing. */
export type CheckinDateResult = ParsedCheckinDate | CheckinDateError;

/** Type guard to check if the result is an error. */
export function isCheckinDateError(result: CheckinDateResult): result is CheckinDateError {
  return 'error' in result;
}

/**
 * Compute the difference in calendar days between two YYYY-MM-DD date strings.
 *
 * Returns a positive number when `from` is before `to` (i.e. `from` is in the past).
 * Returns a negative number when `from` is after `to` (i.e. `from` is in the future).
 */
export function diffCalendarDays(from: string, to: string): number {
  const fromMs = Date.UTC(
    parseInt(from.slice(0, 4), 10),
    parseInt(from.slice(5, 7), 10) - 1,
    parseInt(from.slice(8, 10), 10),
  );
  const toMs = Date.UTC(
    parseInt(to.slice(0, 4), 10),
    parseInt(to.slice(5, 7), 10) - 1,
    parseInt(to.slice(8, 10), 10),
  );
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

/**
 * Parse and validate an optional date argument for the `checkin` command.
 *
 * Accepts:
 * - `null` or `undefined` → today's date (not retroactive)
 * - `"yesterday"` → yesterday's date in the user's timezone
 * - `"YYYY-MM-DD"` → specific date, validated within 7-day lookback
 *
 * Rejects:
 * - Future dates
 * - Dates older than 7 days
 * - Malformed date strings
 *
 * Validates: FR-CAP-003 (retroactive entry within 7-day lookback)
 * Design: DD-010 (user timezone is authoritative for dates)
 *
 * @param dateArg - The raw date argument from the checkin command, or null for today.
 * @param timezone - The user's IANA timezone string.
 * @param now - Optional Date override for testing. Defaults to current time.
 */
export function parseCheckinDate(
  dateArg: string | null | undefined,
  timezone: string,
  now?: Date,
): CheckinDateResult {
  const refDate = now ?? new Date();
  const today = refDate.toLocaleDateString('en-CA', { timeZone: timezone });

  // No date argument → today
  if (!dateArg) {
    return { date: today, isRetroactive: false };
  }

  const lower = dateArg.trim().toLowerCase();

  // "yesterday"
  if (lower === 'yesterday') {
    const yesterdayMs = refDate.getTime() - 24 * 60 * 60 * 1000;
    const yesterday = new Date(yesterdayMs).toLocaleDateString('en-CA', {
      timeZone: timezone,
    });
    return { date: yesterday, isRetroactive: true };
  }

  // YYYY-MM-DD format
  const dateMatch = lower.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    return {
      error:
        'Invalid date format. Use "checkin yesterday" or "checkin YYYY-MM-DD" (e.g. checkin 2025-04-20).',
    };
  }

  const year = parseInt(dateMatch[1], 10);
  const month = parseInt(dateMatch[2], 10);
  const day = parseInt(dateMatch[3], 10);

  // Validate the date components are real calendar values
  const testDate = new Date(Date.UTC(year, month - 1, day));
  if (
    testDate.getUTCFullYear() !== year ||
    testDate.getUTCMonth() !== month - 1 ||
    testDate.getUTCDate() !== day
  ) {
    return {
      error:
        'Invalid date. Please provide a valid calendar date in YYYY-MM-DD format.',
    };
  }

  const targetDate = dateArg.trim();
  const daysDiff = diffCalendarDays(targetDate, today);

  // Future date
  if (daysDiff < 0) {
    return { error: "Can't check in for a future date." };
  }

  // Today
  if (daysDiff === 0) {
    return { date: targetDate, isRetroactive: false };
  }

  // Older than lookback window
  if (daysDiff > RETROACTIVE_LOOKBACK_DAYS) {
    return {
      error: `That date is more than ${RETROACTIVE_LOOKBACK_DAYS} days ago. Retroactive check-ins are limited to the last ${RETROACTIVE_LOOKBACK_DAYS} days.`,
    };
  }

  // Valid retroactive date
  return { date: targetDate, isRetroactive: true };
}
