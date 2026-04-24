/**
 * Queue consumer service for async message processing.
 *
 * Routes messages by type to stub handlers, manages ack/retry lifecycle,
 * and emits structured logs (PHI-free per NFR-SEC-005).
 *
 * Cloudflare Queues handles exponential backoff timing and dead-letter
 * routing natively (configured in wrangler.toml with max_retries=3 and
 * dead_letter_queue). The consumer calls message.retry() on failure and
 * message.ack() on success.
 *
 * Validates: NFR-OPS-004 (retry on transient failure with exponential backoff, dead-letter after 3 attempts)
 * Validates: NFR-OPS-006 (core services observable — errors, queue failures visible)
 * Design: Section 10.2 (Queue topics: inbound-message, scheduled-prompt, report-generate, analytics-refresh)
 */

import type { QueueMessageType, InboundQueueMessage } from './queue-publisher';
import type { Env } from '../index';

/** Result of processing a single queue message. */
interface ProcessingResult {
  success: boolean;
  messageId: string;
  type: string;
  durationMs: number;
  error?: string;
}

// ── Stub handlers ───────────────────────────────────────────────────
// Each handler is a placeholder that will be replaced by real logic in
// later tasks (13+). For now they just log receipt and return.

async function handleInboundMessage(body: InboundQueueMessage): Promise<void> {
  console.log(
    JSON.stringify({
      level: 'info',
      handler: 'inbound-message',
      messageId: body.messageId,
      msg: 'Processing inbound message (stub)',
    }),
  );
}

async function handleScheduledPrompt(body: InboundQueueMessage): Promise<void> {
  console.log(
    JSON.stringify({
      level: 'info',
      handler: 'scheduled-prompt',
      messageId: body.messageId,
      msg: 'Processing scheduled prompt (stub)',
    }),
  );
}

async function handleReportGenerate(body: InboundQueueMessage): Promise<void> {
  console.log(
    JSON.stringify({
      level: 'info',
      handler: 'report-generate',
      messageId: body.messageId,
      msg: 'Processing report generation (stub)',
    }),
  );
}

async function handleAnalyticsRefresh(
  body: InboundQueueMessage,
): Promise<void> {
  console.log(
    JSON.stringify({
      level: 'info',
      handler: 'analytics-refresh',
      messageId: body.messageId,
      msg: 'Processing analytics refresh (stub)',
    }),
  );
}

/** Map of message type → handler function. */
const handlers: Record<
  QueueMessageType,
  (body: InboundQueueMessage) => Promise<void>
> = {
  'inbound-message': handleInboundMessage,
  'scheduled-prompt': handleScheduledPrompt,
  'report-generate': handleReportGenerate,
  'analytics-refresh': handleAnalyticsRefresh,
};

/**
 * Process a single queue message: route to the correct handler,
 * ack on success, retry on failure.
 */
async function processMessage(
  message: Message<InboundQueueMessage>,
): Promise<ProcessingResult> {
  const startTime = Date.now();
  const body = message.body;
  const messageType = body.type;
  const messageId = body.messageId ?? 'unknown';

  // Unknown message type — ack to avoid infinite retry loops, but warn.
  const handler = handlers[messageType as QueueMessageType];
  if (!handler) {
    console.log(
      JSON.stringify({
        level: 'warn',
        msg: 'Unknown queue message type — acking to prevent retry loop',
        type: messageType,
        messageId,
      }),
    );
    message.ack();
    return {
      success: true,
      messageId,
      type: String(messageType),
      durationMs: Date.now() - startTime,
    };
  }

  try {
    await handler(body);
    message.ack();

    return {
      success: true,
      messageId,
      type: messageType,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown processing error';

    console.log(
      JSON.stringify({
        level: 'error',
        msg: 'Queue message processing failed — scheduling retry',
        type: messageType,
        messageId,
        error: errorMessage,
      }),
    );

    message.retry();

    return {
      success: false,
      messageId,
      type: messageType,
      durationMs: Date.now() - startTime,
      error: errorMessage,
    };
  }
}

/**
 * Handle a batch of queue messages from Cloudflare Queues.
 *
 * This is the entry point wired into the Worker's `queue()` export.
 * Each message in the batch is processed individually so that a single
 * failure does not block the rest of the batch.
 */
export async function handleQueueBatch(
  batch: MessageBatch<InboundQueueMessage>,
  _env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const batchSize = batch.messages.length;
  const queueName = batch.queue;

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'Queue batch received',
      queue: queueName,
      batchSize,
    }),
  );

  const results: ProcessingResult[] = [];

  for (const message of batch.messages) {
    const result = await processMessage(message);
    results.push(result);
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'Queue batch processing complete',
      queue: queueName,
      batchSize,
      succeeded,
      failed,
    }),
  );
}
