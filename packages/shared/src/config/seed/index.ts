/**
 * Seed configuration loaders.
 *
 * Provides typed access to the JSON seed config files that drive
 * symptom questions, medication definitions, tags, schedules, and
 * feature flags (DD-008: configurable question packs).
 *
 * All loaders return fresh copies so callers cannot mutate the
 * canonical seed data.
 */

export type {
  QuestionType,
  QuestionDefinition,
  MedicationRouteSeed,
  MedicationDefinitionSeed,
  TagDefinition,
  PromptSchedule,
  FeatureFlag,
  SeedConfig,
} from './types.js';

import type {
  QuestionDefinition,
  MedicationDefinitionSeed,
  TagDefinition,
  PromptSchedule,
  FeatureFlag,
  SeedConfig,
} from './types.js';

import questionsData from './questions.json';
import medicationsData from './medications.json';
import tagsData from './tags.json';
import schedulesData from './schedules.json';
import featureFlagsData from './feature-flags.json';

// Cast the imported JSON to their typed forms.
const questions: QuestionDefinition[] = questionsData as QuestionDefinition[];
const medications: MedicationDefinitionSeed[] = medicationsData as MedicationDefinitionSeed[];
const tags: TagDefinition[] = tagsData as TagDefinition[];
const schedules: PromptSchedule[] = schedulesData as PromptSchedule[];
const featureFlags: FeatureFlag[] = featureFlagsData as FeatureFlag[];

/** Return all symptom check-in questions, ordered by `order` field. */
export function getQuestions(): QuestionDefinition[] {
  return [...questions].sort((a, b) => a.order - b.order);
}

/** Return only enabled questions, ordered by `order` field. */
export function getEnabledQuestions(): QuestionDefinition[] {
  return getQuestions().filter((q) => q.enabled);
}

/** Look up a question by its variable code (e.g. "DAT-001"). */
export function getQuestionByCode(code: string): QuestionDefinition | undefined {
  return questions.find((q) => q.variable_code === code);
}

/** Return all medication definitions. */
export function getMedications(): MedicationDefinitionSeed[] {
  return [...medications];
}

/** Return only active medication definitions. */
export function getActiveMedications(): MedicationDefinitionSeed[] {
  return medications.filter((m) => m.active);
}

/** Look up a medication by its code (e.g. "mounjaro"). */
export function getMedicationByCode(code: string): MedicationDefinitionSeed | undefined {
  return medications.find((m) => m.code === code);
}

/** Return all predefined tags. */
export function getTags(): TagDefinition[] {
  return [...tags];
}

/** Return only built-in (non-deletable) tags. */
export function getBuiltinTags(): TagDefinition[] {
  return tags.filter((t) => t.builtin);
}

/** Return all prompt schedules. */
export function getSchedules(): PromptSchedule[] {
  return [...schedules];
}

/** Return only enabled prompt schedules. */
export function getEnabledSchedules(): PromptSchedule[] {
  return schedules.filter((s) => s.enabled);
}

/** Return all feature flags. */
export function getFeatureFlags(): FeatureFlag[] {
  return [...featureFlags];
}

/** Check if a feature flag is enabled by default. */
export function isFeatureEnabled(key: string): boolean {
  const flag = featureFlags.find((f) => f.key === key);
  return flag?.default_enabled ?? false;
}

/** Return the complete seed configuration. */
export function getSeedConfig(): SeedConfig {
  return {
    questions: getQuestions(),
    medications: getMedications(),
    tags: getTags(),
    schedules: getSchedules(),
    feature_flags: getFeatureFlags(),
  };
}
