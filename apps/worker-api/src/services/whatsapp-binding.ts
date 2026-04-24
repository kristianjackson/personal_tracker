/**
 * WhatsApp binding service for phone-number-to-user mapping.
 *
 * Provides lookup, creation, and deactivation of WhatsApp phone number
 * bindings. Messages from a bound phone number are assigned to the
 * correct user via the whatsapp_binding table.
 *
 * Validates: FR-WA-002 (System shall identify the user by WhatsApp phone number binding.
 *            Messages from bound number are assigned to correct user.)
 * Design: Section 5.2 — whatsapp_binding table schema
 */

import type { WhatsAppBinding } from '@symptom-tracker/shared';
import { generateId, utcNow } from '@symptom-tracker/shared';

/** Parameters for creating a new WhatsApp binding. */
export interface CreateBindingParams {
  userId: string;
  phoneNumber: string;
}

/** Result of looking up a user by phone number. */
export interface BindingLookupResult {
  /** The binding record, or null if no active binding exists. */
  binding: WhatsAppBinding | null;
}

/**
 * Look up an active WhatsApp binding by phone number.
 *
 * Queries the whatsapp_binding table for a record matching the given
 * phone number where active=1.
 *
 * @param db - The D1 database binding.
 * @param phoneNumber - The WhatsApp phone number to look up.
 * @returns The active binding record, or null if none found.
 */
export async function findBindingByPhone(
  db: D1Database,
  phoneNumber: string,
): Promise<BindingLookupResult> {
  const result = await db
    .prepare(
      'SELECT id, user_id, phone_number, verified_at, active FROM whatsapp_binding WHERE phone_number = ? AND active = 1',
    )
    .bind(phoneNumber)
    .first<WhatsAppBinding>();

  return { binding: result ?? null };
}

/**
 * Create a new WhatsApp binding for a user.
 *
 * Inserts a new record into the whatsapp_binding table with active=1
 * and the current UTC timestamp as verified_at.
 *
 * @param db - The D1 database binding.
 * @param params - The user ID and phone number to bind.
 * @returns The newly created binding record.
 */
export async function createBinding(
  db: D1Database,
  params: CreateBindingParams,
): Promise<WhatsAppBinding> {
  const binding: WhatsAppBinding = {
    id: generateId(),
    user_id: params.userId,
    phone_number: params.phoneNumber,
    verified_at: utcNow(),
    active: 1,
  };

  await db
    .prepare(
      'INSERT INTO whatsapp_binding (id, user_id, phone_number, verified_at, active) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(
      binding.id,
      binding.user_id,
      binding.phone_number,
      binding.verified_at,
      binding.active,
    )
    .run();

  return binding;
}

/**
 * Deactivate a WhatsApp binding by its ID.
 *
 * Sets active=0 on the binding record. This soft-deletes the binding
 * so the phone number can be re-bound to a different user if needed.
 *
 * @param db - The D1 database binding.
 * @param bindingId - The ID of the binding to deactivate.
 * @returns True if a row was updated, false if no matching binding was found.
 */
export async function deactivateBinding(
  db: D1Database,
  bindingId: string,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE whatsapp_binding SET active = 0 WHERE id = ? AND active = 1')
    .bind(bindingId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}
