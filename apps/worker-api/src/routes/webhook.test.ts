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

function mockEnv(bucket?: R2Bucket, queue?: Queue) {
  return {
    WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    QUEUE: queue ?? mockQueue(),
    BUCKET: bucket ?? mockBucket(),
    KV: {} as KVNamespace,
  };
}

/** Create a mock Queue binding with a send() method. */
function mockQueue() {
  return {
    send: vi.fn(async () => undefined),
  } as unknown as Queue;
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
    const queue = mockQueue();
    const { ctx, flush } = mockExecutionCtx();

    const res = await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(bucket, queue),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('EVENT_RECEIVED');

    // Wait for background R2 storage and queue publish to complete
    await flush();

    // Verify R2 storage was triggered
    expect(bucket.head).toHaveBeenCalledOnce();
    expect(bucket.put).toHaveBeenCalledOnce();

    // Verify the key contains the message_id
    const putKey = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(putKey).toContain('wamid.test123');

    // Verify queue publish was triggered
    expect(queue.send).toHaveBeenCalledOnce();
    const sentMessage = (queue.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sentMessage.type).toBe('inbound-message');
    expect(sentMessage.messageId).toBe('wamid.test123');
    expect(sentMessage.rawBody).toBe(JSON.stringify(payload));
    expect(sentMessage.timestamp).toBeDefined();
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
    const queue = mockQueue();
    const { ctx, flush } = mockExecutionCtx();

    await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(bucket, queue),
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

    const queue = mockQueue();
    const { ctx, flush } = mockExecutionCtx();

    const res = await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(bucket, queue),
      ctx,
    );

    expect(res.status).toBe(200);
    await flush();

    // head was called but put was NOT called (dedup)
    expect(bucket.head).toHaveBeenCalledOnce();
    expect(bucket.put).not.toHaveBeenCalled();

    // Queue publish still happens (dedup is R2-only; queue consumer handles its own dedup)
    expect(queue.send).toHaveBeenCalledOnce();
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

    const queue = mockQueue();
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
      mockEnv(bucket, queue),
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

    // Queue publish still succeeded independently
    expect(queue.send).toHaveBeenCalledOnce();

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
    const queue = mockQueue();
    const { ctx, flush } = mockExecutionCtx();

    const res = await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(bucket, queue),
      ctx,
    );

    expect(res.status).toBe(200);
    await flush();

    // R2 put was called with a status-based fallback key
    expect(bucket.put).toHaveBeenCalledOnce();
    const putKey = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(putKey).toContain('status-status-entry-555');

    // Queue was also published with the same fallback message_id
    expect(queue.send).toHaveBeenCalledOnce();
    const sentMessage = (queue.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sentMessage.type).toBe('inbound-message');
    expect(sentMessage.messageId).toContain('status-status-entry-555');
  });

  it('returns 200 even when queue publish fails', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '333',
          changes: [
            {
              value: {
                messages: [{ id: 'wamid.qfail', type: 'text', text: { body: 'test' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const bucket = mockBucket();
    const queue = {
      send: vi.fn(async () => {
        throw new Error('Queue unavailable');
      }),
    } as unknown as Queue;

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
      mockEnv(bucket, queue),
      ctx,
    );

    // Response is 200 regardless of queue failure
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('EVENT_RECEIVED');

    // Background tasks complete without throwing
    await flush();

    // Queue error was logged
    expect(consoleSpy).toHaveBeenCalledWith(
      'Queue publish failed for webhook payload',
    );

    // R2 storage still succeeded independently
    expect(bucket.put).toHaveBeenCalledOnce();

    consoleSpy.mockRestore();
  });

  it('publishes to queue with correct message structure', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '444',
          changes: [
            {
              value: {
                messages: [{ id: 'wamid.struct', type: 'text', text: { body: 'hello' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const bucket = mockBucket();
    const queue = mockQueue();
    const { ctx, flush } = mockExecutionCtx();

    await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(bucket, queue),
      ctx,
    );

    await flush();

    expect(queue.send).toHaveBeenCalledOnce();
    const sentMessage = (queue.send as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Verify all required fields in the queue message
    expect(sentMessage).toEqual(
      expect.objectContaining({
        type: 'inbound-message',
        messageId: 'wamid.struct',
        rawBody: JSON.stringify(payload),
      }),
    );
    // Timestamp should be a valid ISO 8601 string
    expect(new Date(sentMessage.timestamp).toISOString()).toBe(sentMessage.timestamp);
  });

  it('both R2 storage and queue publishing happen in the background', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '555',
          changes: [
            {
              value: {
                messages: [{ id: 'wamid.both', type: 'text', text: { body: 'dual' } }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const bucket = mockBucket();
    const queue = mockQueue();
    const waitUntilCalls: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => {
        waitUntilCalls.push(p);
      },
      passThroughOnException: () => {},
    } as ExecutionContext;

    const res = await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(bucket, queue),
      ctx,
    );

    // Response returned before background tasks complete
    expect(res.status).toBe(200);

    // Two waitUntil calls: one for R2, one for Queue
    expect(waitUntilCalls.length).toBe(2);

    // Neither R2 nor Queue have been called yet (they're in promises)
    // Wait for them to complete
    await Promise.all(waitUntilCalls);

    // Now both should have been called
    expect(bucket.put).toHaveBeenCalledOnce();
    expect(queue.send).toHaveBeenCalledOnce();
  });
});
