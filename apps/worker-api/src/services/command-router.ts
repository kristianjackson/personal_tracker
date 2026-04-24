/**
 * Command router for inbound WhatsApp text messages.
 *
 * Parses raw text into structured command objects. Commands are
 * case-insensitive and can be sent at any time (even mid-check-in).
 *
 * Validates: FR-WA-005 (System shall support event commands: checkin, note:,
 *            inject, missed med, status, report month. Commands produce
 *            structured records.)
 * Validates: FR-WA-010 (System shall confirm saved entries succinctly.
 *            User receives brief structured confirmation after each save.)
 * Design: Section 6.2 — Commands table
 */

// ── Command types ───────────────────────────────────────────────────

export type CommandType =
  | 'checkin'
  | 'note'
  | 'inject'
  | 'missed_med'
  | 'status'
  | 'report_month'
  | 'tags'
  | 'help'
  | 'message';

/** Base shape shared by every parsed command. */
interface BaseCommand {
  type: CommandType;
  raw: string;
}

export interface CheckinCommand extends BaseCommand {
  type: 'checkin';
  /** Optional date argument, e.g. "yesterday" or "2025-04-20". */
  dateArg: string | null;
}

export interface NoteCommand extends BaseCommand {
  type: 'note';
  /** The note body text after the "note:" prefix. */
  text: string;
}

export interface InjectCommand extends BaseCommand {
  type: 'inject';
}

export interface MissedMedCommand extends BaseCommand {
  type: 'missed_med';
  /** Optional medication name extracted from the message. */
  medicationName: string | null;
}

export interface StatusCommand extends BaseCommand {
  type: 'status';
}

export interface ReportMonthCommand extends BaseCommand {
  type: 'report_month';
}

export interface TagsCommand extends BaseCommand {
  type: 'tags';
}

export interface HelpCommand extends BaseCommand {
  type: 'help';
}

/** Fallback for unrecognized text (used in active sessions or as unknown input). */
export interface MessageCommand extends BaseCommand {
  type: 'message';
  text: string;
}

export type ParsedCommand =
  | CheckinCommand
  | NoteCommand
  | InjectCommand
  | MissedMedCommand
  | StatusCommand
  | ReportMonthCommand
  | TagsCommand
  | HelpCommand
  | MessageCommand;

// ── Parser ──────────────────────────────────────────────────────────

/**
 * Parse an inbound text message into a structured command.
 *
 * Matching is case-insensitive. The first matching rule wins.
 * Unrecognized text falls through to the "message" type.
 *
 * @param rawText - The raw inbound message text.
 * @returns A structured command object.
 */
export function parseCommand(rawText: string): ParsedCommand {
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();

  // note: <text> — must check before single-word commands
  if (lower.startsWith('note:')) {
    const text = trimmed.slice('note:'.length).trim();
    return { type: 'note', text, raw: trimmed };
  }

  // report month — two-word command, check before single-word matches
  if (lower === 'report month') {
    return { type: 'report_month', raw: trimmed };
  }

  // missed med / missed <med-name>
  if (lower === 'missed med' || lower.startsWith('missed ')) {
    const afterMissed = trimmed.slice('missed '.length).trim();
    const afterMissedLower = afterMissed.toLowerCase();
    // "missed med" → no specific medication
    const medicationName = afterMissedLower === 'med' ? null : afterMissed || null;
    return { type: 'missed_med', medicationName, raw: trimmed };
  }

  // checkin — with optional date argument
  if (lower === 'checkin' || lower.startsWith('checkin ')) {
    const afterCheckin = trimmed.slice('checkin'.length).trim();
    const dateArg = afterCheckin.length > 0 ? afterCheckin : null;
    return { type: 'checkin', dateArg, raw: trimmed };
  }

  // inject
  if (lower === 'inject') {
    return { type: 'inject', raw: trimmed };
  }

  // status
  if (lower === 'status') {
    return { type: 'status', raw: trimmed };
  }

  // tags
  if (lower === 'tags') {
    return { type: 'tags', raw: trimmed };
  }

  // help
  if (lower === 'help') {
    return { type: 'help', raw: trimmed };
  }

  // Fallback: unrecognized text → message
  return { type: 'message', text: trimmed, raw: trimmed };
}
