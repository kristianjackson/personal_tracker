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
import { parseCommand } from './command-router';
import type { ParsedCommand } from './command-router';
import { findBindingByPhone } from './whatsapp-binding';
import { getSession } from './checkin-session';
import { startCheckin, processAnswer } from './checkin-flow';
import type { CheckinFlowEnv } from './checkin-flow';
import {
  handleNoteCommand,
  handleTagConfirmation,
  getPendingNote,
} from './note-capture';
import type { NoteCaptureEnv } from './note-capture';
import { localDateToday, parseCheckinDate, isCheckinDateError } from '@symptom-tracker/shared';

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

/**
 * Extract the user's text from a raw WhatsApp webhook payload.
 *
 * Returns null when the payload does not contain a text message
 * (e.g. delivery status updates, media messages, etc.).
 */
export function extractTextFromPayload(rawBody: string): string | null {
  try {
    const payload = JSON.parse(rawBody);
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const messages = change?.value?.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const msg = messages[0];
      if (msg.type === 'text' && typeof msg.text?.body === 'string') {
        return msg.text.body;
      }
    }
  } catch {
    // Malformed JSON — fall through to null
  }
  return null;
}

/**
 * Extract the sender's phone number from a raw WhatsApp webhook payload.
 *
 * Returns null when the payload does not contain a message with a sender.
 */
export function extractPhoneFromPayload(rawBody: string): string | null {
  try {
    const payload = JSON.parse(rawBody);
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const messages = change?.value?.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const msg = messages[0];
      if (typeof msg.from === 'string') {
        return msg.from;
      }
    }
  } catch {
    // Malformed JSON — fall through to null
  }
  return null;
}

async function handleInboundMessage(body: InboundQueueMessage, env: Env): Promise<void> {
  const text = extractTextFromPayload(body.rawBody);

  if (text === null) {
    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'inbound-message',
        messageId: body.messageId,
        msg: 'Non-text message received — skipping command routing',
      }),
    );
    return;
  }

  // Extract phone number and look up user binding
  const phone = extractPhoneFromPayload(body.rawBody);
  if (!phone) {
    console.log(
      JSON.stringify({
        level: 'warn',
        handler: 'inbound-message',
        messageId: body.messageId,
        msg: 'Could not extract phone number from payload',
      }),
    );
    return;
  }

  const { binding } = await findBindingByPhone(env.DB, phone);
  if (!binding) {
    console.log(
      JSON.stringify({
        level: 'warn',
        handler: 'inbound-message',
        messageId: body.messageId,
        msg: 'No active binding found for phone number',
      }),
    );
    return;
  }

  const userId = binding.user_id;
  const command: ParsedCommand = parseCommand(text);

  console.log(
    JSON.stringify({
      level: 'info',
      handler: 'inbound-message',
      messageId: body.messageId,
      commandType: command.type,
      msg: 'Inbound message routed',
    }),
  );

  const flowEnv: CheckinFlowEnv = { DB: env.DB, KV: env.KV };
  const noteEnv: NoteCaptureEnv = { DB: env.DB, KV: env.KV };

  // Check for active check-in session
  const activeSession = await getSession(env.KV, userId);

  // Dispatch command
  if (command.type === 'checkin') {
    // Look up user timezone for local date
    const user = await env.DB
      .prepare('SELECT timezone FROM user WHERE id = ?')
      .bind(userId)
      .first<{ timezone: string }>();
    const timezone = user?.timezone ?? 'UTC';

    // Parse and validate the optional date argument (FR-CAP-003)
    const dateResult = parseCheckinDate(command.dateArg, timezone);
    if (isCheckinDateError(dateResult)) {
      console.log(
        JSON.stringify({
          level: 'info',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Check-in date validation failed',
        }),
      );
      // TODO: send dateResult.error back to user via WhatsApp API (task 25)
      return;
    }

    const { date: checkinDate, isRetroactive } = dateResult;

    // Create session with retroactive flag if applicable
    const result = await startCheckin(flowEnv, userId, checkinDate, isRetroactive);
    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'inbound-message',
        messageId: body.messageId,
        msg: 'Check-in flow started/resumed',
        completed: result.completed,
        isRetroactive,
      }),
    );
    // TODO: send result.messages back to user via WhatsApp API (task 25)
    return;
  }

  if (command.type === 'note') {
    const result = await handleNoteCommand(noteEnv, userId, command.text);
    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'inbound-message',
        messageId: body.messageId,
        msg: 'Note command processed',
        saved: result.saved,
      }),
    );
    // TODO: send result.messages back to user via WhatsApp API (task 25)
    return;
  }

  if (command.type === 'message') {
    // Check for pending note tag confirmation before check-in session
    const pendingNote = await getPendingNote(env.KV, userId);
    if (pendingNote) {
      const result = await handleTagConfirmation(noteEnv, userId, command.text);
      console.log(
        JSON.stringify({
          level: 'info',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Tag confirmation processed',
          saved: result.saved,
        }),
      );
      // TODO: send result.messages back to user via WhatsApp API (task 25)
      return;
    }

    if (activeSession) {
      // Process as an answer to the current check-in question
      const result = await processAnswer(flowEnv, userId, command.text);
      console.log(
        JSON.stringify({
          level: 'info',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Check-in answer processed',
          completed: result.completed,
        }),
      );
      // TODO: send result.messages back to user via WhatsApp API (task 25)
      return;
    }
  }

  // Other commands (help, inject, etc.) — stubs for future tasks
  // If a session is active, these commands don't lose the session
  console.log(
    JSON.stringify({
      level: 'info',
      handler: 'inbound-message',
      messageId: body.messageId,
      commandType: command.type,
      msg: 'Command dispatched (stub)',
    }),
  );
}

async function handleScheduledPrompt(body: InboundQueueMessage, _env: Env): Promise<void> {
  console.log(
    JSON.stringify({
      level: 'info',
      handler: 'scheduled-prompt',
      messageId: body.messageId,
      msg: 'Processing scheduled prompt (stub)',
    }),
  );
}

async function handleReportGenerate(body: InboundQueueMessage, _env: Env): Promise<void> {
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
  _env: Env,
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
  (body: InboundQueueMessage, env: Env) => Promise<void>
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
  env: Env,
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
    await handler(body, env);
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
  env: Env,
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
    const result = await processMessage(message, env);
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
