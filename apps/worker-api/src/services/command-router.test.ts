import { describe, it, expect } from 'vitest';
import { parseCommand } from './command-router';
import type {
  CheckinCommand,
  NoteCommand,
  MissedMedCommand,
  TookMedCommand,
  TagsAddCommand,
  MessageCommand,
} from './command-router';

/**
 * Tests for the command router.
 *
 * Validates: FR-WA-005 (System shall support event commands: checkin, note:,
 *            inject, missed med, status, report month. Commands produce
 *            structured records.)
 * Design: Section 6.2 — Commands table
 */

// ── checkin ─────────────────────────────────────────────────────────

describe('checkin command', () => {
  it('parses "checkin" as a checkin command with no date', () => {
    const result = parseCommand('checkin') as CheckinCommand;
    expect(result.type).toBe('checkin');
    expect(result.dateArg).toBeNull();
  });

  it('is case-insensitive', () => {
    const result = parseCommand('CHECKIN') as CheckinCommand;
    expect(result.type).toBe('checkin');
    expect(result.dateArg).toBeNull();
  });

  it('parses "Checkin" with mixed case', () => {
    const result = parseCommand('Checkin') as CheckinCommand;
    expect(result.type).toBe('checkin');
  });

  it('extracts "yesterday" as a date argument', () => {
    const result = parseCommand('checkin yesterday') as CheckinCommand;
    expect(result.type).toBe('checkin');
    expect(result.dateArg).toBe('yesterday');
  });

  it('extracts a specific date as a date argument', () => {
    const result = parseCommand('checkin 2025-04-20') as CheckinCommand;
    expect(result.type).toBe('checkin');
    expect(result.dateArg).toBe('2025-04-20');
  });

  it('preserves the raw text', () => {
    const result = parseCommand('  checkin yesterday  ');
    expect(result.raw).toBe('checkin yesterday');
  });
});

// ── note: ───────────────────────────────────────────────────────────

describe('note: command', () => {
  it('parses "note: some text" and extracts the note body', () => {
    const result = parseCommand('note: big fight, felt activated') as NoteCommand;
    expect(result.type).toBe('note');
    expect(result.text).toBe('big fight, felt activated');
  });

  it('is case-insensitive for the prefix', () => {
    const result = parseCommand('NOTE: feeling great today') as NoteCommand;
    expect(result.type).toBe('note');
    expect(result.text).toBe('feeling great today');
  });

  it('handles "Note:" with mixed case', () => {
    const result = parseCommand('Note: therapy session went well') as NoteCommand;
    expect(result.type).toBe('note');
    expect(result.text).toBe('therapy session went well');
  });

  it('trims whitespace from the note text', () => {
    const result = parseCommand('note:   lots of spaces   ') as NoteCommand;
    expect(result.type).toBe('note');
    expect(result.text).toBe('lots of spaces');
  });

  it('handles note with no text after prefix', () => {
    const result = parseCommand('note:') as NoteCommand;
    expect(result.type).toBe('note');
    expect(result.text).toBe('');
  });

  it('handles note with only whitespace after prefix', () => {
    const result = parseCommand('note:   ') as NoteCommand;
    expect(result.type).toBe('note');
    expect(result.text).toBe('');
  });
});

// ── inject ──────────────────────────────────────────────────────────

describe('inject command', () => {
  it('parses "inject" as an inject command', () => {
    const result = parseCommand('inject');
    expect(result.type).toBe('inject');
  });

  it('is case-insensitive', () => {
    const result = parseCommand('INJECT');
    expect(result.type).toBe('inject');
  });

  it('does not match "inject something" (exact match only)', () => {
    const result = parseCommand('inject something');
    expect(result.type).toBe('message');
  });
});

// ── missed med ──────────────────────────────────────────────────────

describe('missed med command', () => {
  it('parses "missed med" with no medication name', () => {
    const result = parseCommand('missed med') as MissedMedCommand;
    expect(result.type).toBe('missed_med');
    expect(result.medicationName).toBeNull();
  });

  it('is case-insensitive', () => {
    const result = parseCommand('MISSED MED') as MissedMedCommand;
    expect(result.type).toBe('missed_med');
    expect(result.medicationName).toBeNull();
  });

  it('extracts medication name from "missed seroquel"', () => {
    const result = parseCommand('missed seroquel') as MissedMedCommand;
    expect(result.type).toBe('missed_med');
    expect(result.medicationName).toBe('seroquel');
  });

  it('extracts medication name from "missed Seroquel" preserving case', () => {
    const result = parseCommand('missed Seroquel') as MissedMedCommand;
    expect(result.type).toBe('missed_med');
    expect(result.medicationName).toBe('Seroquel');
  });

  it('extracts multi-word medication name', () => {
    const result = parseCommand('missed lithium carbonate') as MissedMedCommand;
    expect(result.type).toBe('missed_med');
    expect(result.medicationName).toBe('lithium carbonate');
  });
});

// ── status ──────────────────────────────────────────────────────────

describe('took med command', () => {
  it('parses "took seroquel" as a took_med command', () => {
    const result = parseCommand('took seroquel') as TookMedCommand;
    expect(result.type).toBe('took_med');
    expect(result.medicationName).toBe('seroquel');
  });

  it('is case-insensitive for the prefix', () => {
    const result = parseCommand('TOOK Seroquel') as TookMedCommand;
    expect(result.type).toBe('took_med');
    expect(result.medicationName).toBe('Seroquel');
  });

  it('preserves medication name casing', () => {
    const result = parseCommand('took Lithium') as TookMedCommand;
    expect(result.type).toBe('took_med');
    expect(result.medicationName).toBe('Lithium');
  });

  it('handles multi-word medication names', () => {
    const result = parseCommand('took lithium carbonate') as TookMedCommand;
    expect(result.type).toBe('took_med');
    expect(result.medicationName).toBe('lithium carbonate');
  });

  it('falls through to message when no med name given', () => {
    // "took" alone without a medication name should be a message
    const result = parseCommand('took');
    expect(result.type).toBe('message');
  });
});

describe('status command', () => {
  it('parses "status" as a status command', () => {
    const result = parseCommand('status');
    expect(result.type).toBe('status');
  });

  it('is case-insensitive', () => {
    const result = parseCommand('Status');
    expect(result.type).toBe('status');
  });

  it('does not match "status update" (exact match only)', () => {
    const result = parseCommand('status update');
    expect(result.type).toBe('message');
  });
});

// ── report month ────────────────────────────────────────────────────

describe('report month command', () => {
  it('parses "report month" as a report_month command', () => {
    const result = parseCommand('report month');
    expect(result.type).toBe('report_month');
  });

  it('is case-insensitive', () => {
    const result = parseCommand('Report Month');
    expect(result.type).toBe('report_month');
  });

  it('does not match "report" alone', () => {
    const result = parseCommand('report');
    expect(result.type).toBe('message');
  });
});

// ── tags ────────────────────────────────────────────────────────────

describe('tags command', () => {
  it('parses "tags" as a tags command', () => {
    const result = parseCommand('tags');
    expect(result.type).toBe('tags');
  });

  it('is case-insensitive', () => {
    const result = parseCommand('TAGS');
    expect(result.type).toBe('tags');
  });

  it('parses "tags list" as a tags command', () => {
    const result = parseCommand('tags list');
    expect(result.type).toBe('tags');
  });

  it('parses "tags add mood" as a tags_add command', () => {
    const result = parseCommand('tags add exercise') as TagsAddCommand;
    expect(result.type).toBe('tags_add');
    expect(result.tagName).toBe('exercise');
  });

  it('parses "tags add" with multi-word name (takes first word)', () => {
    const result = parseCommand('tags add self-care') as TagsAddCommand;
    expect(result.type).toBe('tags_add');
    expect(result.tagName).toBe('self-care');
  });

  it('is case-insensitive for tags add prefix', () => {
    const result = parseCommand('TAGS ADD exercise') as TagsAddCommand;
    expect(result.type).toBe('tags_add');
    expect(result.tagName).toBe('exercise');
  });

  it('preserves tag name casing in raw', () => {
    const result = parseCommand('tags add Exercise') as TagsAddCommand;
    expect(result.type).toBe('tags_add');
    expect(result.tagName).toBe('Exercise');
  });

  it('falls through to message for "tags something" that is not "add" or "list"', () => {
    const result = parseCommand('tags remove mood');
    expect(result.type).toBe('message');
  });
});

// ── help ────────────────────────────────────────────────────────────

describe('help command', () => {
  it('parses "help" as a help command', () => {
    const result = parseCommand('help');
    expect(result.type).toBe('help');
  });

  it('is case-insensitive', () => {
    const result = parseCommand('Help');
    expect(result.type).toBe('help');
  });
});

// ── message (fallback) ─────────────────────────────────────────────

describe('message fallback', () => {
  it('classifies unrecognized text as a message', () => {
    const result = parseCommand('slept 4 hours') as MessageCommand;
    expect(result.type).toBe('message');
    expect(result.text).toBe('slept 4 hours');
  });

  it('classifies a plain number as a message', () => {
    const result = parseCommand('4') as MessageCommand;
    expect(result.type).toBe('message');
    expect(result.text).toBe('4');
  });

  it('classifies random text as a message', () => {
    const result = parseCommand('feeling pretty good today') as MessageCommand;
    expect(result.type).toBe('message');
    expect(result.text).toBe('feeling pretty good today');
  });

  it('preserves the raw text in the message', () => {
    const result = parseCommand('  some text  ') as MessageCommand;
    expect(result.raw).toBe('some text');
    expect(result.text).toBe('some text');
  });
});

// ── Whitespace handling ─────────────────────────────────────────────

describe('whitespace handling', () => {
  it('trims leading and trailing whitespace', () => {
    const result = parseCommand('  help  ');
    expect(result.type).toBe('help');
  });

  it('handles tabs and newlines in leading/trailing whitespace', () => {
    const result = parseCommand('\t status \n');
    expect(result.type).toBe('status');
  });
});
