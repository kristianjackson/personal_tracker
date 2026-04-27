import { describe, it, expect } from 'vitest';
import {
  formatNoteDate,
  truncateBody,
  extractUniqueTags,
  buildNotesQueryString,
  PREDEFINED_TAGS,
} from './notes-helpers.js';
import type { NoteRecord } from './notes-helpers.js';

/* ── Test fixtures ───────────────────────────────────────── */

function makeNote(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: 'note-1',
    user_id: 'user-1',
    daily_checkin_id: null,
    body: 'This is a test note body.',
    tags: ['mood', 'sleep'],
    source: 'whatsapp',
    created_at: '2025-06-15T10:30:00Z',
    ...overrides,
  };
}

/* ── formatNoteDate ──────────────────────────────────────── */

describe('formatNoteDate', () => {
  it('formats an ISO timestamp to a readable string', () => {
    const result = formatNoteDate('2025-06-15T10:30:00Z');
    // The exact format depends on locale, but should contain key parts
    expect(result).toContain('Jun');
    expect(result).toContain('15');
    expect(result).toContain('2025');
  });

  it('handles a midday timestamp', () => {
    const result = formatNoteDate('2025-01-15T12:00:00Z');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
    expect(result).toContain('2025');
  });
});

/* ── truncateBody ────────────────────────────────────────── */

describe('truncateBody', () => {
  it('returns the original string if shorter than maxLength', () => {
    expect(truncateBody('Short note', 150)).toBe('Short note');
  });

  it('returns the original string if exactly maxLength', () => {
    const body = 'a'.repeat(150);
    expect(truncateBody(body, 150)).toBe(body);
  });

  it('truncates and appends "..." when body exceeds maxLength', () => {
    const body = 'a'.repeat(200);
    const result = truncateBody(body, 150);
    expect(result).toHaveLength(153); // 150 + "..."
    expect(result.endsWith('...')).toBe(true);
  });

  it('trims trailing whitespace before appending "..."', () => {
    // 148 chars + 2 spaces = 150 chars, then more text
    const body = 'a'.repeat(148) + '  more text here';
    const result = truncateBody(body, 150);
    expect(result).toBe('a'.repeat(148) + '...');
  });

  it('uses default maxLength of 150', () => {
    const body = 'a'.repeat(200);
    const result = truncateBody(body);
    expect(result).toHaveLength(153);
  });

  it('handles empty string', () => {
    expect(truncateBody('')).toBe('');
  });
});

/* ── extractUniqueTags ───────────────────────────────────── */

describe('extractUniqueTags', () => {
  it('extracts unique tags from multiple notes', () => {
    const notes = [
      makeNote({ tags: ['mood', 'sleep'] }),
      makeNote({ tags: ['sleep', 'work'] }),
      makeNote({ tags: ['mood', 'therapy'] }),
    ];
    expect(extractUniqueTags(notes)).toEqual(['mood', 'sleep', 'therapy', 'work']);
  });

  it('returns empty array for notes with no tags', () => {
    const notes = [makeNote({ tags: [] }), makeNote({ tags: [] })];
    expect(extractUniqueTags(notes)).toEqual([]);
  });

  it('returns empty array for empty notes array', () => {
    expect(extractUniqueTags([])).toEqual([]);
  });

  it('sorts tags alphabetically', () => {
    const notes = [makeNote({ tags: ['work', 'conflict', 'meds'] })];
    expect(extractUniqueTags(notes)).toEqual(['conflict', 'meds', 'work']);
  });
});

/* ── buildNotesQueryString ───────────────────────────────── */

describe('buildNotesQueryString', () => {
  it('returns empty string when no params provided', () => {
    expect(buildNotesQueryString({})).toBe('');
  });

  it('builds query string with all params', () => {
    const qs = buildNotesQueryString({
      page: 2,
      limit: 10,
      start: '2025-01-01',
      end: '2025-01-31',
      tag: 'mood',
      q: 'headache',
    });
    expect(qs).toBe('?page=2&limit=10&start=2025-01-01&end=2025-01-31&tag=mood&q=headache');
  });

  it('encodes special characters in tag and q params', () => {
    const qs = buildNotesQueryString({ tag: 'a b', q: 'hello world' });
    expect(qs).toContain('tag=a%20b');
    expect(qs).toContain('q=hello%20world');
  });

  it('omits undefined/empty params', () => {
    const qs = buildNotesQueryString({ page: 1, tag: '' });
    expect(qs).toBe('?page=1');
  });
});

/* ── PREDEFINED_TAGS ─────────────────────────────────────── */

describe('PREDEFINED_TAGS', () => {
  it('contains the expected tags', () => {
    expect(PREDEFINED_TAGS).toContain('meds');
    expect(PREDEFINED_TAGS).toContain('work');
    expect(PREDEFINED_TAGS).toContain('conflict');
    expect(PREDEFINED_TAGS).toContain('sleep');
    expect(PREDEFINED_TAGS).toContain('mood');
    expect(PREDEFINED_TAGS).toContain('therapy');
    expect(PREDEFINED_TAGS).toContain('injection');
  });

  it('has 7 predefined tags', () => {
    expect(PREDEFINED_TAGS).toHaveLength(7);
  });
});
