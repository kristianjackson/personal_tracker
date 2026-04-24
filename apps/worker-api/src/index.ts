import { Hono } from 'hono';

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
}

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

export default app;
