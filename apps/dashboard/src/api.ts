/**
 * API base URL helper.
 *
 * In local dev, Vite proxies /api/* to the Worker (see vite.config.ts).
 * In production, set VITE_API_BASE to the Worker URL (e.g.
 * "https://symptom-tracker-api.your-subdomain.workers.dev").
 * If unset, requests use relative paths (works when Pages and Worker
 * share the same domain or a proxy is in place).
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/** Build a full API URL from a relative path like "/api/overview?start=...". */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
