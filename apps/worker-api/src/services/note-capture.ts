/**
 * Freeform note capture service.
 *
 * Handles the `note: <text>` command: validates body length, auto-suggests
 * tags from the predefined list based on keyword matching, manages a
 * tag confirmation/edit flow via KV, and persists the note to D1.
 *
 * Validates: FR-WA-004 (User can send a note without entering check-in mode)
 * Validates: FR-CAP-005 (Notes save and render successfully, max 4000 chars)
 * Validates: FR-CAP-006 (User can associate one or more tags to a note)
 * Design: Section 5.5 (note table), Section 6.2 (note: command)
 */

import {
  generateId,
  utcNow,
  NOTE_MAX_LENGTH,
  getTags,
} from '@symptom-tracker/shared';
import type { TagDefinition } from '@symptom-tracker/shared';

// ── Types ───────────────────────────────────────────────────────────

/** Bindings needed by the note capture flow. */
export interface NoteCaptureEnv {
  DB: D1Database;
  KV: KVNamespace;
}

/** Result returned by the note capture handler. */
export interface NoteCaptureResult {
  /** Response message(s) to send back to the user. */
  messages: string[];
  /** Whether the note has been fully saved. */
  saved: boolean;
}

/** Pending note stored in KV while awaiting tag confirmation. */
export interface PendingNote {
  userId: string;
  body: string;
  suggestedTags: string[];
  createdAt: string;
}

// ── Constants ───────────────────────────────────────────────────────

/** KV key prefix for pending note tag confirmation. */
const PENDING_NOTE_PREFIX = 'pending-note:';

/** TTL for pending note confirmation (15 minutes). */
const PENDING_NOTE_TTL_SECONDS = 15 * 60;

/**
 * Keyword map: each predefined tag maps to keywords that, when found
 * in the note body, trigger that tag suggestion.
 *
 * Keywords are checked case-insensitively against the note text.
 */
const TAG_KEYWORDS: Record<string, string[]> = {
  meds: ['med', 'meds', 'medication', 'medications', 'pill', 'pills', 'dose', 'dosage', 'prescription', 'rx', 'seroquel', 'lithium', 'lamictal', 'mounjaro'],
  work: ['work', 'job', 'office', 'meeting', 'boss', 'coworker', 'deadline', 'project', 'shift'],
  conflict: ['conflict', 'fight', 'argument', 'argue', 'argued', 'confrontation', 'tension', 'disagreement', 'yelling', 'yelled'],
  sleep: ['sleep', 'slept', 'insomnia', 'nap', 'tired', 'exhausted', 'restless', 'awake', 'woke'],
  mood: ['mood', 'depressed', 'depression', 'happy', 'sad', 'anxious', 'anxiety', 'elevated', 'manic', 'hypo', 'activated', 'irritable', 'emotional'],
  therapy: ['therapy', 'therapist', 'counseling', 'counselor', 'session', 'psych', 'psychiatrist', 'psychologist'],
  injection: ['injection', 'inject', 'injected', 'shot', 'needle', 'mounjaro', 'tirzepatide', 'site', 'abdomen', 'thigh'],
};

// ── Tag suggestion ──────────────────────────────────────────────────

/**
 * Auto-suggest tags from the predefined tag list based on keyword
 * matching against the note text.
 *
 * Scans the note body (case-insensitive) for keywords associated with
 * each predefined tag. Returns the list of matching tag names.
 */
export function suggestTags(noteBody: string): string[] {
  const lowerBody = noteBody.toLowerCase();
  const predefinedTags = getTags();
  const tagNames = new Set(predefinedTags.map((t: TagDefinition) => t.name));
  const matched: string[] = [];

  for (const [tagName, keywords] of Object.entries(TAG_KEYWORDS)) {
    // Only suggest tags that exist in the predefined list
    if (!tagNames.has(tagName)) continue;

    const hasMatch = keywords.some((keyword) => {
      // Use word boundary matching to avoid partial matches
      const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i');
      return regex.test(lowerBody);
    });

    if (hasMatch) {
      matched.push(tagName);
    }
  }

  return matched;
}

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Validation ──────────────────────────────────────────────────────

/**
 * Validate and truncate note body to the max length.
 * Returns the validated body and whether it was truncated.
 */
export function validateNoteBody(body: string): { text: string; truncated: boolean } {
  const trimmed = body.trim();
  if (trimmed.length <= NOTE_MAX_LENGTH) {
    return { text: trimmed, truncated: false };
  }
  return { text: trimmed.slice(0, NOTE_MAX_LENGTH), truncated: true };
}

// ── KV helpers ──────────────────────────────────────────────────────

/** Build the KV key for a user's pending note. */
function pendingNoteKey(userId: string): string {
  return `${PENDING_NOTE_PREFIX}${userId}`;
}

/** Get a pending note from KV. */
export async function getPendingNote(
  kv: KVNamespace,
  userId: string,
): Promise<PendingNote | null> {
  const raw = await kv.get(pendingNoteKey(userId));
  if (!raw) return null;
  return JSON.parse(raw) as PendingNote;
}

/** Save a pending note to KV. */
async function savePendingNote(
  kv: KVNamespace,
  pending: PendingNote,
): Promise<void> {
  await kv.put(pendingNoteKey(pending.userId), JSON.stringify(pending), {
    expirationTtl: PENDING_NOTE_TTL_SECONDS,
  });
}

/** Delete a pending note from KV. */
async function deletePendingNote(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await kv.delete(pendingNoteKey(userId));
}

// ── D1 persistence ──────────────────────────────────────────────────

/**
 * Persist a note to the D1 `note` table.
 *
 * Returns the generated note ID.
 */
export async function persistNote(
  db: D1Database,
  userId: string,
  body: string,
  tags: string[],
): Promise<string> {
  const noteId = generateId();
  const now = utcNow();
  const tagsJson = JSON.stringify(tags);

  await db
    .prepare(
      `INSERT INTO note (id, user_id, daily_checkin_id, body, tags, source, created_at)
       VALUES (?, ?, NULL, ?, ?, 'whatsapp', ?)`,
    )
    .bind(noteId, userId, body, tagsJson, now)
    .run();

  return noteId;
}

// ── Tag formatting ──────────────────────────────────────────────────

/** Format suggested tags for display in a WhatsApp message. */
function formatTagSuggestion(tags: string[]): string {
  if (tags.length === 0) return '';
  return tags.map((t) => `#${t}`).join(' ');
}

/**
 * Parse a tag confirmation response from the user.
 *
 * Accepts:
 * - "yes" / "y" / "ok" → confirm suggested tags
 * - "no" / "n" / "none" → save with no tags
 * - Comma-separated tag names → use those tags instead
 */
export function parseTagResponse(
  text: string,
  suggestedTags: string[],
): { confirmed: boolean; tags: string[] } {
  const trimmed = text.trim().toLowerCase();

  // Confirm suggested tags
  if (['yes', 'y', 'ok', 'confirm'].includes(trimmed)) {
    return { confirmed: true, tags: suggestedTags };
  }

  // Reject all tags
  if (['no', 'n', 'none', 'skip'].includes(trimmed)) {
    return { confirmed: true, tags: [] };
  }

  // Parse comma-separated or space-separated tag list
  const predefinedTags = getTags();
  const validTagNames = new Set(predefinedTags.map((t: TagDefinition) => t.name));

  const inputTags = trimmed
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter((t) => t.length > 0);

  const validTags = inputTags.filter((t) => validTagNames.has(t));

  if (validTags.length > 0) {
    return { confirmed: true, tags: validTags };
  }

  // Could not parse — not confirmed
  return { confirmed: false, tags: [] };
}

// ── Flow handlers ───────────────────────────────────────────────────

/**
 * Handle a new `note: <text>` command.
 *
 * Validates the body, suggests tags, and either saves immediately
 * (no tags to suggest) or enters the tag confirmation flow.
 */
export async function handleNoteCommand(
  env: NoteCaptureEnv,
  userId: string,
  noteText: string,
): Promise<NoteCaptureResult> {
  // Validate body
  if (noteText.length === 0) {
    return {
      messages: ['Please include text after "note:", e.g. note: felt anxious today'],
      saved: false,
    };
  }

  const { text: body, truncated } = validateNoteBody(noteText);

  // Auto-suggest tags
  const suggested = suggestTags(body);

  if (suggested.length === 0) {
    // No tags to suggest — save immediately with empty tags
    await persistNote(env.DB, userId, body, []);
    const messages: string[] = [];
    if (truncated) {
      messages.push(`Note truncated to ${NOTE_MAX_LENGTH} characters.`);
    }
    messages.push('✓ Note saved.');
    return { messages, saved: true };
  }

  // Tags suggested — enter confirmation flow
  const pending: PendingNote = {
    userId,
    body,
    suggestedTags: suggested,
    createdAt: utcNow(),
  };
  await savePendingNote(env.KV, pending);

  const tagDisplay = formatTagSuggestion(suggested);
  const messages: string[] = [];
  if (truncated) {
    messages.push(`Note truncated to ${NOTE_MAX_LENGTH} characters.`);
  }
  messages.push(
    `Suggested tags: ${tagDisplay}\nReply "yes" to confirm, "no" for no tags, or type your own tags (comma-separated).`,
  );

  return { messages, saved: false };
}

/**
 * Handle a tag confirmation response for a pending note.
 *
 * Called when the user replies to a tag suggestion prompt.
 */
export async function handleTagConfirmation(
  env: NoteCaptureEnv,
  userId: string,
  text: string,
): Promise<NoteCaptureResult> {
  const pending = await getPendingNote(env.KV, userId);

  if (!pending) {
    return {
      messages: ['No pending note to confirm. Send "note: <text>" to create one.'],
      saved: false,
    };
  }

  const { confirmed, tags } = parseTagResponse(text, pending.suggestedTags);

  if (!confirmed) {
    // Could not parse the response — ask again
    const predefinedTags = getTags();
    const tagList = predefinedTags.map((t: TagDefinition) => t.name).join(', ');
    return {
      messages: [
        `Available tags: ${tagList}\nReply "yes" to confirm suggested tags, "no" for no tags, or type tag names (comma-separated).`,
      ],
      saved: false,
    };
  }

  // Save the note with confirmed tags
  await persistNote(env.DB, userId, pending.body, tags);
  await deletePendingNote(env.KV, userId);

  const tagInfo = tags.length > 0 ? ` ${formatTagSuggestion(tags)}` : '';
  return {
    messages: [`✓ Note saved.${tagInfo}`],
    saved: true,
  };
}
