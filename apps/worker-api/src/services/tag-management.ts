/**
 * Tag management service.
 *
 * Handles custom tag creation via `tags add <name>` and listing all
 * available tags (predefined + custom). Custom tags are stored in KV
 * for simplicity in MVP.
 *
 * Validates: FR-ADM-003 (Tags persist and appear in dashboard filters)
 * Validates: FR-CAP-007 (Custom tags can be created via command and reused)
 * Design: DD-008 (Configurable question packs — tags driven by JSON config)
 */

import { getTags } from '@symptom-tracker/shared';
import type { TagDefinition } from '@symptom-tracker/shared';

// ── Types ───────────────────────────────────────────────────────────

/** Bindings needed by the tag management service. */
export interface TagManagementEnv {
  KV: KVNamespace;
}

/** Result returned by tag management handlers. */
export interface TagManagementResult {
  /** Response message(s) to send back to the user. */
  messages: string[];
  /** Whether a tag was created. */
  created: boolean;
}

/** Custom tag stored in KV. */
export interface CustomTag {
  name: string;
  label: string;
  createdAt: string;
}

// ── Constants ───────────────────────────────────────────────────────

/** KV key for the custom tags list. */
const CUSTOM_TAGS_KEY = 'custom-tags';

/** Maximum length for a custom tag name. */
export const TAG_NAME_MAX_LENGTH = 30;

/** Regex for valid tag names: lowercase alphanumeric and hyphens. */
export const TAG_NAME_PATTERN = /^[a-z0-9-]+$/;

// ── Validation ──────────────────────────────────────────────────────

/**
 * Validate a tag name.
 *
 * Rules:
 * - Must be non-empty
 * - Must be lowercase alphanumeric (with hyphens allowed)
 * - Must not exceed TAG_NAME_MAX_LENGTH characters
 * - Must not conflict with an existing predefined tag
 *
 * Returns null if valid, or an error message string if invalid.
 */
export function validateTagName(name: string): string | null {
  const trimmed = name.trim().toLowerCase();

  if (trimmed.length === 0) {
    return 'Tag name cannot be empty.';
  }

  if (trimmed.length > TAG_NAME_MAX_LENGTH) {
    return `Tag name must be ${TAG_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (!TAG_NAME_PATTERN.test(trimmed)) {
    return 'Tag name must be lowercase letters, numbers, and hyphens only.';
  }

  // Check against predefined tags
  const predefined = getTags();
  if (predefined.some((t: TagDefinition) => t.name === trimmed)) {
    return `"${trimmed}" already exists as a predefined tag.`;
  }

  return null;
}

// ── KV helpers ──────────────────────────────────────────────────────

/** Get all custom tags from KV. */
export async function getCustomTags(kv: KVNamespace): Promise<CustomTag[]> {
  const raw = await kv.get(CUSTOM_TAGS_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as CustomTag[];
}

/** Save custom tags to KV. */
async function saveCustomTags(kv: KVNamespace, tags: CustomTag[]): Promise<void> {
  await kv.put(CUSTOM_TAGS_KEY, JSON.stringify(tags));
}

// ── Handlers ────────────────────────────────────────────────────────

/**
 * Handle the `tags add <name>` command.
 *
 * Validates the tag name, checks for duplicates among both predefined
 * and custom tags, and stores the new custom tag in KV.
 */
export async function handleTagsAdd(
  env: TagManagementEnv,
  tagName: string,
): Promise<TagManagementResult> {
  const normalized = tagName.trim().toLowerCase();

  // Validate tag name
  const error = validateTagName(normalized);
  if (error) {
    return { messages: [error], created: false };
  }

  // Check for duplicate among existing custom tags
  const customTags = await getCustomTags(env.KV);
  if (customTags.some((t) => t.name === normalized)) {
    return {
      messages: [`"${normalized}" already exists as a custom tag.`],
      created: false,
    };
  }

  // Create the new custom tag
  const newTag: CustomTag = {
    name: normalized,
    label: normalized.charAt(0).toUpperCase() + normalized.slice(1),
    createdAt: new Date().toISOString(),
  };

  customTags.push(newTag);
  await saveCustomTags(env.KV, customTags);

  return {
    messages: [`✓ Tag #${normalized} created.`],
    created: true,
  };
}

/**
 * Handle the `tags` command — list all available tags.
 *
 * Returns predefined tags and custom tags in a formatted message.
 */
export async function handleTagsList(
  env: TagManagementEnv,
): Promise<TagManagementResult> {
  const predefined = getTags();
  const custom = await getCustomTags(env.KV);

  const lines: string[] = [];

  // Predefined tags
  const predefinedNames = predefined.map((t: TagDefinition) => `#${t.name}`).join(' ');
  lines.push(`Built-in: ${predefinedNames}`);

  // Custom tags
  if (custom.length > 0) {
    const customNames = custom.map((t) => `#${t.name}`).join(' ');
    lines.push(`Custom: ${customNames}`);
  }

  lines.push('');
  lines.push('Add a custom tag: tags add <name>');

  return {
    messages: [lines.join('\n')],
    created: false,
  };
}
