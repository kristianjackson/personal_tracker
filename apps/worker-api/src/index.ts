import { Hono } from 'hono';
import { webhook } from './routes/webhook';

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
  WEBHOOK_VERIFY_TOKEN: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// Mount webhook routes
app.route('/webhook', webhook);

export default app;
