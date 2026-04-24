import { Hono } from 'hono';
import type { Env } from '../index';

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
 * Actual message processing (R2 storage, queue publishing) is handled
 * in subsequent tasks (Tasks 8 and 9).
 *
 * Validates: FR-WA-001, NFR-OPS-001, DD-002
 */
webhook.post('/', (c) => {
  return c.text('EVENT_RECEIVED', 200);
});

export { webhook };
