/**
 * Shared configuration constants and types.
 *
 * Seed data (question packs, medication definitions, tags, schedules, feature flags)
 * will be loaded from JSON config files (Task 5). This module provides the type
 * contracts and any compile-time constants.
 */

/** Mounjaro dose options in mg. */
export const MOUNJARO_DOSES = [2.5, 5, 7.5, 10, 12.5, 15] as const;
export type MounjariDose = (typeof MOUNJARO_DOSES)[number];

/** Valid injection sites. */
export const INJECTION_SITES = [
  'abdomen',
  'thigh-L',
  'thigh-R',
  'arm-L',
  'arm-R',
] as const;
export type InjectionSite = (typeof INJECTION_SITES)[number];

/** Ordinal scale bounds used across all 0–5 measures. */
export const ORDINAL_MIN = 0;
export const ORDINAL_MAX = 5;

/** Maximum note body length in characters. */
export const NOTE_MAX_LENGTH = 4000;

/** KV session TTL for in-progress check-ins (4 hours in seconds). */
export const CHECKIN_SESSION_TTL_SECONDS = 4 * 60 * 60;

/** Signed R2 URL expiry for report downloads. */
export const SIGNED_URL_EXPIRY_SECONDS = 15 * 60;

/** Predefined note tags. */
export const DEFAULT_TAGS = [
  'meds',
  'work',
  'conflict',
  'sleep',
  'mood',
  'therapy',
  'injection',
] as const;
export type DefaultTag = (typeof DEFAULT_TAGS)[number];
