/**
 * Audit event writer and query utility.
 *
 * Provides functions to write and query audit events in the D1 audit_event
 * table. Audit events track security-relevant actions such as login, export,
 * config changes, summary generation, data deletion, and flag dismissal.
 *
 * Validates: NFR-SEC-008 (System shall log audit events for auth, exports,
 *            config changes, summary generation, and deletions. Audit records
 *            stored in D1 and queryable via API.)
 * Validates: NFR-SEC-005 (Operational telemetry shall exclude PHI — the detail
 *            JSON field must NOT contain PHI such as freeform notes, symptom
 *            text, or personally identifiable health information.)
 * Design: Section 5.13 — audit_event table schema
 * Design: Section 9.5 — Audit trail
 */

import type { AuditAction, AuditEvent } from '@symptom-tracker/shared';
import { generateId, utcNow } from '@symptom-tracker/shared';

/**
 * Input for writing an audit event.
 *
 * **Important:** The `detail` field must NOT contain PHI (Protected Health
 * Information). Only include operational metadata such as resource IDs,
 * action codes, counts, and configuration keys. Never include freeform
 * notes, symptom text, or personally identifiable health information.
 */
export interface AuditEventInput {
  /** The user who performed the action. Null for system-level events. */
  userId?: string;
  /** The type of auditable action. */
  action: AuditAction;
  /**
   * Optional structured detail about the action (serialized as JSON).
   * Must NOT contain PHI — only IDs, codes, counts, and config keys.
   */
  detail?: Record<string, unknown>;
  /** The IP address of the request origin, if available. */
  ipAddress?: string;
}

/** Options for querying audit events. */
export interface QueryAuditOptions {
  /** Filter by user ID. */
  userId?: string;
  /** Filter by action type. */
  action?: AuditAction;
  /** Maximum number of results to return (default: 50). */
  limit?: number;
  /** Number of results to skip for pagination (default: 0). */
  offset?: number;
}

/**
 * Write an audit event to the D1 audit_event table.
 *
 * Generates a ULID for the id, sets created_at to the current UTC time,
 * and serializes the detail object as a JSON string.
 *
 * @param db - The D1 database binding.
 * @param input - The audit event data to write.
 */
export async function writeAuditEvent(
  db: D1Database,
  input: AuditEventInput,
): Promise<void> {
  const id = generateId();
  const createdAt = utcNow();
  const detailJson = input.detail ? JSON.stringify(input.detail) : null;

  await db
    .prepare(
      'INSERT INTO audit_event (id, user_id, action, detail, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      input.userId ?? null,
      input.action,
      detailJson,
      input.ipAddress ?? null,
      createdAt,
    )
    .run();
}

/**
 * Query audit events from the D1 audit_event table.
 *
 * Supports filtering by user ID and action type, with pagination via
 * limit and offset. Results are ordered by created_at descending
 * (most recent first).
 *
 * @param db - The D1 database binding.
 * @param options - Query filters and pagination options.
 * @returns An array of audit event records.
 */
export async function queryAuditEvents(
  db: D1Database,
  options: QueryAuditOptions = {},
): Promise<AuditEvent[]> {
  const { userId, action, limit = 50, offset = 0 } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (userId !== undefined) {
    conditions.push('user_id = ?');
    params.push(userId);
  }

  if (action !== undefined) {
    conditions.push('action = ?');
    params.push(action);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `SELECT id, user_id, action, detail, ip_address, created_at FROM audit_event ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;

  params.push(limit, offset);

  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<AuditEvent>();

  return result.results ?? [];
}
