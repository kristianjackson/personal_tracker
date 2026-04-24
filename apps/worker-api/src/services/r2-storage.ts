/**
 * R2 storage service for raw inbound message envelopes.
 *
 * Stores raw WhatsApp webhook payloads in R2 with a structured key path
 * and uses the WhatsApp message_id as an idempotency/dedup key.
 *
 * Validates: NFR-OPS-002 (idempotent using message_id as dedup key)
 * Validates: NFR-OPS-005 (preserve raw inbound message envelopes for 30 days)
 * Design: DD-002 (fast webhook ack, async processing - store raw envelope)
 * Design: DD-004 (R2 for artifacts only)
 */

/** Result of attempting to store a raw message envelope. */
export interface StoreResult {
  /** Whether the message was newly stored (true) or already existed (false). */
  stored: boolean;
  /** The R2 key used for storage. */
  key: string;
  /** Whether this was a duplicate message. */
  duplicate: boolean;
}

/** 30 days in milliseconds. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Build a structured R2 key path for a raw message envelope.
 *
 * Format: `raw-messages/{YYYY}/{MM}/{DD}/{messageId}.json`
 *
 * @param messageId - The WhatsApp message_id or composite fallback key.
 * @param now - The current date (defaults to new Date()).
 */
export function buildR2Key(messageId: string, now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `raw-messages/${yyyy}/${mm}/${dd}/${messageId}.json`;
}

/**
 * Extract the primary message_id from a WhatsApp webhook payload.
 *
 * Looks for `entry[].changes[].value.messages[].id`. If no messages are
 * present (e.g. status-only webhooks), falls back to a composite key
 * based on the entry ID and current timestamp.
 *
 * @param payload - The parsed WhatsApp webhook JSON body.
 * @returns The message_id string to use as the dedup key.
 */
export function extractMessageId(payload: Record<string, unknown>): string {
  try {
    const entries = payload.entry as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const changes = entry.changes as
          | Array<Record<string, unknown>>
          | undefined;
        if (Array.isArray(changes)) {
          for (const change of changes) {
            const value = change.value as Record<string, unknown> | undefined;
            if (value) {
              const messages = value.messages as
                | Array<Record<string, unknown>>
                | undefined;
              if (Array.isArray(messages) && messages.length > 0) {
                const id = messages[0].id;
                if (typeof id === 'string' && id.length > 0) {
                  return id;
                }
              }
            }
          }
        }
        // Fallback: use entry id if available
        const entryId = entry.id;
        if (typeof entryId === 'string' && entryId.length > 0) {
          return `status-${entryId}-${Date.now()}`;
        }
      }
    }
  } catch {
    // Fall through to timestamp-based fallback
  }

  // Ultimate fallback: timestamp-based key
  return `unknown-${Date.now()}`;
}

/**
 * Store a raw inbound message envelope to R2.
 *
 * Uses HEAD to check for an existing object with the same key (dedup).
 * Sets `expires_at` in custom metadata for future cleanup jobs.
 *
 * @param bucket - The R2 bucket binding.
 * @param messageId - The dedup key (WhatsApp message_id or fallback).
 * @param rawBody - The raw JSON string of the webhook payload.
 * @param now - The current date (for key path and TTL calculation).
 * @returns A StoreResult indicating whether the message was stored or deduplicated.
 */
export async function storeRawEnvelope(
  bucket: R2Bucket,
  messageId: string,
  rawBody: string,
  now: Date = new Date(),
): Promise<StoreResult> {
  const key = buildR2Key(messageId, now);

  // Check for existing object (dedup via HEAD request)
  const existing = await bucket.head(key);
  if (existing !== null) {
    return { stored: false, key, duplicate: true };
  }

  // Calculate expiry timestamp (30 days from now)
  const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();

  await bucket.put(key, rawBody, {
    httpMetadata: {
      contentType: 'application/json',
    },
    customMetadata: {
      expires_at: expiresAt,
      message_id: messageId,
      stored_at: now.toISOString(),
    },
  });

  return { stored: true, key, duplicate: false };
}
