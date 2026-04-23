/**
 * Environment validation utility.
 *
 * Validates that required environment variables and Cloudflare bindings
 * are present at startup. Throws a descriptive error listing all missing
 * bindings so operators can fix configuration in one pass.
 */

export interface EnvValidationRule {
  /** Name of the environment variable or binding. */
  name: string;
  /** If true, the binding must be present (non-null/undefined). */
  required: boolean;
  /** Optional human-readable description shown in error messages. */
  description?: string;
}

export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
}

/**
 * Validate that all required bindings are present in the given environment object.
 *
 * @param env - The environment/bindings object (e.g. Cloudflare Worker Env).
 * @param rules - Array of validation rules describing expected bindings.
 * @returns Validation result with list of missing required bindings.
 *
 * @example
 * ```ts
 * const result = validateEnv(env, [
 *   { name: 'DB', required: true, description: 'D1 database' },
 *   { name: 'KV', required: true, description: 'KV namespace' },
 *   { name: 'BUCKET', required: false, description: 'R2 bucket' },
 * ]);
 * if (!result.valid) {
 *   throw new Error(`Missing bindings: ${result.missing.join(', ')}`);
 * }
 * ```
 */
export function validateEnv(
  env: Record<string, unknown>,
  rules: EnvValidationRule[],
): EnvValidationResult {
  const missing: string[] = [];

  for (const rule of rules) {
    if (rule.required && (env[rule.name] === undefined || env[rule.name] === null)) {
      missing.push(rule.name);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Validate environment and throw if any required bindings are missing.
 * Provides a single descriptive error message listing all missing bindings.
 */
export function assertEnv(env: Record<string, unknown>, rules: EnvValidationRule[]): void {
  const result = validateEnv(env, rules);
  if (!result.valid) {
    const details = result.missing
      .map((name) => {
        const rule = rules.find((r) => r.name === name);
        return rule?.description ? `${name} (${rule.description})` : name;
      })
      .join(', ');
    throw new Error(`Missing required environment bindings: ${details}`);
  }
}

/** Standard Worker API bindings expected in production. */
export const WORKER_API_BINDINGS: EnvValidationRule[] = [
  { name: 'DB', required: true, description: 'D1 database' },
  { name: 'QUEUE', required: true, description: 'Cloudflare Queue' },
  { name: 'BUCKET', required: true, description: 'R2 bucket' },
  { name: 'KV', required: true, description: 'KV namespace' },
];
