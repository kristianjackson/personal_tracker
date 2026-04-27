import { Hono } from 'hono';
import { webhook } from './routes/webhook';
import { apiRoutes } from './routes/api';
import { accessAuth } from './middleware/access-auth';
import { handleQueueBatch } from './services/queue-consumer';
import { handleScheduledEvent } from './services/prompt-scheduler';

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

  // ── Cloudflare Access configuration (wrangler.toml [vars]) ──
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;

  // ── Secrets (set via `wrangler secret put`) ──
  WHATSAPP_API_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_VERIFY_TOKEN: string;
  META_APP_SECRET: string;
}

export const app = new Hono<{ Bindings: Env; Variables: { userEmail: string } }>();

// ── Public routes (no auth required) ────────────────────────────────

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// Mount webhook routes (authenticated by Meta's webhook verification, not Access)
app.route('/webhook', webhook);

// ── Protected API routes (Cloudflare Access JWT required) ───────────

const api = new Hono<{ Bindings: Env; Variables: { userEmail: string } }>();
api.use('*', accessAuth);

// Mount dashboard API endpoints (Task 29)
api.route('/', apiRoutes);

app.route('/api', api);

export default {
  fetch: app.fetch,
  queue: handleQueueBatch,
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(handleScheduledEvent(env));
  },
};
