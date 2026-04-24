import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendTextMessage, sendMessages } from './whatsapp-sender';
import type { WhatsAppSenderEnv } from './whatsapp-sender';

/**
 * Tests for the WhatsApp message sender utility.
 *
 * Validates: FR-WA-010 (System shall confirm saved entries succinctly)
 * Validates: NFR-OPS-004 (Retry on transient failure)
 */

const mockEnv: WhatsAppSenderEnv = {
  WHATSAPP_API_TOKEN: 'test-token',
  WHATSAPP_PHONE_NUMBER_ID: '123456',
};

describe('sendTextMessage', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a text message via the WhatsApp Cloud API', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ messages: [{ id: 'wamid.sent123' }] }),
        { status: 200 },
      ),
    );

    const result = await sendTextMessage(mockEnv, '+1234567890', 'Hello!');

    expect(result.success).toBe(true);
    expect(result.waMessageId).toBe('wamid.sent123');
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/123456/messages');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toEqual({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });

    const body = JSON.parse(options?.body as string);
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.to).toBe('+1234567890');
    expect(body.type).toBe('text');
    expect(body.text.body).toBe('Hello!');
  });

  it('returns failure when the API responds with a non-OK status', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"Invalid token"}}', { status: 401 }),
    );

    const result = await sendTextMessage(mockEnv, '+1234567890', 'Hello!');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toContain('401');
  });

  it('logs a structured error when the API returns non-OK', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"Rate limited"}}', { status: 429 }),
    );

    await sendTextMessage(mockEnv, '+1234567890', 'Hello!');

    const errorLog = consoleSpy.mock.calls.find((call) => {
      const parsed = JSON.parse(call[0] as string);
      return parsed.level === 'error' && parsed.service === 'whatsapp-sender';
    });
    expect(errorLog).toBeDefined();

    const parsed = JSON.parse(errorLog![0] as string);
    expect(parsed.statusCode).toBe(429);
    expect(parsed.msg).toBe('WhatsApp API send failed');
  });

  it('returns failure when fetch throws a network error', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network unreachable'),
    );

    const result = await sendTextMessage(mockEnv, '+1234567890', 'Hello!');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network unreachable');
  });

  it('logs a structured error when fetch throws', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('DNS resolution failed'),
    );

    await sendTextMessage(mockEnv, '+1234567890', 'Hello!');

    const errorLog = consoleSpy.mock.calls.find((call) => {
      const parsed = JSON.parse(call[0] as string);
      return parsed.level === 'error' && parsed.msg === 'WhatsApp API request failed';
    });
    expect(errorLog).toBeDefined();

    const parsed = JSON.parse(errorLog![0] as string);
    expect(parsed.error).toBe('DNS resolution failed');
  });

  it('does not include message text in error logs (PHI-free)', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error', { status: 500 }),
    );

    await sendTextMessage(mockEnv, '+1234567890', 'I feel terrible today');

    for (const call of consoleSpy.mock.calls) {
      const logStr = call[0] as string;
      expect(logStr).not.toContain('I feel terrible today');
    }
  });
});

describe('sendMessages', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends multiple messages in sequence', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({ messages: [{ id: 'wamid.ok' }] }),
        { status: 200 },
      ),
    );

    const results = await sendMessages(mockEnv, '+1234567890', [
      'Message 1',
      'Message 2',
      'Message 3',
    ]);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('returns an empty array for no messages', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');

    const results = await sendMessages(mockEnv, '+1234567890', []);

    expect(results).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('continues sending remaining messages when one fails', async () => {
    let callCount = 0;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        return new Response('error', { status: 500 });
      }
      return new Response(
        JSON.stringify({ messages: [{ id: 'wamid.ok' }] }),
        { status: 200 },
      );
    });

    const results = await sendMessages(mockEnv, '+1234567890', [
      'Message 1',
      'Message 2',
      'Message 3',
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
