/**
 * Tests for the freeform note capture service.
 *
 * Validates: FR-WA-004 (User can send a note without entering check-in mode)
 * Validates: FR-CAP-005 (Notes save and render successfully, max 4000 chars)
 * Validates: FR-CAP-006 (User can associate one or more tags to a note)
 * Design: Section 5.5 (note table), Section 6.2 (note: command)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  suggestTags,
  validateNoteBody,
  parseTagResponse,
  handleNoteCommand,
  handleTagConfirmation,
  persistNote,
  getPendingNote,
} from './note-capture';
import type { NoteCaptureEnv } from './note-capture';
import { NOTE_MAX_LENGTH } from '@symptom-tracker/shared';

// ── KV mock ─────────────────────────────────────────────────────────

interface KVEntry {
  value: string;
  expirationTtl?: number;
}

function createKVMock() {
  const store = new Map<string, KVEntry>();

  const kv: KVNamespace = {
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      return entry ? entry.value : null;
    }),
    put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, { value, expirationTtl: opts?.expirationTtl });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;

  return { kv, store };
}

// ── D1 mock ─────────────────────────────────────────────────────────

function createD1Mock() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];

  const preparedStatement = (sql: string) => {
    let boundParams: unknown[] = [];
    const stmt: D1PreparedStatement = {
      bind: (...params: unknown[]) => {
        boundParams = params;
        statements.push({ sql, params });
        return stmt;
      },
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [], success: true, meta: {} })),
      run: vi.fn(async () => ({ results: [], success: true, meta: {} })),
      raw: vi.fn(async () => []),
    } as unknown as D1PreparedStatement;
    return stmt;
  };

  const db: D1Database = {
    prepare: vi.fn((sql: string) => preparedStatement(sql)),
    batch: vi.fn(async (stmts: D1PreparedStatement[]) => {
      return stmts.map(() => ({ results: [], success: true, meta: {} }));
    }),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;

  return { db, statements };
}

// ── Helpers ─────────────────────────────────────────────────────────

const TEST_USER_ID = 'user-test-456';

function createTestEnv(): { env: NoteCaptureEnv; kvStore: Map<string, KVEntry>; statements: Array<{ sql: string; params: unknown[] }> } {
  const { kv, store } = createKVMock();
  const { db, statements } = createD1Mock();
  return { env: { DB: db, KV: kv }, kvStore: store, statements };
}

// ── suggestTags ─────────────────────────────────────────────────────

describe('suggestTags', () => {
  it('suggests "conflict" and "mood" for fight-related text', () => {
    const tags = suggestTags('big fight, felt activated');
    expect(tags).toContain('conflict');
    expect(tags).toContain('mood');
  });

  it('suggests "therapy" for therapy-related text', () => {
    const tags = suggestTags('therapy session went well today');
    expect(tags).toContain('therapy');
  });

  it('suggests "meds" for medication-related text', () => {
    const tags = suggestTags('took my medication late today');
    expect(tags).toContain('meds');
  });

  it('suggests "sleep" for sleep-related text', () => {
    const tags = suggestTags('could not sleep at all, insomnia again');
    expect(tags).toContain('sleep');
  });

  it('suggests "work" for work-related text', () => {
    const tags = suggestTags('stressful meeting at work');
    expect(tags).toContain('work');
  });

  it('suggests "injection" for injection-related text', () => {
    const tags = suggestTags('mounjaro injection went fine');
    expect(tags).toContain('injection');
  });

  it('suggests multiple tags when multiple keywords match', () => {
    const tags = suggestTags('argument at work made me anxious, could not sleep');
    expect(tags).toContain('conflict');
    expect(tags).toContain('work');
    expect(tags).toContain('mood');
    expect(tags).toContain('sleep');
  });

  it('returns empty array when no keywords match', () => {
    const tags = suggestTags('went for a walk in the park');
    expect(tags).toEqual([]);
  });

  it('is case-insensitive', () => {
    const tags = suggestTags('THERAPY SESSION was great');
    expect(tags).toContain('therapy');
  });

  it('uses word boundary matching to avoid partial matches', () => {
    // "therapist" should match therapy tag (it's in the keyword list)
    const tags = suggestTags('saw my therapist');
    expect(tags).toContain('therapy');
  });

  it('does not match partial words that are not keywords', () => {
    // "sleeping" should not match "sleep" because of word boundary
    // Actually "sleeping" won't match \bsleep\b — but "slept" is a keyword
    const tags = suggestTags('I was sleeping well');
    // "sleeping" doesn't match \bsleep\b, but let's verify
    // Actually "sleeping" contains "sleep" but with word boundary it won't match
    // This is correct behavior — "sleeping" is not "sleep"
    expect(tags).not.toContain('sleep');
  });
});

// ── validateNoteBody ────────────────────────────────────────────────

describe('validateNoteBody', () => {
  it('returns trimmed text within limit', () => {
    const result = validateNoteBody('  hello world  ');
    expect(result.text).toBe('hello world');
    expect(result.truncated).toBe(false);
  });

  it('truncates text exceeding max length', () => {
    const longText = 'a'.repeat(NOTE_MAX_LENGTH + 500);
    const result = validateNoteBody(longText);
    expect(result.text.length).toBe(NOTE_MAX_LENGTH);
    expect(result.truncated).toBe(true);
  });

  it('does not truncate text at exactly max length', () => {
    const exactText = 'b'.repeat(NOTE_MAX_LENGTH);
    const result = validateNoteBody(exactText);
    expect(result.text.length).toBe(NOTE_MAX_LENGTH);
    expect(result.truncated).toBe(false);
  });

  it('handles empty string', () => {
    const result = validateNoteBody('');
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
  });
});

// ── parseTagResponse ────────────────────────────────────────────────

describe('parseTagResponse', () => {
  const suggested = ['conflict', 'mood'];

  it('confirms with "yes"', () => {
    const result = parseTagResponse('yes', suggested);
    expect(result.confirmed).toBe(true);
    expect(result.tags).toEqual(suggested);
  });

  it('confirms with "y"', () => {
    const result = parseTagResponse('y', suggested);
    expect(result.confirmed).toBe(true);
    expect(result.tags).toEqual(suggested);
  });

  it('confirms with "ok"', () => {
    const result = parseTagResponse('ok', suggested);
    expect(result.confirmed).toBe(true);
    expect(result.tags).toEqual(suggested);
  });

  it('rejects all tags with "no"', () => {
    const result = parseTagResponse('no', suggested);
    expect(result.confirmed).toBe(true);
    expect(result.tags).toEqual([]);
  });

  it('rejects all tags with "none"', () => {
    const result = parseTagResponse('none', suggested);
    expect(result.confirmed).toBe(true);
    expect(result.tags).toEqual([]);
  });

  it('rejects all tags with "skip"', () => {
    const result = parseTagResponse('skip', suggested);
    expect(result.confirmed).toBe(true);
    expect(result.tags).toEqual([]);
  });

  it('parses comma-separated valid tags', () => {
    const result = parseTagResponse('sleep, work', suggested);
    expect(result.confirmed).toBe(true);
    expect(result.tags).toEqual(['sleep', 'work']);
  });

  it('parses space-separated valid tags', () => {
    const result = parseTagResponse('meds therapy', suggested);
    expect(result.confirmed).toBe(true);
    expect(result.tags).toEqual(['meds', 'therapy']);
  });

  it('strips # prefix from tags', () => {
    const result = parseTagResponse('#meds, #conflict', suggested);
    expect(result.confirmed).toBe(true);
    expect(result.tags).toEqual(['meds', 'conflict']);
  });

  it('filters out invalid tag names', () => {
    const result = parseTagResponse('meds, invalid, sleep', suggested);
    expect(result.confirmed).toBe(true);
    expect(result.tags).toEqual(['meds', 'sleep']);
  });

  it('returns not confirmed for completely unrecognized input', () => {
    const result = parseTagResponse('what do you mean', suggested);
    expect(result.confirmed).toBe(false);
    expect(result.tags).toEqual([]);
  });

  it('is case-insensitive for yes/no', () => {
    expect(parseTagResponse('YES', suggested).confirmed).toBe(true);
    expect(parseTagResponse('NO', suggested).confirmed).toBe(true);
  });
});

// ── handleNoteCommand ───────────────────────────────────────────────

describe('handleNoteCommand', () => {
  it('rejects empty note text', async () => {
    const { env } = createTestEnv();
    const result = await handleNoteCommand(env, TEST_USER_ID, '');

    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('note:');
  });

  it('saves immediately when no tags are suggested', async () => {
    const { env, statements } = createTestEnv();
    const result = await handleNoteCommand(env, TEST_USER_ID, 'went for a walk in the park');

    expect(result.saved).toBe(true);
    expect(result.messages).toContain('✓ Note saved.');

    // Verify D1 insert was called
    const noteInsert = statements.find((s) => s.sql.includes('INSERT INTO note'));
    expect(noteInsert).toBeDefined();
    expect(noteInsert!.params[1]).toBe(TEST_USER_ID);
    expect(noteInsert!.params[2]).toBe('went for a walk in the park');
    expect(noteInsert!.params[3]).toBe('[]'); // empty tags
  });

  it('enters tag confirmation flow when tags are suggested', async () => {
    const { env, kvStore } = createTestEnv();
    const result = await handleNoteCommand(env, TEST_USER_ID, 'big fight, felt activated');

    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('Suggested tags');
    expect(result.messages[0]).toContain('#conflict');

    // Verify pending note was stored in KV
    const pendingKey = `pending-note:${TEST_USER_ID}`;
    expect(kvStore.has(pendingKey)).toBe(true);
  });

  it('truncates long notes and notifies user', async () => {
    const { env } = createTestEnv();
    const longText = 'a'.repeat(NOTE_MAX_LENGTH + 100);
    const result = await handleNoteCommand(env, TEST_USER_ID, longText);

    // No keywords match, so it saves immediately
    expect(result.saved).toBe(true);
    expect(result.messages[0]).toContain('truncated');
    expect(result.messages[1]).toBe('✓ Note saved.');
  });

  it('truncates long notes with tags and notifies user', async () => {
    const { env } = createTestEnv();
    // Start with a keyword then pad with characters
    const longText = 'therapy ' + 'a'.repeat(NOTE_MAX_LENGTH);
    const result = await handleNoteCommand(env, TEST_USER_ID, longText);

    // Tags suggested, so enters confirmation flow
    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('truncated');
    expect(result.messages[1]).toContain('Suggested tags');
  });
});

// ── handleTagConfirmation ───────────────────────────────────────────

describe('handleTagConfirmation', () => {
  it('returns error when no pending note exists', async () => {
    const { env } = createTestEnv();
    const result = await handleTagConfirmation(env, TEST_USER_ID, 'yes');

    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('No pending note');
  });

  it('saves note with suggested tags on "yes"', async () => {
    const { env, statements } = createTestEnv();

    // Create a pending note via the note command
    await handleNoteCommand(env, TEST_USER_ID, 'big fight at work');

    // Confirm tags
    const result = await handleTagConfirmation(env, TEST_USER_ID, 'yes');

    expect(result.saved).toBe(true);
    expect(result.messages[0]).toContain('✓ Note saved.');

    // Verify D1 insert
    const noteInsert = statements.find((s) => s.sql.includes('INSERT INTO note'));
    expect(noteInsert).toBeDefined();
    const tagsJson = noteInsert!.params[3] as string;
    const tags = JSON.parse(tagsJson);
    expect(tags).toContain('conflict');
    expect(tags).toContain('work');
  });

  it('saves note with no tags on "no"', async () => {
    const { env, statements } = createTestEnv();

    await handleNoteCommand(env, TEST_USER_ID, 'therapy session today');
    const result = await handleTagConfirmation(env, TEST_USER_ID, 'no');

    expect(result.saved).toBe(true);
    expect(result.messages[0]).toContain('✓ Note saved.');

    const noteInsert = statements.find((s) => s.sql.includes('INSERT INTO note'));
    expect(noteInsert).toBeDefined();
    expect(noteInsert!.params[3]).toBe('[]');
  });

  it('saves note with custom tags', async () => {
    const { env, statements } = createTestEnv();

    await handleNoteCommand(env, TEST_USER_ID, 'therapy session today');
    const result = await handleTagConfirmation(env, TEST_USER_ID, 'mood, sleep');

    expect(result.saved).toBe(true);

    const noteInsert = statements.find((s) => s.sql.includes('INSERT INTO note'));
    const tagsJson = noteInsert!.params[3] as string;
    const tags = JSON.parse(tagsJson);
    expect(tags).toEqual(['mood', 'sleep']);
  });

  it('shows available tags on unrecognized input', async () => {
    const { env } = createTestEnv();

    await handleNoteCommand(env, TEST_USER_ID, 'therapy session today');
    const result = await handleTagConfirmation(env, TEST_USER_ID, 'what do you mean');

    expect(result.saved).toBe(false);
    expect(result.messages[0]).toContain('Available tags');
  });

  it('cleans up pending note from KV after saving', async () => {
    const { env, kvStore } = createTestEnv();

    await handleNoteCommand(env, TEST_USER_ID, 'big fight at work');
    const pendingKey = `pending-note:${TEST_USER_ID}`;
    expect(kvStore.has(pendingKey)).toBe(true);

    await handleTagConfirmation(env, TEST_USER_ID, 'yes');
    expect(kvStore.has(pendingKey)).toBe(false);
  });
});

// ── persistNote ─────────────────────────────────────────────────────

describe('persistNote', () => {
  it('inserts a note row with correct fields', async () => {
    const { db, statements } = createD1Mock();

    const noteId = await persistNote(db, TEST_USER_ID, 'test note body', ['meds', 'sleep']);

    expect(typeof noteId).toBe('string');
    expect(noteId.length).toBeGreaterThan(0);

    const insert = statements.find((s) => s.sql.includes('INSERT INTO note'));
    expect(insert).toBeDefined();
    expect(insert!.params[1]).toBe(TEST_USER_ID); // user_id
    expect(insert!.params[2]).toBe('test note body'); // body
    expect(insert!.params[3]).toBe('["meds","sleep"]'); // tags JSON
  });

  it('stores empty tags as empty JSON array', async () => {
    const { db, statements } = createD1Mock();

    await persistNote(db, TEST_USER_ID, 'no tags here', []);

    const insert = statements.find((s) => s.sql.includes('INSERT INTO note'));
    expect(insert!.params[3]).toBe('[]');
  });

  it('sets daily_checkin_id to NULL', async () => {
    const { db, statements } = createD1Mock();

    await persistNote(db, TEST_USER_ID, 'standalone note', []);

    const insert = statements.find((s) => s.sql.includes('INSERT INTO note'));
    // The SQL uses NULL directly, not a bound parameter
    expect(insert!.sql).toContain('NULL');
  });

  it('sets source to whatsapp', async () => {
    const { db, statements } = createD1Mock();

    await persistNote(db, TEST_USER_ID, 'test', []);

    const insert = statements.find((s) => s.sql.includes('INSERT INTO note'));
    expect(insert!.sql).toContain("'whatsapp'");
  });
});

// ── Full flow integration ───────────────────────────────────────────

describe('full note capture flow', () => {
  it('saves a note with no keyword matches immediately', async () => {
    const { env } = createTestEnv();

    const result = await handleNoteCommand(env, TEST_USER_ID, 'beautiful sunset today');
    expect(result.saved).toBe(true);
    expect(result.messages).toContain('✓ Note saved.');
  });

  it('completes tag confirmation flow with "yes"', async () => {
    const { env } = createTestEnv();

    // Step 1: Send note with keywords
    const step1 = await handleNoteCommand(env, TEST_USER_ID, 'had a conflict at work');
    expect(step1.saved).toBe(false);
    expect(step1.messages[0]).toContain('Suggested tags');

    // Step 2: Confirm tags
    const step2 = await handleTagConfirmation(env, TEST_USER_ID, 'yes');
    expect(step2.saved).toBe(true);
    expect(step2.messages[0]).toContain('✓ Note saved.');
  });

  it('completes tag confirmation flow with custom tags', async () => {
    const { env } = createTestEnv();

    await handleNoteCommand(env, TEST_USER_ID, 'had a conflict at work');
    const result = await handleTagConfirmation(env, TEST_USER_ID, 'mood, therapy');

    expect(result.saved).toBe(true);
    expect(result.messages[0]).toContain('#mood');
    expect(result.messages[0]).toContain('#therapy');
  });

  it('handles retry on unrecognized tag response then succeeds', async () => {
    const { env } = createTestEnv();

    await handleNoteCommand(env, TEST_USER_ID, 'therapy was helpful');

    // Unrecognized response
    const retry = await handleTagConfirmation(env, TEST_USER_ID, 'hmm not sure');
    expect(retry.saved).toBe(false);
    expect(retry.messages[0]).toContain('Available tags');

    // Now confirm
    const confirm = await handleTagConfirmation(env, TEST_USER_ID, 'yes');
    expect(confirm.saved).toBe(true);
  });
});
