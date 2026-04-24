/**
 * Natural-language parser for common WhatsApp reply patterns.
 *
 * Provides a convenience layer that extracts structured values from
 * conversational text. Used as a fallback when strict numeric/ordinal
 * parsing fails during check-in flows.
 *
 * Validates: FR-WA-009 (Parser maps common phrases to structured values)
 * Design: Section 6.5 (Natural-language parser patterns)
 */

import { getActiveMedications } from '@symptom-tracker/shared';
import type { MedicationDefinitionSeed } from '@symptom-tracker/shared';

// ── Types ───────────────────────────────────────────────────────────

/** Confidence level for a parsed result. */
export type ParseConfidence = 'high' | 'medium' | 'low';

/** Result of parsing a natural-language reply for a numeric value. */
export interface NumericParseResult {
  kind: 'numeric';
  value: number;
  confidence: ParseConfidence;
}

/** Result when the user wants to skip the current question. */
export interface SkipParseResult {
  kind: 'skip';
  confidence: ParseConfidence;
}

/** Result when a medication name is detected in the text. */
export interface MedicationParseResult {
  kind: 'medication';
  medicationCode: string;
  medicationName: string;
  confidence: ParseConfidence;
}

/** Result when the parser cannot extract a meaningful value. */
export interface UnknownParseResult {
  kind: 'unknown';
}

/** Union of all parse result types. */
export type NLParseResult =
  | NumericParseResult
  | SkipParseResult
  | MedicationParseResult
  | UnknownParseResult;

// ── Skip detection ──────────────────────────────────────────────────

const SKIP_TOKENS = new Set(['skip', 's', 'next', 'pass', 'na', 'n/a', '-']);

/**
 * Check if the input text is a skip command.
 */
export function parseSkip(text: string): SkipParseResult | null {
  const lower = text.trim().toLowerCase();
  if (SKIP_TOKENS.has(lower)) {
    return { kind: 'skip', confidence: 'high' };
  }
  return null;
}

// ── Numeric extraction ──────────────────────────────────────────────

/**
 * Extract a numeric value from natural-language text.
 *
 * Handles patterns like:
 * - "7" or "6.5" → direct number (high confidence)
 * - "4/5" → numerator extraction (high confidence)
 * - "slept 4 hours" → keyword + number (medium confidence)
 * - "mood 4" → keyword + number (medium confidence)
 * - "pretty elevated maybe 4" → number in conversational text (low confidence)
 *
 * When `min` and `max` are provided, the extracted value is validated
 * against the range. Out-of-range values return null.
 */
export function parseNaturalNumber(
  text: string,
  min?: number,
  max?: number,
): NumericParseResult | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const lower = trimmed.toLowerCase();

  // 1. Direct number: "7", "6.5", "0"
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const val = parseFloat(trimmed);
    if (!isNaN(val) && isFinite(val) && val >= 0) {
      if (min !== undefined && val < min) return null;
      if (max !== undefined && val > max) return null;
      return { kind: 'numeric', value: val, confidence: 'high' };
    }
  }

  // 2. Fraction format: "4/5", "3 / 5"
  const fractionMatch = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fractionMatch) {
    const numerator = parseInt(fractionMatch[1], 10);
    if (!isNaN(numerator) && numerator >= 0) {
      if (min !== undefined && numerator < min) return null;
      if (max !== undefined && numerator > max) return null;
      return { kind: 'numeric', value: numerator, confidence: 'high' };
    }
  }

  // 3. Keyword + number patterns (medium confidence)
  //    "slept 4 hours", "mood 4", "energy 3", "sleep 7.5", "about 6 hours"
  const keywordNumberMatch = lower.match(
    /(?:slept|sleep|mood|energy|focus|anxiety|irritability|appetite|conflict|racing|impulsivity|risk|about|around|roughly|maybe|like)\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)?/,
  );
  if (keywordNumberMatch) {
    const val = parseFloat(keywordNumberMatch[1]);
    if (!isNaN(val) && isFinite(val) && val >= 0) {
      if (min !== undefined && val < min) return null;
      if (max !== undefined && val > max) return null;
      return { kind: 'numeric', value: val, confidence: 'medium' };
    }
  }

  // 4. Number + keyword: "4 hours", "7.5 hrs", "6 h"
  const numberKeywordMatch = lower.match(
    /^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h|out\s+of\s+\d+)$/,
  );
  if (numberKeywordMatch) {
    const val = parseFloat(numberKeywordMatch[1]);
    if (!isNaN(val) && isFinite(val) && val >= 0) {
      if (min !== undefined && val < min) return null;
      if (max !== undefined && val > max) return null;
      return { kind: 'numeric', value: val, confidence: 'medium' };
    }
  }

  // 5. Last resort: extract any number from conversational text (low confidence)
  //    "pretty elevated maybe 4", "I'd say about a 3", "feeling like a 2 today"
  const numbers = [...lower.matchAll(/(\d+(?:\.\d+)?)/g)];
  if (numbers.length === 1) {
    const val = parseFloat(numbers[0][1]);
    if (!isNaN(val) && isFinite(val) && val >= 0) {
      if (min !== undefined && val < min) return null;
      if (max !== undefined && val > max) return null;
      return { kind: 'numeric', value: val, confidence: 'low' };
    }
  }

  // Multiple numbers found — ambiguous, don't guess
  return null;
}

// ── Medication name detection ───────────────────────────────────────

/**
 * Detect a medication name in natural-language text.
 *
 * Matches against the active medication list from seed config.
 * Handles patterns like:
 * - "missed seroquel"
 * - "forgot my lithium"
 * - "didn't take lamotrigine"
 * - "skipped seroquel today"
 */
export function parseMedicationMention(
  text: string,
  medications?: MedicationDefinitionSeed[],
): MedicationParseResult | null {
  const lower = text.trim().toLowerCase();
  if (lower.length === 0) return null;

  const meds = medications ?? getActiveMedications();

  for (const med of meds) {
    // Match against the medication code (e.g. "seroquel")
    if (lower.includes(med.code.toLowerCase())) {
      return {
        kind: 'medication',
        medicationCode: med.code,
        medicationName: med.display_name,
        confidence: 'high',
      };
    }

    // Match against the display name (e.g. "Seroquel (quetiapine)")
    // Extract the generic name from parentheses if present
    const genericMatch = med.display_name.match(/\(([^)]+)\)/);
    if (genericMatch) {
      const genericName = genericMatch[1].toLowerCase();
      if (lower.includes(genericName)) {
        return {
          kind: 'medication',
          medicationCode: med.code,
          medicationName: med.display_name,
          confidence: 'high',
        };
      }
    }

    // Match against the display name without parenthetical
    const baseName = med.display_name.split('(')[0].trim().toLowerCase();
    if (baseName.length > 2 && lower.includes(baseName)) {
      return {
        kind: 'medication',
        medicationCode: med.code,
        medicationName: med.display_name,
        confidence: 'medium',
      };
    }
  }

  return null;
}

// ── Structured answer enhancement ───────────────────────────────────

/**
 * Parse a structured yes/no/partial answer from natural language.
 *
 * Extends the strict parser to handle conversational patterns:
 * - "yeah", "yep", "took them", "all good" → yes (1)
 * - "nope", "didn't take", "forgot" → no (0)
 * - "some", "most of them", "partial" → partial (0.5)
 */
export function parseNaturalStructured(text: string): NumericParseResult | null {
  const lower = text.trim().toLowerCase();

  // Strict matches (high confidence)
  if (['yes', 'y', 'yeah', 'yep', 'yup', 'took them', 'all good', 'all taken'].includes(lower)) {
    return { kind: 'numeric', value: 1, confidence: 'high' };
  }
  if (['no', 'n', 'nope', 'nah', 'none', "didn't take", 'forgot', 'forgot them'].includes(lower)) {
    return { kind: 'numeric', value: 0, confidence: 'high' };
  }
  if (['partial', 'p', 'some', 'most', 'most of them', 'partially'].includes(lower)) {
    return { kind: 'numeric', value: 0.5, confidence: 'high' };
  }

  return null;
}

// ── Combined parser ─────────────────────────────────────────────────

/**
 * Parse a natural-language reply, trying all strategies in order.
 *
 * Returns the first successful parse result, or `{ kind: 'unknown' }`
 * if nothing matches.
 *
 * @param text - The raw user input text.
 * @param opts - Optional constraints for numeric parsing.
 */
export function parseNaturalLanguage(
  text: string,
  opts?: { min?: number; max?: number },
): NLParseResult {
  // 1. Check for skip
  const skip = parseSkip(text);
  if (skip) return skip;

  // 2. Check for medication mention
  const med = parseMedicationMention(text);
  if (med) return med;

  // 3. Try numeric extraction
  const num = parseNaturalNumber(text, opts?.min, opts?.max);
  if (num) return num;

  return { kind: 'unknown' };
}
