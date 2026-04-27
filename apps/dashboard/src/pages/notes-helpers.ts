/**
 * Pure helper functions for the Notes page — extracted for testability.
 *
 * Validates: FR-DB-004
 */

/* ── Types ───────────────────────────────────────────────── */

export interface NoteRecord {
  id: string;
  user_id: string;
  daily_checkin_id: string | null;
  body: string;
  tags: string[];
  source: string;
  created_at: string;
}

export interface NotesPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface NotesApiResponse {
  data: NoteRecord[];
  pagination: NotesPagination;
}

/* ── Predefined tags ─────────────────────────────────────── */

export const PREDEFINED_TAGS = [
  'meds',
  'work',
  'conflict',
  'sleep',
  'mood',
  'therapy',
  'injection',
] as const;

/* ── Helpers ─────────────────────────────────────────────── */

/**
 * Format an ISO 8601 UTC timestamp to a readable date/time string.
 * Example: "Jun 15, 2025, 10:30 AM"
 */
export function formatNoteDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Truncate a note body to maxLength characters, appending "..." if truncated.
 * Returns the original string if it's shorter than or equal to maxLength.
 */
export function truncateBody(body: string, maxLength = 150): string {
  if (body.length <= maxLength) return body;
  return body.slice(0, maxLength).trimEnd() + '...';
}

/**
 * Extract unique tags from an array of notes, sorted alphabetically.
 */
export function extractUniqueTags(notes: NoteRecord[]): string[] {
  const tagSet = new Set<string>();
  for (const note of notes) {
    for (const tag of note.tags) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}

/**
 * Build the query string for the notes API from filter state.
 */
export function buildNotesQueryString(params: {
  page?: number;
  limit?: number;
  start?: string;
  end?: string;
  tag?: string;
  q?: string;
}): string {
  const parts: string[] = [];
  if (params.page !== undefined) parts.push(`page=${params.page}`);
  if (params.limit !== undefined) parts.push(`limit=${params.limit}`);
  if (params.start) parts.push(`start=${params.start}`);
  if (params.end) parts.push(`end=${params.end}`);
  if (params.tag) parts.push(`tag=${encodeURIComponent(params.tag)}`);
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}
