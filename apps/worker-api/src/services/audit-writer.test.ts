import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeAuditEvent, queryAuditEvents } from './audit-writer';
import type { AuditAction, AuditEvent } from '@symptom-tracker/shared';

/**
 * Tests for the audit event writer and query utility.
 *
 * Validates: NFR-SEC-008 (System shall log audit events for auth, exports,
 *            config changes, summary generation, and deletions.)
 * Validates: NFR-SEC-005 (detail field must NOT contain PHI)
 * Design: Section 5.13 — audit_event table schema
 * Design: Section 9.5 — Audit trail
 */

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a mock D1Database with prepare/bind/run/all support. */
function mockDb(options: {
  allResult?: AuditEvent[];
} = {}) {
  const { allResult = [] } = options;

  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn(async () => ({ meta: { changes: 1 } })),
    all: vi.fn(async () => ({ results: allResult })),
  };

  return {
    prepare: vi.fn(() => stmt),
    _stmt: stmt,
  } as unknown as D1Database & { _stmt: typeof stmt };
}

const sampleAuditEvent: AuditEvent = {
  id: 'audit-001',
  user_id: 'user-001',
  action: 'login',
  detail: '{"method":"cloudflare_access"}',
  ip_address: '192.168.1.1',
  created_at: '2025-06-10T14:30:00.000Z',
};

// ── writeAuditEvent ──────────────────────────────────────────────────

describe('writeAuditEvent', () => {
  it('inserts an audit event with all fields populated', async () => {
    const db = mockDb();

    await writeAuditEvent(db, {
      userId: 'user-001',
      action: 'login',
      detail: { method: 'cloudflare_access' },
      ipAddress: '192.168.1.1',
    });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_event'),
    );
    expect(db._stmt.bind).toHaveBeenCalledWith(
      expect.any(String), // id (generated)
      'user-001',
      'login',
      '{"method":"cloudflare_access"}',
      '192.168.1.1',
      expect.any(String), // created_at (generated)
    );
    expect(db._stmt.run).toHaveBeenCalledOnce();
  });

  it('inserts an audit event with nullable fields (no userId, no detail, no ipAddress)', async () => {
    const db = mockDb();

    await writeAuditEvent(db, {
      action: 'config_change',
    });

    expect(db._stmt.bind).toHaveBeenCalledWith(
      expect.any(String), // id
      null, // user_id
      'config_change',
      null, // detail
      null, // ip_address
      expect.any(String), // created_at
    );
  });

  it('generates a unique ID for each audit event', async () => {
    const db = mockDb();
    const capturedIds: string[] = [];

    db._stmt.bind = vi.fn((...args: unknown[]) => {
      capturedIds.push(args[0] as string);
      return db._stmt;
    });

    await writeAuditEvent(db, { action: 'login' });
    await writeAuditEvent(db, { action: 'export' });

    expect(capturedIds).toHaveLength(2);
    expect(capturedIds[0]).not.toBe(capturedIds[1]);
  });

  it('sets created_at to a valid ISO 8601 UTC timestamp', async () => {
    const db = mockDb();
    const before = new Date();

    await writeAuditEvent(db, { action: 'login' });

    const after = new Date();
    const bindArgs = db._stmt.bind.mock.calls[0];
    const createdAt = new Date(bindArgs[5] as string);
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('serializes detail as a JSON string', async () => {
    const db = mockDb();

    await writeAuditEvent(db, {
      action: 'export',
      detail: { reportId: 'rpt-123', format: 'pdf' },
    });

    const bindArgs = db._stmt.bind.mock.calls[0];
    const detailArg = bindArgs[3] as string;
    expect(detailArg).toBe('{"reportId":"rpt-123","format":"pdf"}');
    // Verify it's valid JSON
    expect(() => JSON.parse(detailArg)).not.toThrow();
  });

  it('writes each action type successfully', async () => {
    const actions: AuditAction[] = [
      'login',
      'export',
      'config_change',
      'delete',
      'summary_generate',
      'flag_dismiss',
    ];

    for (const action of actions) {
      const db = mockDb();
      await writeAuditEvent(db, { action });

      const bindArgs = db._stmt.bind.mock.calls[0];
      expect(bindArgs[2]).toBe(action);
      expect(db._stmt.run).toHaveBeenCalledOnce();
    }
  });

  it('propagates D1 errors to the caller', async () => {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn(async () => {
        throw new Error('D1 write failed');
      }),
    };
    const db = { prepare: vi.fn(() => stmt) } as unknown as D1Database;

    await expect(
      writeAuditEvent(db, { action: 'login' }),
    ).rejects.toThrow('D1 write failed');
  });
});

// ── queryAuditEvents ─────────────────────────────────────────────────

describe('queryAuditEvents', () => {
  it('returns all audit events when no filters are provided', async () => {
    const events = [sampleAuditEvent];
    const db = mockDb({ allResult: events });

    const result = await queryAuditEvents(db);

    expect(result).toEqual(events);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
    );
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at DESC'),
    );
  });

  it('filters by userId when provided', async () => {
    const db = mockDb({ allResult: [sampleAuditEvent] });

    await queryAuditEvents(db, { userId: 'user-001' });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('user_id = ?'),
    );
    expect(db._stmt.bind).toHaveBeenCalledWith('user-001', 50, 0);
  });

  it('filters by action when provided', async () => {
    const db = mockDb({ allResult: [sampleAuditEvent] });

    await queryAuditEvents(db, { action: 'login' });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('action = ?'),
    );
    expect(db._stmt.bind).toHaveBeenCalledWith('login', 50, 0);
  });

  it('filters by both userId and action when provided', async () => {
    const db = mockDb({ allResult: [sampleAuditEvent] });

    await queryAuditEvents(db, { userId: 'user-001', action: 'export' });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('user_id = ?'),
    );
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('action = ?'),
    );
    expect(db._stmt.bind).toHaveBeenCalledWith('user-001', 'export', 50, 0);
  });

  it('applies limit and offset for pagination', async () => {
    const db = mockDb({ allResult: [] });

    await queryAuditEvents(db, { limit: 10, offset: 20 });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT ? OFFSET ?'),
    );
    expect(db._stmt.bind).toHaveBeenCalledWith(10, 20);
  });

  it('uses default limit of 50 and offset of 0', async () => {
    const db = mockDb({ allResult: [] });

    await queryAuditEvents(db);

    expect(db._stmt.bind).toHaveBeenCalledWith(50, 0);
  });

  it('returns an empty array when no events match', async () => {
    const db = mockDb({ allResult: [] });

    const result = await queryAuditEvents(db, { userId: 'nonexistent' });

    expect(result).toEqual([]);
  });

  it('propagates D1 errors to the caller', async () => {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn(async () => {
        throw new Error('D1 unavailable');
      }),
    };
    const db = { prepare: vi.fn(() => stmt) } as unknown as D1Database;

    await expect(
      queryAuditEvents(db, { userId: 'user-001' }),
    ).rejects.toThrow('D1 unavailable');
  });
});
