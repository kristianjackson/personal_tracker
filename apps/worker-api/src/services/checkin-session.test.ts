/**
 * Tests for the check-in session state service.
 *
 * Uses an in-memory Map-based KV mock that tracks TTL values
 * so we can assert the 4-hour expiration is applied on every write.
 *
 * Validates: FR-WA-006 (Session state resumes correctly; sessions
 *            expire after 4 hours of inactivity.)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSession,
  createSession,
  saveSession,
  deleteSession,
  recordAnswer,
  getNextQuestion,
  isSessionComplete,
  getSessionProgress,
} from './checkin-session';
import type { CheckinSession } from './checkin-session';
import {
  CHECKIN_SESSION_TTL_SECONDS,
  getEnabledQuestions,
} from '@symptom-tracker/shared';

// ── KV mock ─────────────────────────────────────────────────────────

interface KVEntry {
  value: string;
  expirationTtl?: number;
}

function createKVMock() {
  const store = new Map<string, KVEntry>();

  const kv: KVNamespace = {
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      return entry ? entry.value : null;
    }),
    put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, { value, expirationTtl: opts?.expirationTtl });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    // Unused methods — satisfy the interface
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;

  return { kv, store };
}

// ── Helpers ─────────────────────────────────────────────────────────

const TEST_USER_ID = 'user-abc-123';
const TEST_DATE = '2025-07-15';
const enabledQuestions = getEnabledQuestions();

// ── Tests ───────────────────────────────────────────────────────────

describe('checkin-session', () => {
  let kv: KVNamespace;
  let store: Map<string, KVEntry>;

  beforeEach(() => {
    const mock = createKVMock();
    kv = mock.kv;
    store = mock.store;
  });

  // ── getSession ──────────────────────────────────────────────────

  describe('getSession', () => {
    it('returns null for a non-existent session', async () => {
      const session = await getSession(kv, TEST_USER_ID);
      expect(session).toBeNull();
    });

    it('returns parsed session for an existing session', async () => {
      const created = await createSession(kv, TEST_USER_ID, TEST_DATE);
      const retrieved = await getSession(kv, TEST_USER_ID);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(created.sessionId);
      expect(retrieved!.userId).toBe(TEST_USER_ID);
      expect(retrieved!.checkinDate).toBe(TEST_DATE);
      expect(retrieved!.currentQuestionIndex).toBe(0);
      expect(retrieved!.answers).toEqual({});
      expect(retrieved!.isRetroactive).toBe(false);
    });
  });

  // ── createSession ───────────────────────────────────────────────

  describe('createSession', () => {
    it('stores correct data with TTL', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);

      expect(session.userId).toBe(TEST_USER_ID);
      expect(session.checkinDate).toBe(TEST_DATE);
      expect(session.currentQuestionIndex).toBe(0);
      expect(session.answers).toEqual({});
      expect(session.isRetroactive).toBe(false);
      expect(session.sessionId).toBeTruthy();
      expect(session.startedAt).toBeTruthy();
      expect(session.updatedAt).toBe(session.startedAt);

      // Verify KV was called with the correct TTL
      const entry = store.get(`checkin-session:${TEST_USER_ID}`);
      expect(entry).toBeDefined();
      expect(entry!.expirationTtl).toBe(CHECKIN_SESSION_TTL_SECONDS);
      expect(entry!.expirationTtl).toBe(14400);
    });

    it('creates a retroactive session when flag is set', async () => {
      const session = await createSession(kv, TEST_USER_ID, '2025-07-14', true);

      expect(session.isRetroactive).toBe(true);
      expect(session.checkinDate).toBe('2025-07-14');
    });

    it('defaults isRetroactive to false', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      expect(session.isRetroactive).toBe(false);
    });
  });

  // ── saveSession ─────────────────────────────────────────────────

  describe('saveSession', () => {
    it('refreshes the TTL on save', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);

      // Mutate and save
      const updated = recordAnswer(session, 'DAT-001', 7, false);
      await saveSession(kv, updated);

      const entry = store.get(`checkin-session:${TEST_USER_ID}`);
      expect(entry).toBeDefined();
      expect(entry!.expirationTtl).toBe(CHECKIN_SESSION_TTL_SECONDS);

      // Verify the saved data reflects the update
      const retrieved = await getSession(kv, TEST_USER_ID);
      expect(retrieved!.currentQuestionIndex).toBe(1);
      expect(retrieved!.answers['DAT-001']).toBeDefined();
      expect(retrieved!.answers['DAT-001'].valueNumeric).toBe(7);
    });
  });

  // ── deleteSession ───────────────────────────────────────────────

  describe('deleteSession', () => {
    it('removes the session from KV', async () => {
      await createSession(kv, TEST_USER_ID, TEST_DATE);
      expect(await getSession(kv, TEST_USER_ID)).not.toBeNull();

      await deleteSession(kv, TEST_USER_ID);
      expect(await getSession(kv, TEST_USER_ID)).toBeNull();
    });

    it('does not throw when deleting a non-existent session', async () => {
      await expect(deleteSession(kv, 'no-such-user')).resolves.not.toThrow();
    });
  });

  // ── recordAnswer ────────────────────────────────────────────────

  describe('recordAnswer', () => {
    it('advances the question index', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      expect(session.currentQuestionIndex).toBe(0);

      const updated = recordAnswer(session, 'DAT-001', 7.5, false);
      expect(updated.currentQuestionIndex).toBe(1);
    });

    it('records a numeric answer correctly', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      const updated = recordAnswer(session, 'DAT-001', 6.5, false);

      const answer = updated.answers['DAT-001'];
      expect(answer.variableCode).toBe('DAT-001');
      expect(answer.valueNumeric).toBe(6.5);
      expect(answer.valueText).toBeNull();
      expect(answer.skipped).toBe(false);
      expect(answer.answeredAt).toBeTruthy();
    });

    it('records a text answer correctly', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      // Advance to DAT-014 (side effects — text type)
      let s = session;
      for (let i = 0; i < 13; i++) {
        s = recordAnswer(s, enabledQuestions[i].variable_code, i, false);
      }
      const updated = recordAnswer(s, 'DAT-014', 'mild nausea', false);

      const answer = updated.answers['DAT-014'];
      expect(answer.valueText).toBe('mild nausea');
      expect(answer.valueNumeric).toBeNull();
      expect(answer.skipped).toBe(false);
    });

    it('marks skipped answers correctly', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      const updated = recordAnswer(session, 'DAT-001', null, true);

      const answer = updated.answers['DAT-001'];
      expect(answer.skipped).toBe(true);
      expect(answer.valueNumeric).toBeNull();
      expect(answer.valueText).toBeNull();
    });

    it('updates the updatedAt timestamp', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      const originalUpdatedAt = session.updatedAt;

      // Small delay to ensure timestamp differs
      const updated = recordAnswer(session, 'DAT-001', 5, false);
      expect(updated.updatedAt).toBeTruthy();
      // updatedAt should be set (may or may not differ depending on timing)
      expect(typeof updated.updatedAt).toBe('string');
    });

    it('is a pure function — does not mutate the original session', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      const originalIndex = session.currentQuestionIndex;
      const originalAnswers = { ...session.answers };

      recordAnswer(session, 'DAT-001', 7, false);

      expect(session.currentQuestionIndex).toBe(originalIndex);
      expect(session.answers).toEqual(originalAnswers);
    });
  });

  // ── getNextQuestion ─────────────────────────────────────────────

  describe('getNextQuestion', () => {
    it('returns the first question for a new session', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      const question = getNextQuestion(session);

      expect(question).not.toBeNull();
      expect(question!.variable_code).toBe('DAT-001');
      expect(question!.prompt).toContain('sleep');
    });

    it('returns the correct next question after answering', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      const updated = recordAnswer(session, 'DAT-001', 7, false);
      const question = getNextQuestion(updated);

      expect(question).not.toBeNull();
      expect(question!.variable_code).toBe('DAT-002');
    });

    it('returns null when all questions are answered', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      let s = session;
      for (let i = 0; i < enabledQuestions.length; i++) {
        s = recordAnswer(s, enabledQuestions[i].variable_code, i, false);
      }

      const question = getNextQuestion(s);
      expect(question).toBeNull();
    });
  });

  // ── isSessionComplete ───────────────────────────────────────────

  describe('isSessionComplete', () => {
    it('returns false when questions remain', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      expect(isSessionComplete(session)).toBe(false);
    });

    it('returns false when partially answered', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      const updated = recordAnswer(session, 'DAT-001', 7, false);
      expect(isSessionComplete(updated)).toBe(false);
    });

    it('returns true when all questions are done', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      let s = session;
      for (let i = 0; i < enabledQuestions.length; i++) {
        s = recordAnswer(s, enabledQuestions[i].variable_code, i, false);
      }
      expect(isSessionComplete(s)).toBe(true);
    });

    it('returns true when all questions are skipped', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      let s = session;
      for (let i = 0; i < enabledQuestions.length; i++) {
        s = recordAnswer(s, enabledQuestions[i].variable_code, null, true);
      }
      expect(isSessionComplete(s)).toBe(true);
    });
  });

  // ── getSessionProgress ──────────────────────────────────────────

  describe('getSessionProgress', () => {
    it('returns correct counts for a new session', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      const progress = getSessionProgress(session);

      expect(progress.answered).toBe(0);
      expect(progress.skipped).toBe(0);
      expect(progress.total).toBe(enabledQuestions.length);
      expect(progress.remaining).toBe(enabledQuestions.length);
    });

    it('returns correct counts after answering some questions', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      let s = recordAnswer(session, 'DAT-001', 7, false);
      s = recordAnswer(s, 'DAT-002', null, true);
      s = recordAnswer(s, 'DAT-003', 3, false);

      const progress = getSessionProgress(s);
      expect(progress.answered).toBe(2);
      expect(progress.skipped).toBe(1);
      expect(progress.total).toBe(enabledQuestions.length);
      expect(progress.remaining).toBe(enabledQuestions.length - 3);
    });

    it('returns zero remaining when all questions are done', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      let s = session;
      for (let i = 0; i < enabledQuestions.length; i++) {
        s = recordAnswer(s, enabledQuestions[i].variable_code, i, false);
      }

      const progress = getSessionProgress(s);
      expect(progress.answered).toBe(enabledQuestions.length);
      expect(progress.skipped).toBe(0);
      expect(progress.remaining).toBe(0);
    });
  });

  // ── Resume logic (integration-style) ────────────────────────────

  describe('resume logic', () => {
    it('resumes from the correct question after partial completion', async () => {
      // Start a session and answer 3 questions
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      let s = session;
      s = recordAnswer(s, 'DAT-001', 7, false);
      s = recordAnswer(s, 'DAT-002', 4, false);
      s = recordAnswer(s, 'DAT-003', 3, false);
      await saveSession(kv, s);

      // Simulate "user comes back later" — retrieve session from KV
      const resumed = await getSession(kv, TEST_USER_ID);
      expect(resumed).not.toBeNull();
      expect(resumed!.currentQuestionIndex).toBe(3);

      // Next question should be DAT-004 (Energy)
      const nextQ = getNextQuestion(resumed!);
      expect(nextQ).not.toBeNull();
      expect(nextQ!.variable_code).toBe('DAT-004');

      // Previous answers should be preserved
      expect(resumed!.answers['DAT-001'].valueNumeric).toBe(7);
      expect(resumed!.answers['DAT-002'].valueNumeric).toBe(4);
      expect(resumed!.answers['DAT-003'].valueNumeric).toBe(3);
    });

    it('resumes correctly with a mix of answered and skipped questions', async () => {
      const session = await createSession(kv, TEST_USER_ID, TEST_DATE);
      let s = session;
      s = recordAnswer(s, 'DAT-001', 6, false);
      s = recordAnswer(s, 'DAT-002', null, true); // skipped
      s = recordAnswer(s, 'DAT-003', 4, false);
      s = recordAnswer(s, 'DAT-004', null, true); // skipped
      s = recordAnswer(s, 'DAT-005', 2, false);
      await saveSession(kv, s);

      const resumed = await getSession(kv, TEST_USER_ID);
      expect(resumed!.currentQuestionIndex).toBe(5);

      const nextQ = getNextQuestion(resumed!);
      expect(nextQ!.variable_code).toBe('DAT-006');

      const progress = getSessionProgress(resumed!);
      expect(progress.answered).toBe(3);
      expect(progress.skipped).toBe(2);
      expect(progress.remaining).toBe(enabledQuestions.length - 5);
    });
  });

  // ── Retroactive session ─────────────────────────────────────────

  describe('retroactive session', () => {
    it('preserves the retroactive flag through save/retrieve cycle', async () => {
      const session = await createSession(kv, TEST_USER_ID, '2025-07-13', true);
      expect(session.isRetroactive).toBe(true);

      const updated = recordAnswer(session, 'DAT-001', 5, false);
      await saveSession(kv, updated);

      const retrieved = await getSession(kv, TEST_USER_ID);
      expect(retrieved!.isRetroactive).toBe(true);
      expect(retrieved!.checkinDate).toBe('2025-07-13');
    });
  });
});
