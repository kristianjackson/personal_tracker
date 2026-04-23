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
