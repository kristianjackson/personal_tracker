import { describe, it, expect, beforeEach } from 'vitest';
import {
  filterNavItems,
  isRouteAccessible,
  readPersistedState,
  persistState,
  NAV_ITEMS,
  ADMIN_ROUTES,
  CLINICAL_LABELS,
  ADMIN_LABELS,
  type NavItem,
} from './clinician-mode-helpers.js';

/* ── In-memory localStorage stub ─────────────────────────── */

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

/* ── filterNavItems ──────────────────────────────────────── */

describe('filterNavItems', () => {
  it('returns all items when clinician mode is off', () => {
    const result = filterNavItems(NAV_ITEMS, false);
    expect(result).toEqual(NAV_ITEMS);
    expect(result).toHaveLength(7);
  });

  it('excludes admin-only items when clinician mode is on', () => {
    const result = filterNavItems(NAV_ITEMS, true);
    const labels = result.map((item) => item.label);

    for (const label of CLINICAL_LABELS) {
      expect(labels).toContain(label);
    }
    for (const label of ADMIN_LABELS) {
      expect(labels).not.toContain(label);
    }
  });

  it('returns 5 clinical items in clinician mode', () => {
    const result = filterNavItems(NAV_ITEMS, true);
    expect(result).toHaveLength(5);
  });

  it('preserves item order in clinician mode', () => {
    const result = filterNavItems(NAV_ITEMS, true);
    const labels = result.map((item) => item.label);
    expect(labels).toEqual(['Overview', 'Trends', 'Notes', 'Medications', 'Flags']);
  });

  it('handles empty items array', () => {
    expect(filterNavItems([], true)).toEqual([]);
    expect(filterNavItems([], false)).toEqual([]);
  });

  it('handles items with no adminOnly flag', () => {
    const items: NavItem[] = [
      { to: '/a', label: 'A', icon: '🅰️' },
      { to: '/b', label: 'B', icon: '🅱️' },
    ];
    expect(filterNavItems(items, true)).toEqual(items);
  });
});

/* ── isRouteAccessible ───────────────────────────────────── */

describe('isRouteAccessible', () => {
  it('allows all routes when clinician mode is off', () => {
    expect(isRouteAccessible('/', false)).toBe(true);
    expect(isRouteAccessible('/settings', false)).toBe(true);
    expect(isRouteAccessible('/reports', false)).toBe(true);
  });

  it('blocks admin routes when clinician mode is on', () => {
    for (const route of ADMIN_ROUTES) {
      expect(isRouteAccessible(route, true)).toBe(false);
    }
  });

  it('allows clinical routes when clinician mode is on', () => {
    const clinicalRoutes = ['/', '/trends', '/notes', '/medications', '/flags'];
    for (const route of clinicalRoutes) {
      expect(isRouteAccessible(route, true)).toBe(true);
    }
  });
});

/* ── Persistence ─────────────────────────────────────────── */

describe('readPersistedState', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it('returns false when key is absent', () => {
    expect(readPersistedState(storage)).toBe(false);
  });

  it('returns true when key is "1"', () => {
    storage.setItem('clinician-mode', '1');
    expect(readPersistedState(storage)).toBe(true);
  });

  it('returns false for any other value', () => {
    storage.setItem('clinician-mode', '0');
    expect(readPersistedState(storage)).toBe(false);

    storage.setItem('clinician-mode', 'true');
    expect(readPersistedState(storage)).toBe(false);
  });

  it('returns false when storage throws', () => {
    const broken = {
      getItem: () => { throw new Error('no storage'); },
    } as unknown as Storage;
    expect(readPersistedState(broken)).toBe(false);
  });
});

describe('persistState', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it('sets key to "1" when enabled', () => {
    persistState(true, storage);
    expect(storage.getItem('clinician-mode')).toBe('1');
  });

  it('removes key when disabled', () => {
    storage.setItem('clinician-mode', '1');
    persistState(false, storage);
    expect(storage.getItem('clinician-mode')).toBeNull();
  });

  it('does not throw when storage is broken', () => {
    const broken = {
      setItem: () => { throw new Error('no storage'); },
      removeItem: () => { throw new Error('no storage'); },
    } as unknown as Storage;
    expect(() => persistState(true, broken)).not.toThrow();
    expect(() => persistState(false, broken)).not.toThrow();
  });
});

/* ── NAV_ITEMS structure ─────────────────────────────────── */

describe('NAV_ITEMS', () => {
  it('has exactly 2 admin-only items', () => {
    const adminItems = NAV_ITEMS.filter((item) => item.adminOnly);
    expect(adminItems).toHaveLength(2);
  });

  it('admin items are Reports and Settings', () => {
    const adminLabels = NAV_ITEMS.filter((item) => item.adminOnly).map((item) => item.label);
    expect(adminLabels).toEqual(['Reports', 'Settings']);
  });

  it('all items have required fields', () => {
    for (const item of NAV_ITEMS) {
      expect(item.to).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTruthy();
    }
  });
});
