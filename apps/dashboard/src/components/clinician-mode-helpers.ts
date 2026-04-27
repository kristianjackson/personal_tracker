/**
 * Pure helpers for clinician summary mode.
 * Extracted for testability without DOM dependencies.
 */

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** If true, hidden when clinician mode is active. */
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: '📊' },
  { to: '/trends', label: 'Trends', icon: '📈' },
  { to: '/notes', label: 'Notes', icon: '📝' },
  { to: '/medications', label: 'Medications', icon: '💊' },
  { to: '/flags', label: 'Flags', icon: '🚩' },
  { to: '/reports', label: 'Reports', icon: '📄', adminOnly: true },
  { to: '/settings', label: 'Settings', icon: '⚙️', adminOnly: true },
];

/** Routes that are hidden in clinician mode. */
export const ADMIN_ROUTES = ['/reports', '/settings'];

/**
 * Filter nav items based on clinician mode state.
 * When clinician mode is enabled, admin-only items are excluded.
 */
export function filterNavItems(items: NavItem[], clinicianMode: boolean): NavItem[] {
  if (!clinicianMode) return items;
  return items.filter((item) => !item.adminOnly);
}

/**
 * Check whether a given route path should be accessible in clinician mode.
 * Returns false for admin-only routes when clinician mode is active.
 */
export function isRouteAccessible(path: string, clinicianMode: boolean): boolean {
  if (!clinicianMode) return true;
  return !ADMIN_ROUTES.includes(path);
}

/** Clinical-only nav item labels (visible in clinician mode). */
export const CLINICAL_LABELS = ['Overview', 'Trends', 'Notes', 'Medications', 'Flags'] as const;

/** Admin-only nav item labels (hidden in clinician mode). */
export const ADMIN_LABELS = ['Reports', 'Settings'] as const;

const STORAGE_KEY = 'clinician-mode';

/**
 * Read persisted clinician mode state from localStorage.
 * Returns false if localStorage is unavailable or key is absent.
 */
export function readPersistedState(storage?: Storage): boolean {
  try {
    const store = storage ?? globalThis.localStorage;
    return store?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Persist clinician mode state to localStorage.
 * Silently fails if localStorage is unavailable.
 */
export function persistState(enabled: boolean, storage?: Storage): void {
  try {
    const store = storage ?? globalThis.localStorage;
    if (enabled) {
      store?.setItem(STORAGE_KEY, '1');
    } else {
      store?.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable — ignore
  }
}
