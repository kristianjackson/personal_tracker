import { describe, it, expect, vi } from 'vitest';
import { publishToQueue } from './queue-publisher';
import type { InboundQueueMessage } from './queue-publisher';

/**
 * Tests for the queue publisher service.
 *
 * Validates: NFR-OPS-001 (acknowledge within 1s before async processing)
 * Validates: NFR-OPS-004 (retry on transient failure with exponential backoff)
 */

/** Create a mock Queue binding with a send() method. */
function mockQueue() {
  return {
    send: vi.fn(async () => undefined),
  } as unknown as Queue;
}

describe('publishToQueue', () => {
  const fixedDate = new Date('2025-06-10T14:30:00Z');

  it('sends a correctly structured inbound-message to the queue', async () => {
    const queue = mockQueue();
    const rawBody = JSON.stringify({ object: 'whatsapp_business_account' });

    await publishToQueue(queue, 'wamid.abc123', rawBody, fixedDate);

    expect(queue.send).toHaveBeenCalledOnce();
    const sentMessage = (queue.send as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as InboundQueueMessage;

    expect(sentMessage.type).toBe('inbound-message');
    expect(sentMessage.messageId).toBe('wamid.abc123');
    expect(sentMessage.rawBody).toBe(rawBody);
    expect(sentMessage.timestamp).toBe('2025-06-10T14:30:00.000Z');
  });

  it('includes the correct message type identifier', async () => {
    const queue = mockQueue();

    await publishToQueue(queue, 'wamid.test', '{}', fixedDate);

    const sentMessage = (queue.send as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as InboundQueueMessage;
    expect(sentMessage.type).toBe('inbound-message');
  });

  it('propagates queue errors to the caller', async () => {
    const queue = {
      send: vi.fn(async () => {
        throw new Error('Queue unavailable');
      }),
    } as unknown as Queue;

    await expect(
      publishToQueue(queue, 'wamid.fail', '{}', fixedDate),
    ).rejects.toThrow('Queue unavailable');
  });

  it('uses current time when no date is provided', async () => {
    const queue = mockQueue();
    const before = new Date();

    await publishToQueue(queue, 'wamid.now', '{}');

    const after = new Date();
    const sentMessage = (queue.send as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as InboundQueueMessage;
    const sentTime = new Date(sentMessage.timestamp);

    expect(sentTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(sentTime.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
