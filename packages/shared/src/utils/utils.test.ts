import { describe, it, expect } from 'vitest';
import { generateId, utcNow, localDateToday } from './index.js';

describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns unique values on successive calls', () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });
});

describe('utcNow', () => {
  it('returns a valid ISO 8601 string', () => {
    const now = utcNow();
    expect(new Date(now).toISOString()).toBe(now);
  });
});

describe('localDateToday', () => {
  it('returns a YYYY-MM-DD formatted string', () => {
    const date = localDateToday('America/New_York');
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
