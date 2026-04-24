import { describe, it, expect } from 'vitest';
import app from '../index';

const VERIFY_TOKEN = 'test-verify-token-secret';

/**
 * Helper to build a mock env with the required bindings.
 * Only WEBHOOK_VERIFY_TOKEN is needed for webhook tests.
 */
function mockEnv() {
  return {
    WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    QUEUE: {} as Queue,
    BUCKET: {} as R2Bucket,
    KV: {} as KVNamespace,
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

    const res = await app.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      mockEnv(),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('EVENT_RECEIVED');
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
});
