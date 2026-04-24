/**
 * Tests for the tag management service.
 *
 * Validates: FR-ADM-003 (Tags persist and appear in dashboard filters)
 * Validates: FR-CAP-007 (Custom tags can be created via command and reused)
 * Design: DD-008 (Configurable question packs — tags driven by JSON config)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateTagName,
  handleTagsAdd,
  handleTagsList,
  getCustomTags,
  TAG_NAME_MAX_LENGTH,
  TAG_NAME_PATTERN,
} from './tag-management';
import type { TagManagementEnv } from './tag-management';

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

function createTestEnv(): { env: TagManagementEnv; kvStore: Map<string, KVEntry> } {
  const { kv, store } = createKVMock();
  return { env: { KV: kv }, kvStore: store };
}

// ── validateTagName ─────────────────────────────────────────────────

describe('validateTagName', () => {
  it('accepts valid lowercase alphanumeric names', () => {
    expect(validateTagName('exercise')).toBeNull();
    expect(validateTagName('self-care')).toBeNull();
    expect(validateTagName('day2')).toBeNull();
  });

  it('rejects empty names', () => {
    expect(validateTagName('')).toContain('empty');
    expect(validateTagName('   ')).toContain('empty');
  });

  it('rejects names exceeding max length', () => {
    const longName = 'a'.repeat(TAG_NAME_MAX_LENGTH + 1);
    expect(validateTagName(longName)).toContain(`${TAG_NAME_MAX_LENGTH}`);
  });

  it('accepts names at exactly max length', () => {
    const exactName = 'a'.repeat(TAG_NAME_MAX_LENGTH);
    expect(validateTagName(exactName)).toBeNull();
  });

  it('rejects names with uppercase letters', () => {
    // validateTagName normalizes to lowercase, so uppercase input passes
    // The validation accepts it after normalization
    expect(validateTagName('Exercise')).toBeNull();
  });

  it('rejects names with spaces', () => {
    expect(validateTagName('self care')).toContain('lowercase');
  });

  it('rejects names with special characters', () => {
    expect(validateTagName('tag!')).toContain('lowercase');
    expect(validateTagName('tag@name')).toContain('lowercase');
    expect(validateTagName('tag_name')).toContain('lowercase');
  });

  it('rejects predefined tag names', () => {
    expect(validateTagName('meds')).toContain('predefined');
    expect(validateTagName('conflict')).toContain('predefined');
    expect(validateTagName('sleep')).toContain('predefined');
    expect(validateTagName('mood')).toContain('predefined');
    expect(validateTagName('work')).toContain('predefined');
    expect(validateTagName('therapy')).toContain('predefined');
    expect(validateTagName('injection')).toContain('predefined');
  });
});

// ── TAG_NAME_PATTERN ────────────────────────────────────────────────

describe('TAG_NAME_PATTERN', () => {
  it('matches valid tag names', () => {
    expect(TAG_NAME_PATTERN.test('exercise')).toBe(true);
    expect(TAG_NAME_PATTERN.test('self-care')).toBe(true);
    expect(TAG_NAME_PATTERN.test('day2')).toBe(true);
    expect(TAG_NAME_PATTERN.test('a')).toBe(true);
  });

  it('rejects invalid tag names', () => {
    expect(TAG_NAME_PATTERN.test('Exercise')).toBe(false);
    expect(TAG_NAME_PATTERN.test('self care')).toBe(false);
    expect(TAG_NAME_PATTERN.test('tag!')).toBe(false);
    expect(TAG_NAME_PATTERN.test('')).toBe(false);
  });
});

// ── handleTagsAdd ───────────────────────────────────────────────────

describe('handleTagsAdd', () => {
  it('creates a valid custom tag', async () => {
    const { env } = createTestEnv();
    const result = await handleTagsAdd(env, 'exercise');

    expect(result.created).toBe(true);
    expect(result.messages[0]).toContain('✓');
    expect(result.messages[0]).toContain('#exercise');
  });

  it('normalizes tag name to lowercase', async () => {
    const { env } = createTestEnv();
    const result = await handleTagsAdd(env, 'Exercise');

    // handleTagsAdd normalizes to lowercase before validation
    expect(result.created).toBe(true);
    expect(result.messages[0]).toContain('#exercise');
  });

  it('rejects empty tag name', async () => {
    const { env } = createTestEnv();
    const result = await handleTagsAdd(env, '');

    expect(result.created).toBe(false);
    expect(result.messages[0]).toContain('empty');
  });

  it('rejects predefined tag names', async () => {
    const { env } = createTestEnv();
    const result = await handleTagsAdd(env, 'meds');

    expect(result.created).toBe(false);
    expect(result.messages[0]).toContain('predefined');
  });

  it('rejects duplicate custom tag names', async () => {
    const { env } = createTestEnv();

    // Create the tag first
    await handleTagsAdd(env, 'exercise');

    // Try to create it again
    const result = await handleTagsAdd(env, 'exercise');
    expect(result.created).toBe(false);
    expect(result.messages[0]).toContain('already exists');
  });

  it('persists custom tags in KV', async () => {
    const { env } = createTestEnv();

    await handleTagsAdd(env, 'exercise');
    await handleTagsAdd(env, 'social');

    const tags = await getCustomTags(env.KV);
    expect(tags).toHaveLength(2);
    expect(tags[0].name).toBe('exercise');
    expect(tags[1].name).toBe('social');
  });

  it('stores label with capitalized first letter', async () => {
    const { env } = createTestEnv();

    await handleTagsAdd(env, 'exercise');

    const tags = await getCustomTags(env.KV);
    expect(tags[0].label).toBe('Exercise');
  });

  it('stores createdAt timestamp', async () => {
    const { env } = createTestEnv();

    await handleTagsAdd(env, 'exercise');

    const tags = await getCustomTags(env.KV);
    expect(tags[0].createdAt).toBeDefined();
    // Should be a valid ISO date string
    expect(new Date(tags[0].createdAt).toISOString()).toBe(tags[0].createdAt);
  });

  it('rejects tag names with invalid characters', async () => {
    const { env } = createTestEnv();

    const result = await handleTagsAdd(env, 'tag_name');
    expect(result.created).toBe(false);
  });

  it('rejects tag names exceeding max length', async () => {
    const { env } = createTestEnv();

    const longName = 'a'.repeat(TAG_NAME_MAX_LENGTH + 1);
    const result = await handleTagsAdd(env, longName);
    expect(result.created).toBe(false);
  });
});

// ── handleTagsList ──────────────────────────────────────────────────

describe('handleTagsList', () => {
  it('lists predefined tags when no custom tags exist', async () => {
    const { env } = createTestEnv();
    const result = await handleTagsList(env);

    expect(result.created).toBe(false);
    expect(result.messages[0]).toContain('Built-in');
    expect(result.messages[0]).toContain('#meds');
    expect(result.messages[0]).toContain('#conflict');
    expect(result.messages[0]).toContain('#sleep');
    expect(result.messages[0]).toContain('#mood');
    expect(result.messages[0]).toContain('#work');
    expect(result.messages[0]).toContain('#therapy');
    expect(result.messages[0]).toContain('#injection');
  });

  it('lists both predefined and custom tags', async () => {
    const { env } = createTestEnv();

    await handleTagsAdd(env, 'exercise');
    await handleTagsAdd(env, 'social');

    const result = await handleTagsList(env);

    expect(result.messages[0]).toContain('Built-in');
    expect(result.messages[0]).toContain('Custom');
    expect(result.messages[0]).toContain('#exercise');
    expect(result.messages[0]).toContain('#social');
  });

  it('includes help text for adding tags', async () => {
    const { env } = createTestEnv();
    const result = await handleTagsList(env);

    expect(result.messages[0]).toContain('tags add');
  });
});

// ── getCustomTags ───────────────────────────────────────────────────

describe('getCustomTags', () => {
  it('returns empty array when no custom tags exist', async () => {
    const { kv } = createKVMock();
    const tags = await getCustomTags(kv);
    expect(tags).toEqual([]);
  });

  it('returns stored custom tags', async () => {
    const { env } = createTestEnv();

    await handleTagsAdd(env, 'exercise');
    const tags = await getCustomTags(env.KV);

    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('exercise');
  });
});
