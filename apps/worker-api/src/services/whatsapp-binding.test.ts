import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findBindingByPhone,
  createBinding,
  deactivateBinding,
} from './whatsapp-binding';
import type { WhatsAppBinding } from '@symptom-tracker/shared';

/**
 * Tests for the WhatsApp binding service.
 *
 * Validates: FR-WA-002 (System shall identify the user by WhatsApp phone number binding.
 *            Messages from bound number are assigned to correct user.)
 * Design: Section 5.2 — whatsapp_binding table schema
 */

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a mock D1Database with prepare/bind/first/run support. */
function mockDb(options: {
  firstResult?: WhatsAppBinding | null;
  runResult?: { meta?: { changes?: number } };
} = {}) {
  const { firstResult = null, runResult = { meta: { changes: 1 } } } = options;

  const stmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(async () => firstResult),
    run: vi.fn(async () => runResult),
  };

  return {
    prepare: vi.fn(() => stmt),
    _stmt: stmt,
  } as unknown as D1Database & { _stmt: typeof stmt };
}

const sampleBinding: WhatsAppBinding = {
  id: 'binding-001',
  user_id: 'user-001',
  phone_number: '+15551234567',
  verified_at: '2025-06-10T14:30:00.000Z',
  active: 1,
};

// ── findBindingByPhone ───────────────────────────────────────────────

describe('findBindingByPhone', () => {
  it('returns the active binding for a known phone number', async () => {
    const db = mockDb({ firstResult: sampleBinding });

    const result = await findBindingByPhone(db, '+15551234567');

    expect(result.binding).toEqual(sampleBinding);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('phone_number = ?'),
    );
    expect(db._stmt.bind).toHaveBeenCalledWith('+15551234567');
  });

  it('returns null when no active binding exists for the phone number', async () => {
    const db = mockDb({ firstResult: null });

    const result = await findBindingByPhone(db, '+15559999999');

    expect(result.binding).toBeNull();
  });

  it('queries only active bindings (active = 1)', async () => {
    const db = mockDb({ firstResult: null });

    await findBindingByPhone(db, '+15551234567');

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('active = 1'),
    );
  });

  it('propagates D1 errors to the caller', async () => {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => {
        throw new Error('D1 unavailable');
      }),
    };
    const db = { prepare: vi.fn(() => stmt) } as unknown as D1Database;

    await expect(findBindingByPhone(db, '+15551234567')).rejects.toThrow(
      'D1 unavailable',
    );
  });
});

// ── createBinding ────────────────────────────────────────────────────

describe('createBinding', () => {
  it('inserts a new binding and returns the created record', async () => {
    const db = mockDb();

    const result = await createBinding(db, {
      userId: 'user-001',
      phoneNumber: '+15551234567',
    });

    expect(result.user_id).toBe('user-001');
    expect(result.phone_number).toBe('+15551234567');
    expect(result.active).toBe(1);
    expect(result.id).toBeDefined();
    expect(result.verified_at).toBeDefined();
  });

  it('generates a unique ID for the binding', async () => {
    const db = mockDb();

    const result1 = await createBinding(db, {
      userId: 'user-001',
      phoneNumber: '+15551111111',
    });
    const result2 = await createBinding(db, {
      userId: 'user-001',
      phoneNumber: '+15552222222',
    });

    expect(result1.id).not.toBe(result2.id);
  });

  it('sets verified_at to a valid ISO 8601 timestamp', async () => {
    const db = mockDb();
    const before = new Date();

    const result = await createBinding(db, {
      userId: 'user-001',
      phoneNumber: '+15551234567',
    });

    const after = new Date();
    const verifiedAt = new Date(result.verified_at);
    expect(verifiedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(verifiedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('calls D1 prepare with an INSERT statement', async () => {
    const db = mockDb();

    await createBinding(db, {
      userId: 'user-001',
      phoneNumber: '+15551234567',
    });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO whatsapp_binding'),
    );
  });

  it('binds all five columns in the correct order', async () => {
    const db = mockDb();

    const result = await createBinding(db, {
      userId: 'user-001',
      phoneNumber: '+15551234567',
    });

    expect(db._stmt.bind).toHaveBeenCalledWith(
      result.id,
      'user-001',
      '+15551234567',
      result.verified_at,
      1,
    );
  });

  it('propagates D1 errors from run()', async () => {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn(async () => {
        throw new Error('UNIQUE constraint failed');
      }),
    };
    const db = { prepare: vi.fn(() => stmt) } as unknown as D1Database;

    await expect(
      createBinding(db, {
        userId: 'user-001',
        phoneNumber: '+15551234567',
      }),
    ).rejects.toThrow('UNIQUE constraint failed');
  });
});

// ── deactivateBinding ────────────────────────────────────────────────

describe('deactivateBinding', () => {
  it('returns true when a binding is successfully deactivated', async () => {
    const db = mockDb({ runResult: { meta: { changes: 1 } } });

    const result = await deactivateBinding(db, 'binding-001');

    expect(result).toBe(true);
  });

  it('returns false when no matching active binding exists', async () => {
    const db = mockDb({ runResult: { meta: { changes: 0 } } });

    const result = await deactivateBinding(db, 'nonexistent-id');

    expect(result).toBe(false);
  });

  it('updates only active bindings (active = 1)', async () => {
    const db = mockDb({ runResult: { meta: { changes: 1 } } });

    await deactivateBinding(db, 'binding-001');

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('active = 1'),
    );
  });

  it('sets active to 0 on the matching binding', async () => {
    const db = mockDb({ runResult: { meta: { changes: 1 } } });

    await deactivateBinding(db, 'binding-001');

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('SET active = 0'),
    );
    expect(db._stmt.bind).toHaveBeenCalledWith('binding-001');
  });

  it('propagates D1 errors to the caller', async () => {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn(async () => {
        throw new Error('D1 write failed');
      }),
    };
    const db = { prepare: vi.fn(() => stmt) } as unknown as D1Database;

    await expect(deactivateBinding(db, 'binding-001')).rejects.toThrow(
      'D1 write failed',
    );
  });
});
