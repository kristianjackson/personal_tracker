import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../index';

const VERIFY_TOKEN = 'test-verify-token-secret';

/**
 * Helper to build a mock env with the required bindings.
 * Only WEBHOOK_VERIFY_TOKEN is needed for webhook tests.
 */
function mockBucket() {
  return {
    head: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    get: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

function mockEnv(bucket?: R2Bucket) {
  return {
    WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    QUEUE: {} as Queue,
    BUCKET: bucket ?? mockBucket(),
    KV: {} as KVNamespace,
  };
}

/**
 * Create a mock execution context with a working waitUntil.
 * Collects all promises passed to waitUntil so tests can await them.
 */
function mockExecutionCtx() {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => {
        promises.push(p);
      },
      passThroughOnException: () => {},
    } as ExecutionContext,
    /** Await all background tasks scheduled via waitUntil. */
    flush: () => Promise.all(promises),
  };
}

describe('GET /webhook — Meta verification challenge', () => {
  it('returns 200 with challenge when mode, token, and challenge are valid', async () => {
    const url = new URL('http://localhost/webhook');
    url.searchParams.set('hub.mode', 'subscribe');
    url.searchParams.set('hub.verify_token', VERIFY_TOKEN);
    url.searchParams.set('hub.challenge', 'challenge_abc_123');

    const res = await app.request(url.toString(), { method: 'GET' }, mockEnv());

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('challenge_abc_123');
  });

  it('returns 403 when verify token does not match', async () => {
    const url = new URL('http://localhost/webhook');
    url.searchParams.set('hub.mode', 'subscribe');
    url.searchParams.set('hub.verify_token', 'wrong-token');
    url.searchParams.set('hub.challenge', 'challenge_abc_123');

    const res = await app.request(url.toString(), { method: 'GET' }, mockEnv());

    expect(res.status).toBe(403);
  });

  it('returns 403 when hub.mode is not subscribe', async () => {
    const url = new URL('http://localhost/webhook');
    url.searchParams.set('hub.mode', 'unsubscribe');
    url.searchParams.set('hub.verify_token', VERIFY_TOKEN);
    url.searchParams.set('hub.challenge', 'challenge_abc_123');

    const res = await app.request(url.toString(), { method: 'GET' }, mockEnv());

    expect(res.status).toBe(403);
  });

  it('returns 403 when hub.mode is missing', async () => {
    const url = new URL('http://localhost/webhook');
    url.searchParams.set('hub.verify_token', VERIFY_TOKEN);
    url.searchParams.set('hub.challenge', 'challenge_abc_123');

    const res = await app.request(url.toString(), { method: 'GET' }, mockEnv());

    expect(res.status).toBe(403);
  });

  it('returns 403 when hub.verify_token is missing', async () => {
    const url = new URL('http://localhost/webhook');
    url.searchParams.set('hub.mode', 'subscribe');
    url.searchParams.set('hub.challenge', 'challenge_abc_123');

    const res = await app.request(url.toString(), { method: 'GET' }, mockEnv());

    expect(res.status).toBe(403);
  });

  it('returns 403 when hub.challenge is missing', async () => {
    const url = new URL('http://localhost/webhook');
    url.searchParams.set('hub.mode', 'subscribe');
    url.searchParams.set('hub.verify_token', VERIFY_TOKEN);

    const res = await app.request(url.toString(), { method: 'GET' }, mockEnv());

    expect(res.status).toBe(403);
  });

  it('returns 403 when all query params are missing', async () => {
    const res = await app.request(
      'http://localhost/webhook',
      { method: 'GET' },
      mockEnv(),
    );

    expect(res.status).toBe(403);
  });
});

describe('POST /webhook — Inbound message reception', () => {
  it('returns 200 for a valid JSON payload', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456',
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '15551234567',
                    id: 'wamid.test123',
                    type: 'text',
                    text: { body: 'checkin' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const bucket = mockBucket();
    const { ctx, flush } = mockExecutionCtx();

    const res = await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(bucket),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('EVENT_RECEIVED');

    // Wait for background R2 storage to complete
    await flush();

    // Verify R2 storage was triggered
    expect(bucket.head).toHaveBeenCalledOnce();
    expect(bucket.put).toHaveBeenCalledOnce();

    // Verify the key contains the message_id
    const putKey = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(putKey).toContain('wamid.test123');
  });

  it('returns 200 quickly (fast-ack pattern)', async () => {
    const payload = { object: 'whatsapp_business_account', entry: [] };

    const start = performance.now();
    const res = await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(),
    );
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    // The handler should respond well under 200ms since it does no async work
    expect(elapsed).toBeLessThan(200);
  });

  it('stores raw envelope to R2 via waitUntil', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '999',
          changes: [
            {
              value: {
                messages: [{ id: 'wamid.r2test', type: 'text', text: { body: 'hello' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const bucket = mockBucket();
    const { ctx, flush } = mockExecutionCtx();

    await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(bucket),
      ctx,
    );

    await flush();

    // Verify R2 put was called with the raw body
    expect(bucket.put).toHaveBeenCalledOnce();
    const [key, body, options] = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toContain('wamid.r2test');
    expect(key).toMatch(/^raw-messages\/\d{4}\/\d{2}\/\d{2}\/wamid\.r2test\.json$/);
    expect(body).toBe(JSON.stringify(payload));
    expect(options.httpMetadata.contentType).toBe('application/json');
    expect(options.customMetadata.message_id).toBe('wamid.r2test');
    expect(options.customMetadata.expires_at).toBeDefined();
  });

  it('skips R2 put for duplicate messages', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '111',
          changes: [
            {
              value: {
                messages: [{ id: 'wamid.dup', type: 'text', text: { body: 'hi' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    // Bucket where head() returns an existing object
    const bucket = {
      head: vi.fn(async () => ({ key: 'exists' })),
      put: vi.fn(async () => undefined),
    } as unknown as R2Bucket;

    const { ctx, flush } = mockExecutionCtx();

    const res = await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(bucket),
      ctx,
    );

    expect(res.status).toBe(200);
    await flush();

    // head was called but put was NOT called (dedup)
    expect(bucket.head).toHaveBeenCalledOnce();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('returns 200 even when R2 storage fails', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '222',
          changes: [
            {
              value: {
                messages: [{ id: 'wamid.fail', type: 'text', text: { body: 'test' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const bucket = {
      head: vi.fn(async () => {
        throw new Error('R2 unavailable');
      }),
      put: vi.fn(),
    } as unknown as R2Bucket;

    const { ctx, flush } = mockExecutionCtx();

    // Suppress console.error during this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(bucket),
      ctx,
    );

    // Response is 200 regardless of R2 failure
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('EVENT_RECEIVED');

    // Background task completes without throwing
    await flush();

    // Error was logged
    expect(consoleSpy).toHaveBeenCalledWith(
      'R2 storage failed for webhook payload',
    );

    consoleSpy.mockRestore();
  });

  it('handles status-only payloads (no messages) gracefully', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'status-entry-555',
          changes: [
            {
              value: {
                statuses: [{ id: 'wamid.s1', status: 'delivered' }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const bucket = mockBucket();
    const { ctx, flush } = mockExecutionCtx();

    const res = await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(bucket),
      ctx,
    );

    expect(res.status).toBe(200);
    await flush();

    // R2 put was called with a status-based fallback key
    expect(bucket.put).toHaveBeenCalledOnce();
    const putKey = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(putKey).toContain('status-status-entry-555');
  });
});
