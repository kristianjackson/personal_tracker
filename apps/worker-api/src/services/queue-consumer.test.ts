import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleQueueBatch, extractTextFromPayload } from './queue-consumer';
import type { InboundQueueMessage, QueueMessageType } from './queue-publisher';
import type { Env } from '../index';
import fc from 'fast-check';

/**
 * Tests for the queue consumer service.
 *
 * Validates: NFR-OPS-004 (retry on transient failure with exponential backoff, dead-letter after 3 attempts)
 * Validates: NFR-OPS-006 (core services observable — errors, queue failures visible)
 * Validates: NFR-SEC-005 (no PHI in logs)
 */

// ── Test helpers ────────────────────────────────────────────────────

function createQueueMessage(
  body: InboundQueueMessage,
): Message<InboundQueueMessage> {
  return {
    body,
    id: `msg-${body.messageId}`,
    timestamp: new Date(),
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  } as unknown as Message<InboundQueueMessage>;
}

function createBatch(
  messages: Message<InboundQueueMessage>[],
  queue = 'symptom-tracker-queue',
): MessageBatch<InboundQueueMessage> {
  return {
    queue,
    messages,
  } as unknown as MessageBatch<InboundQueueMessage>;
}

function makeBody(
  type: string,
  messageId = 'wamid.test123',
): InboundQueueMessage {
  // For scheduled-prompt messages, provide a valid ScheduledPromptBody
  const rawBody =
    type === 'scheduled-prompt'
      ? JSON.stringify({
          scheduleId: 'daily-checkin',
          scheduleName: 'Daily Check-in Prompt',
          scheduleType: 'daily',
          userId: 'user-1',
          phoneNumber: '+1234567890',
          localTime: '09:00',
          timezone: 'UTC',
        })
      : '{}';

  return {
    type: type as QueueMessageType,
    messageId,
    rawBody,
    timestamp: '2025-06-10T14:30:00.000Z',
  };
}

const mockEnv = {
  WHATSAPP_API_TOKEN: 'test-token',
  WHATSAPP_PHONE_NUMBER_ID: '123456',
  KV: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  },
} as unknown as Env;
const mockCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

// ── Tests ───────────────────────────────────────────────────────────

describe('handleQueueBatch', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Message routing by type ─────────────────────────────────────

  describe('message routing', () => {
    const messageTypes: QueueMessageType[] = [
      'inbound-message',
      'scheduled-prompt',
      'report-generate',
      'analytics-refresh',
    ];

    it.each(messageTypes)(
      'routes "%s" messages to the correct handler and acks',
      async (type) => {
        const msg = createQueueMessage(makeBody(type));
        const batch = createBatch([msg]);

        await handleQueueBatch(batch, mockEnv, mockCtx);

        expect(msg.ack).toHaveBeenCalledOnce();
        expect(msg.retry).not.toHaveBeenCalled();
      },
    );
  });

  // ── Successful messages are acked ───────────────────────────────

  describe('ack on success', () => {
    it('acks a successfully processed message', async () => {
      const msg = createQueueMessage(makeBody('inbound-message'));
      const batch = createBatch([msg]);

      await handleQueueBatch(batch, mockEnv, mockCtx);

      expect(msg.ack).toHaveBeenCalledOnce();
      expect(msg.retry).not.toHaveBeenCalled();
    });
  });

  // ── Failed messages trigger retry ───────────────────────────────

  describe('retry on failure', () => {
    it('calls retry() when a handler throws', async () => {
      const msg = createQueueMessage(makeBody('inbound-message'));
      const batch = createBatch([msg]);

      // Temporarily make the handler throw by injecting a bad body
      // that causes an error in processing. We'll mock console.log
      // to throw on the handler's log call to simulate a processing error.
      const originalLog = console.log;
      let callCount = 0;
      consoleSpy.mockImplementation((...args: unknown[]) => {
        callCount++;
        // The first call is the "batch received" log, the second is the
        // handler's stub log — throw on the handler log to simulate failure.
        if (callCount === 2) {
          throw new Error('Simulated processing failure');
        }
      });

      await handleQueueBatch(batch, mockEnv, mockCtx);

      expect(msg.retry).toHaveBeenCalledOnce();
      expect(msg.ack).not.toHaveBeenCalled();
    });
  });

  // ── Unknown message types ───────────────────────────────────────

  describe('unknown message types', () => {
    it('acks unknown message types to prevent infinite retry loops', async () => {
      const msg = createQueueMessage(
        makeBody('unknown-type' as QueueMessageType),
      );
      const batch = createBatch([msg]);

      await handleQueueBatch(batch, mockEnv, mockCtx);

      expect(msg.ack).toHaveBeenCalledOnce();
      expect(msg.retry).not.toHaveBeenCalled();
    });

    it('logs a warning for unknown message types', async () => {
      const msg = createQueueMessage(
        makeBody('unknown-type' as QueueMessageType),
      );
      const batch = createBatch([msg]);

      await handleQueueBatch(batch, mockEnv, mockCtx);

      const warningLog = consoleSpy.mock.calls.find((call) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.level === 'warn';
      });
      expect(warningLog).toBeDefined();

      const parsed = JSON.parse(warningLog![0] as string);
      expect(parsed.type).toBe('unknown-type');
      expect(parsed.msg).toContain('Unknown');
    });
  });

  // ── Structured logging (no PHI) ─────────────────────────────────

  describe('structured logging', () => {
    it('logs batch received with queue name and batch size', async () => {
      const msg = createQueueMessage(makeBody('inbound-message'));
      const batch = createBatch([msg], 'test-queue');

      await handleQueueBatch(batch, mockEnv, mockCtx);

      const batchLog = consoleSpy.mock.calls.find((call) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.msg === 'Queue batch received';
      });
      expect(batchLog).toBeDefined();

      const parsed = JSON.parse(batchLog![0] as string);
      expect(parsed.queue).toBe('test-queue');
      expect(parsed.batchSize).toBe(1);
    });

    it('logs batch completion with success/failure counts', async () => {
      const msg = createQueueMessage(makeBody('inbound-message'));
      const batch = createBatch([msg]);

      await handleQueueBatch(batch, mockEnv, mockCtx);

      const completeLog = consoleSpy.mock.calls.find((call) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.msg === 'Queue batch processing complete';
      });
      expect(completeLog).toBeDefined();

      const parsed = JSON.parse(completeLog![0] as string);
      expect(parsed.succeeded).toBe(1);
      expect(parsed.failed).toBe(0);
    });

    it('does not include rawBody or PHI in any log output', async () => {
      const body = makeBody('inbound-message');
      body.rawBody = JSON.stringify({
        sensitive: 'patient symptom data',
        note: 'feeling terrible today',
      });
      const msg = createQueueMessage(body);
      const batch = createBatch([msg]);

      await handleQueueBatch(batch, mockEnv, mockCtx);

      for (const call of consoleSpy.mock.calls) {
        const logStr = call[0] as string;
        expect(logStr).not.toContain('patient symptom data');
        expect(logStr).not.toContain('feeling terrible today');
        expect(logStr).not.toContain('rawBody');
      }
    });

    it('logs only IDs, types, counts, and durations', async () => {
      const msg = createQueueMessage(makeBody('scheduled-prompt', 'wamid.xyz'));
      const batch = createBatch([msg]);

      await handleQueueBatch(batch, mockEnv, mockCtx);

      // Check handler log contains only safe fields
      const handlerLog = consoleSpy.mock.calls.find((call) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.handler === 'scheduled-prompt';
      });
      expect(handlerLog).toBeDefined();

      const parsed = JSON.parse(handlerLog![0] as string);
      expect(parsed.messageId).toBe('wamid.xyz');
      expect(parsed.handler).toBe('scheduled-prompt');
    });
  });

  // ── Batch processing ────────────────────────────────────────────

  describe('batch processing', () => {
    it('processes multiple messages in a single batch', async () => {
      const msg1 = createQueueMessage(makeBody('inbound-message', 'wamid.1'));
      const msg2 = createQueueMessage(
        makeBody('scheduled-prompt', 'wamid.2'),
      );
      const msg3 = createQueueMessage(
        makeBody('report-generate', 'wamid.3'),
      );
      const batch = createBatch([msg1, msg2, msg3]);

      await handleQueueBatch(batch, mockEnv, mockCtx);

      expect(msg1.ack).toHaveBeenCalledOnce();
      expect(msg2.ack).toHaveBeenCalledOnce();
      expect(msg3.ack).toHaveBeenCalledOnce();
    });

    it('continues processing remaining messages when one fails', async () => {
      const msg1 = createQueueMessage(makeBody('inbound-message', 'wamid.1'));
      const msg2 = createQueueMessage(makeBody('inbound-message', 'wamid.2'));
      const msg3 = createQueueMessage(makeBody('inbound-message', 'wamid.3'));
      const batch = createBatch([msg1, msg2, msg3]);

      // Make the second message's handler throw
      let handlerCallCount = 0;
      consoleSpy.mockImplementation((...args: unknown[]) => {
        const logStr = args[0] as string;
        try {
          const parsed = JSON.parse(logStr);
          if (parsed.handler === 'inbound-message') {
            handlerCallCount++;
            if (handlerCallCount === 2) {
              throw new Error('Second message failed');
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message === 'Second message failed') {
            throw e;
          }
        }
      });

      await handleQueueBatch(batch, mockEnv, mockCtx);

      // First and third should be acked, second should be retried
      expect(msg1.ack).toHaveBeenCalledOnce();
      expect(msg2.retry).toHaveBeenCalledOnce();
      expect(msg3.ack).toHaveBeenCalledOnce();
    });

    it('reports correct success/failure counts for mixed batch', async () => {
      const msg1 = createQueueMessage(makeBody('inbound-message', 'wamid.1'));
      const msg2 = createQueueMessage(
        makeBody('unknown-type' as QueueMessageType, 'wamid.2'),
      );
      const batch = createBatch([msg1, msg2]);

      await handleQueueBatch(batch, mockEnv, mockCtx);

      // Both should be acked (unknown types are acked too)
      expect(msg1.ack).toHaveBeenCalledOnce();
      expect(msg2.ack).toHaveBeenCalledOnce();

      const completeLog = consoleSpy.mock.calls.find((call) => {
        try {
          const parsed = JSON.parse(call[0] as string);
          return parsed.msg === 'Queue batch processing complete';
        } catch {
          return false;
        }
      });
      expect(completeLog).toBeDefined();

      const parsed = JSON.parse(completeLog![0] as string);
      expect(parsed.succeeded).toBe(2);
      expect(parsed.failed).toBe(0);
    });
  });
});


// ── Webhook payload helpers ─────────────────────────────────────────

/** Build a WhatsApp webhook payload with a text message. */
function buildTextWebhookPayload(text: string, from = '+1234567890'): string {
  return JSON.stringify({
    entry: [{
      changes: [{
        value: {
          messages: [{
            type: 'text',
            from,
            text: { body: text },
          }],
        },
      }],
    }],
  });
}

/** Build a WhatsApp webhook payload with an interactive button reply. */
function buildButtonReplyPayload(replyId: string, from = '+1234567890'): string {
  return JSON.stringify({
    entry: [{
      changes: [{
        value: {
          messages: [{
            type: 'interactive',
            from,
            interactive: {
              type: 'button_reply',
              button_reply: { id: replyId, title: 'Some title' },
            },
          }],
        },
      }],
    }],
  });
}

/** Build a WhatsApp webhook payload with an interactive list reply. */
function buildListReplyPayload(replyId: string, from = '+1234567890'): string {
  return JSON.stringify({
    entry: [{
      changes: [{
        value: {
          messages: [{
            type: 'interactive',
            from,
            interactive: {
              type: 'list_reply',
              list_reply: { id: replyId, title: 'Some title' },
            },
          }],
        },
      }],
    }],
  });
}

/** Build a WhatsApp webhook payload with an unsupported message type. */
function buildUnsupportedPayload(msgType: string, from = '+1234567890'): string {
  return JSON.stringify({
    entry: [{
      changes: [{
        value: {
          messages: [{
            type: msgType,
            from,
          }],
        },
      }],
    }],
  });
}

// ── Task 6.4: Unit tests for extractTextFromPayload interactive handling ──

describe('extractTextFromPayload', () => {
  describe('interactive button reply', () => {
    it('returns the button reply ID', () => {
      const payload = buildButtonReplyPayload('yes');
      expect(extractTextFromPayload(payload)).toBe('yes');
    });

    it('returns a numeric button reply ID', () => {
      const payload = buildButtonReplyPayload('3');
      expect(extractTextFromPayload(payload)).toBe('3');
    });
  });

  describe('interactive list reply', () => {
    it('returns the list reply ID', () => {
      const payload = buildListReplyPayload('4');
      expect(extractTextFromPayload(payload)).toBe('4');
    });

    it('returns a text list reply ID', () => {
      const payload = buildListReplyPayload('partial');
      expect(extractTextFromPayload(payload)).toBe('partial');
    });
  });

  describe('plain text extraction (backward compatibility)', () => {
    it('returns the text body for text messages', () => {
      const payload = buildTextWebhookPayload('hello world');
      expect(extractTextFromPayload(payload)).toBe('hello world');
    });

    it('returns the text body for command messages', () => {
      const payload = buildTextWebhookPayload('checkin');
      expect(extractTextFromPayload(payload)).toBe('checkin');
    });
  });

  describe('unsupported message types', () => {
    it('returns null for image messages', () => {
      const payload = buildUnsupportedPayload('image');
      expect(extractTextFromPayload(payload)).toBeNull();
    });

    it('returns null for audio messages', () => {
      const payload = buildUnsupportedPayload('audio');
      expect(extractTextFromPayload(payload)).toBeNull();
    });

    it('returns null for status updates (no messages array)', () => {
      const payload = JSON.stringify({
        entry: [{
          changes: [{
            value: {
              statuses: [{ id: 'wamid.123', status: 'delivered' }],
            },
          }],
        }],
      });
      expect(extractTextFromPayload(payload)).toBeNull();
    });
  });

  describe('malformed payloads', () => {
    it('returns null for malformed JSON', () => {
      expect(extractTextFromPayload('not valid json {')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractTextFromPayload('')).toBeNull();
    });

    it('returns null for empty object', () => {
      expect(extractTextFromPayload('{}')).toBeNull();
    });
  });
});

// ── Task 6.5: Property test for interactive reply extraction ────────

describe('Feature: interactive-whatsapp-messages, Property 5: Interactive reply extraction returns the reply ID', () => {
  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any string replyId, a WhatsApp webhook payload containing
   * msg.type: "interactive" with either button_reply.id or list_reply.id
   * set to replyId, extractTextFromPayload SHALL return replyId.
   */
  it('button_reply: extractTextFromPayload returns the reply ID for any non-empty string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 256 }),
        (replyId) => {
          const payload = buildButtonReplyPayload(replyId);
          expect(extractTextFromPayload(payload)).toBe(replyId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('list_reply: extractTextFromPayload returns the reply ID for any non-empty string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (replyId) => {
          const payload = buildListReplyPayload(replyId);
          expect(extractTextFromPayload(payload)).toBe(replyId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Task 6.6: Property test for text extraction backward compatibility ──

describe('Feature: interactive-whatsapp-messages, Property 6: Text message extraction backward compatibility', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * For any non-empty string bodyText, a WhatsApp webhook payload containing
   * msg.type: "text" with msg.text.body set to bodyText, extractTextFromPayload
   * SHALL return bodyText.
   */
  it('extractTextFromPayload returns the text body for any non-empty string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 1000 }),
        (bodyText) => {
          const payload = buildTextWebhookPayload(bodyText);
          expect(extractTextFromPayload(payload)).toBe(bodyText);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Task 6.7: Property test for unsupported message types ───────────

describe('Feature: interactive-whatsapp-messages, Property 7: Unsupported message types return null', () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * For any WhatsApp webhook payload where msg.type is not "text" and not
   * "interactive", extractTextFromPayload SHALL return null.
   */
  it('extractTextFromPayload returns null for any unsupported message type', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => s !== 'text' && s !== 'interactive',
        ),
        (msgType) => {
          const payload = buildUnsupportedPayload(msgType);
          expect(extractTextFromPayload(payload)).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
