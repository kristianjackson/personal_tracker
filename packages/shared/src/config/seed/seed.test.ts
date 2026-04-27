import { describe, it, expect } from 'vitest';
import {
  getQuestions,
  getEnabledQuestions,
  getQuestionByCode,
  getMedications,
  getActiveMedications,
  getMedicationByCode,
  getTags,
  getBuiltinTags,
  getSchedules,
  getEnabledSchedules,
  getFeatureFlags,
  isFeatureEnabled,
  getSeedConfig,
} from './index.js';
import { MOUNJARO_DOSES, DEFAULT_TAGS, ORDINAL_MIN, ORDINAL_MAX } from '../index.js';

describe('Seed config: questions', () => {
  const questions = getQuestions();

  it('contains all 15 questions (DAT-001 through DAT-013 + side effects + note)', () => {
    expect(questions.length).toBe(15);
  });

  it('has unique variable codes', () => {
    const codes = questions.map((q) => q.variable_code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has unique order indices', () => {
    const orders = questions.map((q) => q.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('returns questions sorted by order', () => {
    for (let i = 1; i < questions.length; i++) {
      expect(questions[i].order).toBeGreaterThan(questions[i - 1].order);
    }
  });

  it('starts with sleep hours (DAT-001) as the first question', () => {
    expect(questions[0].variable_code).toBe('DAT-001');
    expect(questions[0].type).toBe('numeric');
    expect(questions[0].unit).toBe('hours');
  });

  it('has DAT-013 (meds taken) as structured type', () => {
    const medsQ = getQuestionByCode('DAT-013');
    expect(medsQ).toBeDefined();
    expect(medsQ!.type).toBe('structured');
  });

  it('has DAT-014 (side effects) and DAT-015 (note) as optional text', () => {
    const sideEffects = questions.find((q) => q.variable_code === 'DAT-014');
    const note = questions.find((q) => q.variable_code === 'DAT-015');
    expect(sideEffects).toBeDefined();
    expect(sideEffects!.type).toBe('text');
    expect(sideEffects!.optional).toBe(true);
    expect(note).toBeDefined();
    expect(note!.type).toBe('text');
    expect(note!.optional).toBe(true);
  });

  it('all ordinal questions use 0–5 scale', () => {
    const ordinals = questions.filter((q) => q.type === 'ordinal');
    expect(ordinals.length).toBeGreaterThan(0);
    for (const q of ordinals) {
      expect(q.scale).not.toBeNull();
      expect(q.scale!.min).toBe(ORDINAL_MIN);
      expect(q.scale!.max).toBe(ORDINAL_MAX);
    }
  });

  it('follows the exact design section 6.3 order', () => {
    const expectedOrder = [
      'DAT-001', // sleep hours
      'DAT-002', // sleep quality
      'DAT-003', // mood
      'DAT-004', // energy
      'DAT-005', // irritability
      'DAT-006', // anxiety
      'DAT-007', // focus
      'DAT-008', // racing thoughts
      'DAT-009', // impulsivity
      'DAT-010', // risk-drive
      'DAT-011', // conflict
      'DAT-012', // appetite
      'DAT-013', // meds taken
      'DAT-014', // side effects
      'DAT-015', // note
    ];
    const actualOrder = questions.map((q) => q.variable_code);
    expect(actualOrder).toEqual(expectedOrder);
  });

  it('getEnabledQuestions returns only enabled questions', () => {
    const enabled = getEnabledQuestions();
    expect(enabled.every((q) => q.enabled)).toBe(true);
    // By default all are enabled
    expect(enabled.length).toBe(questions.length);
  });

  it('getQuestionByCode returns correct question', () => {
    const q = getQuestionByCode('DAT-003');
    expect(q).toBeDefined();
    expect(q!.variable_code).toBe('DAT-003');
    expect(q!.prompt).toContain('Mood');
  });

  it('getQuestionByCode returns undefined for unknown code', () => {
    expect(getQuestionByCode('DAT-999')).toBeUndefined();
  });

  it('every question has a non-empty prompt', () => {
    for (const q of questions) {
      expect(q.prompt.length).toBeGreaterThan(0);
    }
  });

  it('every question has a valid type', () => {
    const validTypes = ['numeric', 'ordinal', 'structured', 'text'];
    for (const q of questions) {
      expect(validTypes).toContain(q.type);
    }
  });
});

describe('Seed config: medications', () => {
  const meds = getMedications();

  it('contains at least 5 medications', () => {
    expect(meds.length).toBeGreaterThanOrEqual(5);
  });

  it('has unique codes', () => {
    const codes = meds.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('includes Mounjaro with correct dose enum', () => {
    const mounjaro = getMedicationByCode('mounjaro');
    expect(mounjaro).toBeDefined();
    expect(mounjaro!.route).toBe('injection');
    expect(mounjaro!.dose_options).toEqual([...MOUNJARO_DOSES]);
    expect(mounjaro!.default_dose_unit).toBe('mg');
  });

  it('includes oral medications (glipizide, metformin, abilify, trileptal)', () => {
    for (const code of ['glipizide', 'metformin', 'abilify', 'trileptal']) {
      const med = getMedicationByCode(code);
      expect(med).toBeDefined();
      expect(med!.route).toBe('oral');
    }
  });

  it('getActiveMedications returns only active meds', () => {
    const active = getActiveMedications();
    expect(active.every((m) => m.active)).toBe(true);
  });

  it('getMedicationByCode returns undefined for unknown code', () => {
    expect(getMedicationByCode('unknown-med')).toBeUndefined();
  });

  it('every medication has a non-empty display_name', () => {
    for (const m of meds) {
      expect(m.display_name.length).toBeGreaterThan(0);
    }
  });

  it('every medication has a valid route', () => {
    for (const m of meds) {
      expect(['oral', 'injection']).toContain(m.route);
    }
  });
});

describe('Seed config: tags', () => {
  const tags = getTags();

  it('contains all default tags', () => {
    const tagNames = tags.map((t) => t.name);
    for (const dt of DEFAULT_TAGS) {
      expect(tagNames).toContain(dt);
    }
  });

  it('has unique tag names', () => {
    const names = tags.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all default tags are marked as builtin', () => {
    const builtins = getBuiltinTags();
    expect(builtins.length).toBe(DEFAULT_TAGS.length);
    for (const t of builtins) {
      expect(t.builtin).toBe(true);
    }
  });

  it('every tag has a non-empty label', () => {
    for (const t of tags) {
      expect(t.label.length).toBeGreaterThan(0);
    }
  });
});

describe('Seed config: schedules', () => {
  const schedules = getSchedules();

  it('contains daily check-in and weekly summary schedules', () => {
    const ids = schedules.map((s) => s.id);
    expect(ids).toContain('daily-checkin');
    expect(ids).toContain('weekly-summary');
  });

  it('daily schedule has no day_of_week', () => {
    const daily = schedules.find((s) => s.id === 'daily-checkin');
    expect(daily).toBeDefined();
    expect(daily!.type).toBe('daily');
    expect(daily!.day_of_week).toBeNull();
  });

  it('weekly schedule has a valid day_of_week (0–6)', () => {
    const weekly = schedules.find((s) => s.id === 'weekly-summary');
    expect(weekly).toBeDefined();
    expect(weekly!.type).toBe('weekly');
    expect(weekly!.day_of_week).toBeGreaterThanOrEqual(0);
    expect(weekly!.day_of_week).toBeLessThanOrEqual(6);
  });

  it('all schedules have valid HH:MM time format', () => {
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const s of schedules) {
      expect(s.default_time).toMatch(timeRegex);
    }
  });

  it('getEnabledSchedules returns only enabled schedules', () => {
    const enabled = getEnabledSchedules();
    expect(enabled.every((s) => s.enabled)).toBe(true);
  });
});

describe('Seed config: feature flags', () => {
  const flags = getFeatureFlags();

  it('contains at least 4 feature flags', () => {
    expect(flags.length).toBeGreaterThanOrEqual(4);
  });

  it('has unique keys', () => {
    const keys = flags.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('LLM summary is off by default (DD-006)', () => {
    expect(isFeatureEnabled('llm_summary')).toBe(false);
  });

  it('weekly mania screener is off by default (FR-INST-004)', () => {
    expect(isFeatureEnabled('weekly_mania_screener')).toBe(false);
  });

  it('isFeatureEnabled returns false for unknown keys', () => {
    expect(isFeatureEnabled('nonexistent_flag')).toBe(false);
  });

  it('every flag has a non-empty description', () => {
    for (const f of flags) {
      expect(f.description.length).toBeGreaterThan(0);
    }
  });
});

describe('Seed config: getSeedConfig', () => {
  it('returns a complete config object with all sections', () => {
    const config = getSeedConfig();
    expect(config.questions.length).toBeGreaterThan(0);
    expect(config.medications.length).toBeGreaterThan(0);
    expect(config.tags.length).toBeGreaterThan(0);
    expect(config.schedules.length).toBeGreaterThan(0);
    expect(config.feature_flags.length).toBeGreaterThan(0);
  });
});

describe('Seed config: immutability', () => {
  it('getQuestions returns a fresh copy each call', () => {
    const a = getQuestions();
    const b = getQuestions();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('getMedications returns a fresh copy each call', () => {
    const a = getMedications();
    const b = getMedications();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('getTags returns a fresh copy each call', () => {
    const a = getTags();
    const b = getTags();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
