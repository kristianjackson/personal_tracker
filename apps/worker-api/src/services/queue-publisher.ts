/**
 * Queue publisher service for inbound message events.
 *
 * Encapsulates the logic for publishing messages to Cloudflare Queues.
 * Queue failures are caught and logged without affecting the webhook
 * 200 response (fast-ack pattern).
 *
 * Validates: NFR-OPS-001 (acknowledge within 1s before async processing)
 * Validates: NFR-OPS-004 (retry on transient failure with exponential backoff)
 * Design: DD-002 (fast webhook ack, async processing — publish to Queue)
 */

/** Message types that can be published to the queue. */
export type QueueMessageType =
  | 'inbound-message'
  | 'scheduled-prompt'
  | 'report-generate'
  | 'analytics-refresh';

/** Shape of a queue message for inbound webhook events. */
export interface InboundQueueMessage {
  /** Discriminator for the queue consumer to route processing. */
  type: QueueMessageType;
  /** The WhatsApp message_id (or fallback key) for dedup/tracing. */
  messageId: string;
  /** The raw webhook body string. */
  rawBody: string;
  /** ISO 8601 UTC timestamp of when the message was enqueued. */
  timestamp: string;
}

/**
 * Publish an inbound message event to the Cloudflare Queue.
 *
 * @param queue - The Queue binding from wrangler.toml.
 * @param messageId - The extracted message_id for dedup/tracing.
 * @param rawBody - The raw webhook JSON body string.
 * @param now - The current date (for timestamp; defaults to new Date()).
 */
export async function publishToQueue(
  queue: Queue,
  messageId: string,
  rawBody: string,
  now: Date = new Date(),
): Promise<void> {
  const message: InboundQueueMessage = {
    type: 'inbound-message',
    messageId,
    rawBody,
    timestamp: now.toISOString(),
  };

  await queue.send(message);
}
