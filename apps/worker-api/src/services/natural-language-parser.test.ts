/**
 * Tests for the natural-language parser service.
 *
 * Validates: FR-WA-009 (Parser maps common phrases to structured values)
 * Design: Section 6.5 (Natural-language parser patterns)
 */

import { describe, it, expect } from 'vitest';
import {
  parseSkip,
  parseNaturalNumber,
  parseMedicationMention,
  parseNaturalStructured,
  parseNaturalLanguage,
} from './natural-language-parser';
import type {
  NumericParseResult,
  SkipParseResult,
  MedicationParseResult,
  NLParseResult,
} from './natural-language-parser';
import type { MedicationDefinitionSeed } from '@symptom-tracker/shared';

// ── Test medication fixtures ────────────────────────────────────────

const testMedications: MedicationDefinitionSeed[] = [
  {
    code: 'seroquel',
    display_name: 'Seroquel (quetiapine)',
    route: 'oral',
    dose_options: null,
    default_dose_value: null,
    default_dose_unit: 'mg',
    active: true,
  },
  {
    code: 'lithium',
    display_name: 'Lithium',
    route: 'oral',
    dose_options: null,
    default_dose_value: null,
    default_dose_unit: 'mg',
    active: true,
  },
  {
    code: 'lamotrigine',
    display_name: 'Lamotrigine (Lamictal)',
    route: 'oral',
    dose_options: null,
    default_dose_value: null,
    default_dose_unit: 'mg',
    active: true,
  },
  {
    code: 'mounjaro',
    display_name: 'Mounjaro (tirzepatide)',
    route: 'injection',
    dose_options: [2.5, 5, 7.5, 10, 12.5, 15],
    default_dose_value: 2.5,
    default_dose_unit: 'mg',
    active: true,
  },
];

// ── parseSkip ───────────────────────────────────────────────────────

describe('parseSkip', () => {
  it.each(['skip', 'Skip', 'SKIP', 's', 'S', 'next', 'Next', 'NEXT'])(
    'recognizes "%s" as a skip command',
    (input) => {
      const result = parseSkip(input);
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('skip');
      expect(result!.confidence).toBe('high');
    },
  );

  it.each(['pass', 'na', 'n/a', '-'])(
    'recognizes extended skip token "%s"',
    (input) => {
      const result = parseSkip(input);
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('skip');
    },
  );

  it('handles whitespace around skip tokens', () => {
    expect(parseSkip('  skip  ')).not.toBeNull();
    expect(parseSkip(' s ')).not.toBeNull();
  });

  it.each(['4', 'yes', 'skipping', '', 'mood 4', 'slept 7'])(
    'returns null for non-skip text "%s"',
    (input) => {
      expect(parseSkip(input)).toBeNull();
    },
  );
});

// ── parseNaturalNumber ──────────────────────────────────────────────

describe('parseNaturalNumber', () => {
  describe('direct numbers (high confidence)', () => {
    it.each([
      ['7', 7],
      ['6.5', 6.5],
      ['0', 0],
      ['12', 12],
      ['3.0', 3.0],
    ])('parses "%s" as %d', (input, expected) => {
      const result = parseNaturalNumber(input);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(expected);
      expect(result!.confidence).toBe('high');
    });
  });

  describe('fraction format (high confidence)', () => {
    it.each([
      ['4/5', 4],
      ['3/5', 3],
      ['0/5', 0],
      ['5/5', 5],
      ['2 / 5', 2],
    ])('parses "%s" as %d', (input, expected) => {
      const result = parseNaturalNumber(input);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(expected);
      expect(result!.confidence).toBe('high');
    });
  });

  describe('keyword + number patterns (medium confidence)', () => {
    it.each([
      ['slept 4 hours', 4],
      ['slept 7.5 hours', 7.5],
      ['sleep 8', 8],
      ['mood 4', 4],
      ['energy 3', 3],
      ['focus 2', 2],
      ['anxiety 1', 1],
      ['about 6 hours', 6],
      ['around 7', 7],
      ['roughly 5', 5],
      ['maybe 3', 3],
      ['like 4', 4],
      ['appetite 2', 2],
      ['irritability 3', 3],
    ])('parses "%s" as %d', (input, expected) => {
      const result = parseNaturalNumber(input);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(expected);
      expect(result!.confidence).toBe('medium');
    });
  });

  describe('number + keyword patterns (medium confidence)', () => {
    it.each([
      ['4 hours', 4],
      ['7.5 hrs', 7.5],
      ['6 h', 6],
      ['8 hours', 8],
    ])('parses "%s" as %d', (input, expected) => {
      const result = parseNaturalNumber(input);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(expected);
      expect(result!.confidence).toBe('medium');
    });
  });

  describe('conversational text with single number (low confidence)', () => {
    it.each([
      ["I'd say about a 3", 3],
      ['not great, probably 1', 1],
      ['really bad, 5', 5],
    ])('parses "%s" as %d with low confidence', (input, expected) => {
      const result = parseNaturalNumber(input);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(expected);
      expect(result!.confidence).toBe('low');
    });

    it('parses "pretty elevated maybe 4" via keyword match (medium confidence)', () => {
      // "maybe" is a recognized keyword, so this gets medium confidence
      const result = parseNaturalNumber('pretty elevated maybe 4');
      expect(result).not.toBeNull();
      expect(result!.value).toBe(4);
      expect(result!.confidence).toBe('medium');
    });

    it('parses "feeling like a 2 today" via single-number fallback (low confidence)', () => {
      // "like a 2" has a word between keyword and number, so falls to single-number extraction
      const result = parseNaturalNumber('feeling like a 2 today');
      expect(result).not.toBeNull();
      expect(result!.value).toBe(2);
      expect(result!.confidence).toBe('low');
    });
  });

  describe('range validation', () => {
    it('rejects values below min', () => {
      expect(parseNaturalNumber('2', 3, 5)).toBeNull();
    });

    it('rejects values above max', () => {
      expect(parseNaturalNumber('6', 0, 5)).toBeNull();
    });

    it('accepts values within range', () => {
      const result = parseNaturalNumber('3', 0, 5);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(3);
    });

    it('accepts boundary values', () => {
      expect(parseNaturalNumber('0', 0, 5)).not.toBeNull();
      expect(parseNaturalNumber('5', 0, 5)).not.toBeNull();
    });

    it('applies range to conversational text', () => {
      expect(parseNaturalNumber('pretty elevated maybe 7', 0, 5)).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(parseNaturalNumber('')).toBeNull();
    });

    it('returns null for whitespace only', () => {
      expect(parseNaturalNumber('   ')).toBeNull();
    });

    it('returns null for text with no numbers', () => {
      expect(parseNaturalNumber('great')).toBeNull();
      expect(parseNaturalNumber('terrible')).toBeNull();
    });

    it('returns null for text with multiple ambiguous numbers', () => {
      // "between 3 and 4" has two numbers — ambiguous
      expect(parseNaturalNumber('between 3 and 4')).toBeNull();
    });

    it('extracts the digit from "-3" (negative sign ignored)', () => {
      // "-3" doesn't match the direct number pattern (negative),
      // but the single-number fallback extracts "3"
      const result = parseNaturalNumber('-3');
      expect(result).not.toBeNull();
      expect(result!.value).toBe(3);
      expect(result!.confidence).toBe('low');
    });
  });
});

// ── parseMedicationMention ──────────────────────────────────────────

describe('parseMedicationMention', () => {
  it('detects medication code in "missed seroquel"', () => {
    const result = parseMedicationMention('missed seroquel', testMedications);
    expect(result).not.toBeNull();
    expect(result!.medicationCode).toBe('seroquel');
    expect(result!.confidence).toBe('high');
  });

  it('detects medication code in "forgot my lithium"', () => {
    const result = parseMedicationMention('forgot my lithium', testMedications);
    expect(result).not.toBeNull();
    expect(result!.medicationCode).toBe('lithium');
    expect(result!.confidence).toBe('high');
  });

  it("detects medication code in \"didn't take lamotrigine\"", () => {
    const result = parseMedicationMention("didn't take lamotrigine", testMedications);
    expect(result).not.toBeNull();
    expect(result!.medicationCode).toBe('lamotrigine');
    expect(result!.confidence).toBe('high');
  });

  it('detects generic name "quetiapine" for seroquel', () => {
    const result = parseMedicationMention('missed quetiapine', testMedications);
    expect(result).not.toBeNull();
    expect(result!.medicationCode).toBe('seroquel');
    expect(result!.confidence).toBe('high');
  });

  it('detects generic name "tirzepatide" for mounjaro', () => {
    const result = parseMedicationMention('took tirzepatide', testMedications);
    expect(result).not.toBeNull();
    expect(result!.medicationCode).toBe('mounjaro');
    expect(result!.confidence).toBe('high');
  });

  it('detects brand name "Lamictal" for lamotrigine', () => {
    const result = parseMedicationMention('skipped Lamictal today', testMedications);
    expect(result).not.toBeNull();
    expect(result!.medicationCode).toBe('lamotrigine');
    expect(result!.confidence).toBe('high');
  });

  it('is case-insensitive', () => {
    const result = parseMedicationMention('MISSED SEROQUEL', testMedications);
    expect(result).not.toBeNull();
    expect(result!.medicationCode).toBe('seroquel');
  });

  it('returns null for text without medication names', () => {
    expect(parseMedicationMention('feeling good today', testMedications)).toBeNull();
    expect(parseMedicationMention('slept 7 hours', testMedications)).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(parseMedicationMention('', testMedications)).toBeNull();
  });

  it('returns the first matching medication', () => {
    // If text mentions multiple meds, returns the first match
    const result = parseMedicationMention('missed seroquel and lithium', testMedications);
    expect(result).not.toBeNull();
    expect(result!.medicationCode).toBe('seroquel');
  });
});

// ── parseNaturalStructured ──────────────────────────────────────────

describe('parseNaturalStructured', () => {
  describe('affirmative answers → 1', () => {
    it.each(['yes', 'y', 'yeah', 'yep', 'yup', 'took them', 'all good', 'all taken'])(
      'parses "%s" as 1',
      (input) => {
        const result = parseNaturalStructured(input);
        expect(result).not.toBeNull();
        expect(result!.value).toBe(1);
      },
    );
  });

  describe('negative answers → 0', () => {
    it.each(['no', 'n', 'nope', 'nah', 'none', "didn't take", 'forgot', 'forgot them'])(
      'parses "%s" as 0',
      (input) => {
        const result = parseNaturalStructured(input);
        expect(result).not.toBeNull();
        expect(result!.value).toBe(0);
      },
    );
  });

  describe('partial answers → 0.5', () => {
    it.each(['partial', 'p', 'some', 'most', 'most of them', 'partially'])(
      'parses "%s" as 0.5',
      (input) => {
        const result = parseNaturalStructured(input);
        expect(result).not.toBeNull();
        expect(result!.value).toBe(0.5);
      },
    );
  });

  it('is case-insensitive', () => {
    expect(parseNaturalStructured('YEAH')?.value).toBe(1);
    expect(parseNaturalStructured('Nope')?.value).toBe(0);
    expect(parseNaturalStructured('PARTIAL')?.value).toBe(0.5);
  });

  it('returns null for unrecognized input', () => {
    expect(parseNaturalStructured('maybe')).toBeNull();
    expect(parseNaturalStructured('3')).toBeNull();
    expect(parseNaturalStructured('')).toBeNull();
  });
});

// ── parseNaturalLanguage (combined) ─────────────────────────────────

describe('parseNaturalLanguage', () => {
  it('detects skip commands first', () => {
    const result = parseNaturalLanguage('skip');
    expect(result.kind).toBe('skip');
  });

  it('detects medication mentions', () => {
    const result = parseNaturalLanguage('missed seroquel');
    expect(result.kind).toBe('medication');
    if (result.kind === 'medication') {
      expect(result.medicationCode).toBe('seroquel');
    }
  });

  it('extracts numbers from conversational text', () => {
    const result = parseNaturalLanguage('slept 4 hours');
    expect(result.kind).toBe('numeric');
    if (result.kind === 'numeric') {
      expect(result.value).toBe(4);
    }
  });

  it('applies range constraints', () => {
    const result = parseNaturalLanguage('maybe 7', { min: 0, max: 5 });
    expect(result.kind).toBe('unknown');
  });

  it('returns unknown for unrecognizable text', () => {
    const result = parseNaturalLanguage('feeling great today');
    expect(result.kind).toBe('unknown');
  });

  it('prioritizes skip over medication mention', () => {
    // "skip" is a skip command, not a medication search
    const result = parseNaturalLanguage('skip');
    expect(result.kind).toBe('skip');
  });

  it('prioritizes medication over number extraction', () => {
    // "missed seroquel" should detect medication, not extract a number
    const result = parseNaturalLanguage('missed seroquel');
    expect(result.kind).toBe('medication');
  });
});
