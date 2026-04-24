import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildR2Key,
  extractMessageId,
  storeRawEnvelope,
} from './r2-storage';

/**
 * Tests for R2 raw message envelope storage service.
 *
 * Validates: NFR-OPS-002 (idempotent using message_id as dedup key)
 * Validates: NFR-OPS-005 (preserve raw inbound message envelopes for 30 days)
 */

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a mock R2Bucket with head() and put() methods. */
function mockBucket(existingKeys: Set<string> = new Set()) {
  return {
    head: vi.fn(async (key: string) => {
      return existingKeys.has(key) ? { key } : null;
    }),
    put: vi.fn(async () => undefined),
  } as unknown as R2Bucket;
}

/** A sample WhatsApp webhook payload with a message. */
function sampleMessagePayload(messageId = 'wamid.abc123') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123456',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '111' },
              messages: [
                {
                  from: '15551234567',
                  id: messageId,
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
}

/** A sample WhatsApp webhook payload with only status updates (no messages). */
function sampleStatusPayload(entryId = '789012') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: entryId,
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '111' },
              statuses: [
                {
                  id: 'wamid.status456',
                  status: 'delivered',
                  timestamp: '1700000000',
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

// ── buildR2Key ───────────────────────────────────────────────────────

describe('buildR2Key', () => {
  it('generates a key with correct date structure', () => {
    const date = new Date('2025-03-15T10:30:00Z');
    const key = buildR2Key('wamid.abc123', date);
    expect(key).toBe('raw-messages/2025/03/15/wamid.abc123.json');
  });

  it('pads single-digit months and days', () => {
    const date = new Date('2025-01-05T08:00:00Z');
    const key = buildR2Key('msg-001', date);
    expect(key).toBe('raw-messages/2025/01/05/msg-001.json');
  });

  it('handles end-of-year dates', () => {
    const date = new Date('2025-12-31T23:59:59Z');
    const key = buildR2Key('msg-eoy', date);
    expect(key).toBe('raw-messages/2025/12/31/msg-eoy.json');
  });
});

// ── extractMessageId ─────────────────────────────────────────────────

describe('extractMessageId', () => {
  it('extracts message_id from a standard WhatsApp message payload', () => {
    const payload = sampleMessagePayload('wamid.HBgLMTU1NTEyMzQ1NjcVAgA');
    const id = extractMessageId(payload);
    expect(id).toBe('wamid.HBgLMTU1NTEyMzQ1NjcVAgA');
  });

  it('extracts the first message_id when multiple messages exist', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            {
              value: {
                messages: [
                  { id: 'first-msg', type: 'text' },
                  { id: 'second-msg', type: 'text' },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    expect(extractMessageId(payload)).toBe('first-msg');
  });

  it('returns a status-based fallback for status-only payloads', () => {
    const payload = sampleStatusPayload('entry-789');
    const id = extractMessageId(payload);
    expect(id).toMatch(/^status-entry-789-\d+$/);
  });

  it('returns an unknown fallback for empty payloads', () => {
    const id = extractMessageId({});
    expect(id).toMatch(/^unknown-\d+$/);
  });

  it('returns an unknown fallback for payloads with empty entry array', () => {
    const id = extractMessageId({ entry: [] });
    expect(id).toMatch(/^unknown-\d+$/);
  });

  it('handles payloads where messages array is empty', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-empty-msgs',
          changes: [{ value: { messages: [] }, field: 'messages' }],
        },
      ],
    };
    const id = extractMessageId(payload);
    expect(id).toMatch(/^status-entry-empty-msgs-\d+$/);
  });

  it('handles malformed payload gracefully', () => {
    const id = extractMessageId({ entry: 'not-an-array' } as unknown as Record<string, unknown>);
    expect(id).toMatch(/^unknown-\d+$/);
  });
});

// ── storeRawEnvelope ─────────────────────────────────────────────────

describe('storeRawEnvelope', () => {
  const fixedDate = new Date('2025-06-10T14:30:00Z');

  it('stores a new message envelope and returns stored=true', async () => {
    const bucket = mockBucket();
    const rawBody = JSON.stringify(sampleMessagePayload());

    const result = await storeRawEnvelope(
      bucket,
      'wamid.abc123',
      rawBody,
      fixedDate,
    );

    expect(result.stored).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.key).toBe('raw-messages/2025/06/10/wamid.abc123.json');

    // Verify head was called for dedup check
    expect(bucket.head).toHaveBeenCalledWith(
      'raw-messages/2025/06/10/wamid.abc123.json',
    );

    // Verify put was called with correct args
    expect(bucket.put).toHaveBeenCalledWith(
      'raw-messages/2025/06/10/wamid.abc123.json',
      rawBody,
      expect.objectContaining({
        httpMetadata: { contentType: 'application/json' },
        customMetadata: expect.objectContaining({
          message_id: 'wamid.abc123',
          stored_at: '2025-06-10T14:30:00.000Z',
        }),
      }),
    );
  });

  it('sets expires_at metadata to 30 days from storage time', async () => {
    const bucket = mockBucket();
    const rawBody = JSON.stringify(sampleMessagePayload());

    await storeRawEnvelope(bucket, 'wamid.abc123', rawBody, fixedDate);

    const putCall = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0];
    const metadata = putCall[2].customMetadata;
    const expiresAt = new Date(metadata.expires_at);
    const expectedExpiry = new Date('2025-07-10T14:30:00.000Z');
    expect(expiresAt.getTime()).toBe(expectedExpiry.getTime());
  });

  it('skips storage for duplicate message_id (dedup)', async () => {
    const existingKey = 'raw-messages/2025/06/10/wamid.abc123.json';
    const bucket = mockBucket(new Set([existingKey]));
    const rawBody = JSON.stringify(sampleMessagePayload());

    const result = await storeRawEnvelope(
      bucket,
      'wamid.abc123',
      rawBody,
      fixedDate,
    );

    expect(result.stored).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(result.key).toBe(existingKey);

    // head was called but put was NOT called
    expect(bucket.head).toHaveBeenCalledOnce();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('propagates R2 errors from head()', async () => {
    const bucket = {
      head: vi.fn(async () => {
        throw new Error('R2 unavailable');
      }),
      put: vi.fn(),
    } as unknown as R2Bucket;

    await expect(
      storeRawEnvelope(bucket, 'wamid.fail', '{}', fixedDate),
    ).rejects.toThrow('R2 unavailable');
  });

  it('propagates R2 errors from put()', async () => {
    const bucket = {
      head: vi.fn(async () => null),
      put: vi.fn(async () => {
        throw new Error('R2 write failed');
      }),
    } as unknown as R2Bucket;

    await expect(
      storeRawEnvelope(bucket, 'wamid.fail', '{}', fixedDate),
    ).rejects.toThrow('R2 write failed');
  });
});
