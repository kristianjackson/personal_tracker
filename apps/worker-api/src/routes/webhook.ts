import { Hono } from 'hono';
import type { Env } from '../index';
import { extractMessageId, storeRawEnvelope } from '../services/r2-storage';
import { publishToQueue } from '../services/queue-publisher';

const webhook = new Hono<{ Bindings: Env }>();

/**
 * GET /webhook — Meta webhook verification (subscription verification).
 *
 * Meta sends a GET request with query params:
 *   hub.mode, hub.verify_token, hub.challenge
 *
 * If hub.mode === 'subscribe' and hub.verify_token matches the stored
 * WEBHOOK_VERIFY_TOKEN secret, return 200 with hub.challenge as plain text.
 * Otherwise return 403.
 *
 * Validates: FR-WA-001, NFR-OPS-001
 */
webhook.get('/', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (
    mode === 'subscribe' &&
    token &&
    token === c.env.WEBHOOK_VERIFY_TOKEN &&
    challenge
  ) {
    return c.text(challenge, 200);
  }

  return c.text('Forbidden', 403);
});

/**
 * POST /webhook — Inbound message reception.
 *
 * Accepts the POST body from Meta's webhook and returns 200 immediately
 * to acknowledge receipt (fast-ack pattern, < 200ms).
 *
 * Uses waitUntil() to persist the raw envelope to R2 and publish to
 * Cloudflare Queue in the background after the 200 response is sent.
 * This maintains the fast-ack pattern from DD-002 while fulfilling
 * NFR-OPS-005 (30-day raw envelope retention) and NFR-OPS-001 (async
 * processing via Queue).
 *
 * R2 and Queue failures are logged but do not affect the webhook response.
 * No PHI is logged (NFR-SEC-005) — only message IDs and error codes.
 *
 * Validates: FR-WA-001, NFR-OPS-001, NFR-OPS-002, NFR-OPS-004, NFR-OPS-005, DD-002
 */
webhook.post('/', async (c) => {
  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.text('EVENT_RECEIVED', 200);
  }

  // Parse payload and extract message_id once for both R2 and Queue
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const messageId = extractMessageId(payload);

  // Schedule background tasks via waitUntil (after 200 response)
  let ctx: ExecutionContext | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    // executionCtx may not be available in test environments
  }
  if (ctx && typeof ctx.waitUntil === 'function') {
    // R2 storage — raw envelope archive (NFR-OPS-005)
    ctx.waitUntil(
      (async () => {
        try {
          await storeRawEnvelope(c.env.BUCKET, messageId, rawBody);
        } catch {
          console.error('R2 storage failed for webhook payload');
        }
      })(),
    );

    // Queue publish — async processing (NFR-OPS-001, DD-002)
    ctx.waitUntil(
      (async () => {
        try {
          await publishToQueue(c.env.QUEUE, messageId, rawBody);
        } catch {
          console.error('Queue publish failed for webhook payload');
        }
      })(),
    );
  }

  return c.text('EVENT_RECEIVED', 200);
});

export { webhook };
