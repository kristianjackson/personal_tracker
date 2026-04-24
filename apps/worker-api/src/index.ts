import { Hono } from 'hono';
import { webhook } from './routes/webhook';
import { handleQueueBatch } from './services/queue-consumer';

/**
 * Cloudflare Worker bindings.
 * Populated by wrangler.toml per-environment (dev / production).
 */
export interface Env {
  // ── Service bindings ──
  DB: D1Database;
  QUEUE: Queue;
  BUCKET: R2Bucket;
  KV: KVNamespace;

  // ── Environment variables (wrangler.toml [vars]) ──
  ENVIRONMENT: string;

  // ── Secrets (set via `wrangler secret put`) ──
  WHATSAPP_API_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_VERIFY_TOKEN: string;
  META_APP_SECRET: string;
}

export const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// Mount webhook routes
app.route('/webhook', webhook);

export default {
  fetch: app.fetch,
  queue: handleQueueBatch,
};
