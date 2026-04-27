/**
 * TypeScript types for seed configuration data.
 *
 * These types define the shape of the JSON config files that drive
 * symptom questions, medication definitions, tags, schedules, and
 * feature flags (DD-008: configurable question packs).
 */

// --- Symptom Questions ---

/** The response type expected for a check-in question. */
export type QuestionType = 'numeric' | 'ordinal' | 'structured' | 'text';

/** A single daily check-in question definition. */
export interface QuestionDefinition {
  /** Unique variable code, e.g. "DAT-001". */
  variable_code: string;
  /** Prompt text shown to the user via WhatsApp. */
  prompt: string;
  /** Response type. */
  type: QuestionType;
  /** Scale info for ordinal questions (null for non-ordinal). */
  scale: { min: number; max: number; labels: { min: string; max: string } } | null;
  /** Unit for numeric questions (e.g. "hours"), null otherwise. */
  unit: string | null;
  /** Display order index (0-based). */
  order: number;
  /** Whether this question is active in the current config. */
  enabled: boolean;
  /** Whether the question can be skipped. */
  optional: boolean;
}

// --- Medication Definitions ---

/** Route of administration. */
export type MedicationRouteSeed = 'oral' | 'injection';

/** A medication definition in the seed config. */
export interface MedicationDefinitionSeed {
  /** Short code, e.g. "mounjaro", "abilify". */
  code: string;
  /** Human-readable name. */
  display_name: string;
  /** Route of administration. */
  route: MedicationRouteSeed;
  /** Allowed dose values (for injection meds with an enum). */
  dose_options: number[] | null;
  /** Default dose value (nullable). */
  default_dose_value: number | null;
  /** Default dose unit, e.g. "mg". */
  default_dose_unit: string | null;
  /** Whether this medication is active by default. */
  active: boolean;
}

// --- Tags ---

/** A predefined tag definition. */
export interface TagDefinition {
  /** Tag identifier string. */
  name: string;
  /** Human-readable label. */
  label: string;
  /** Whether this is a built-in (non-deletable) tag. */
  builtin: boolean;
}

// --- Prompt Schedules ---

/** A scheduled prompt definition. */
export interface PromptSchedule {
  /** Unique schedule identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Schedule type. */
  type: 'daily' | 'weekly';
  /** Default local time in HH:MM 24h format. */
  default_time: string;
  /** Day of week for weekly schedules (0=Sunday, 1=Monday, ..., 6=Saturday). Null for daily. */
  day_of_week: number | null;
  /** Whether this schedule is enabled by default. */
  enabled: boolean;
}

// --- Feature Flags ---

/** A feature flag definition. */
export interface FeatureFlag {
  /** Unique flag key. */
  key: string;
  /** Human-readable description. */
  description: string;
  /** Default value (on/off). */
  default_enabled: boolean;
}

// --- Root config shape ---

/** Complete seed configuration. */
export interface SeedConfig {
  questions: QuestionDefinition[];
  medications: MedicationDefinitionSeed[];
  tags: TagDefinition[];
  schedules: PromptSchedule[];
  feature_flags: FeatureFlag[];
}
