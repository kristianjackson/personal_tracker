import { describe, it, expect } from 'vitest';
import { validateEnv, assertEnv, WORKER_API_BINDINGS } from './env.js';
import type { EnvValidationRule } from './env.js';

describe('validateEnv', () => {
  const rules: EnvValidationRule[] = [
    { name: 'DB', required: true, description: 'D1 database' },
    { name: 'KV', required: true, description: 'KV namespace' },
    { name: 'OPTIONAL_VAR', required: false, description: 'Optional binding' },
  ];

  it('returns valid when all required bindings are present', () => {
    const env = { DB: {}, KV: {} };
    const result = validateEnv(env, rules);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('returns invalid with missing required bindings', () => {
    const env = { KV: {} };
    const result = validateEnv(env, rules);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['DB']);
  });

  it('treats null values as missing', () => {
    const env = { DB: null, KV: {} };
    const result = validateEnv(env, rules);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['DB']);
  });

  it('treats undefined values as missing', () => {
    const env = { KV: {} };
    const result = validateEnv(env, rules);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('DB');
  });

  it('does not flag optional bindings as missing', () => {
    const env = { DB: {}, KV: {} };
    const result = validateEnv(env, rules);
    expect(result.valid).toBe(true);
    expect(result.missing).not.toContain('OPTIONAL_VAR');
  });

  it('reports all missing required bindings at once', () => {
    const env = {};
    const result = validateEnv(env, rules);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['DB', 'KV']);
  });

  it('returns valid for empty rules', () => {
    const result = validateEnv({}, []);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

describe('assertEnv', () => {
  const rules: EnvValidationRule[] = [
    { name: 'DB', required: true, description: 'D1 database' },
    { name: 'KV', required: true, description: 'KV namespace' },
  ];

  it('does not throw when all required bindings are present', () => {
    expect(() => assertEnv({ DB: {}, KV: {} }, rules)).not.toThrow();
  });

  it('throws with descriptive message listing missing bindings', () => {
    expect(() => assertEnv({}, rules)).toThrow(
      'Missing required environment bindings: DB (D1 database), KV (KV namespace)',
    );
  });

  it('includes description in error message when available', () => {
    expect(() => assertEnv({ KV: {} }, rules)).toThrow('DB (D1 database)');
  });

  it('lists binding name without description when description is absent', () => {
    const rulesNoDesc: EnvValidationRule[] = [{ name: 'SECRET', required: true }];
    expect(() => assertEnv({}, rulesNoDesc)).toThrow(
      'Missing required environment bindings: SECRET',
    );
  });
});

describe('WORKER_API_BINDINGS', () => {
  it('defines the four standard worker bindings', () => {
    const names = WORKER_API_BINDINGS.map((r) => r.name);
    expect(names).toEqual(['DB', 'QUEUE', 'BUCKET', 'KV']);
  });

  it('marks all standard bindings as required', () => {
    expect(WORKER_API_BINDINGS.every((r) => r.required)).toBe(true);
  });
});
