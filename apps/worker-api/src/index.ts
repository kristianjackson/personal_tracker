import { Hono } from 'hono';

/**
 * Cloudflare Worker bindings.
 * Populated by wrangler.toml — actual binding configuration happens in Task 3.
 */
export interface Env {
  DB: D1Database;
  QUEUE: Queue;
  BUCKET: R2Bucket;
  KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

export default app;
