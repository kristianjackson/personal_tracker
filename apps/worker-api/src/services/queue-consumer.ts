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
import {
  handleMissedMedGeneric,
  handleMissedMedSpecific,
  handleTookMed,
} from './medication-event';
import type { MedicationEventEnv } from './medication-event';
import {
  startInjectionFlow,
  processInjectionResponse,
  getInjectionSession,
} from './injection-flow';
import type { InjectionFlowEnv } from './injection-flow';
import {
  startSideEffectCapture,
  processSideEffectResponse,
  getSideEffectSession,
} from './side-effect-capture';
import type { SideEffectCaptureEnv } from './side-effect-capture';
import {
  startInstrumentFlow,
  processInstrumentResponse,
  getInstrumentSession,
} from './instrument-flow';
import type { InstrumentFlowEnv } from './instrument-flow';
import {
  handleTagsAdd,
  handleTagsList,
} from './tag-management';
import type { TagManagementEnv } from './tag-management';
import { processScheduledPrompt, recordInboundTimestamp } from './prompt-scheduler';
import { sendMessages } from './whatsapp-sender';
import type { WhatsAppSenderEnv } from './whatsapp-sender';
import { localDateToday, parseCheckinDate, isCheckinDateError, isFeatureEnabled } from '@symptom-tracker/shared';

/** Failure recovery message sent when a D1 write fails. */
export const WRITE_FAILURE_MESSAGE = '⚠ Something went wrong saving your data. Please try again.';

/** Result of processing a single queue message. */
interface ProcessingResult {
  success: boolean;
  messageId: string;
  type: string;
  durationMs: number;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Send response messages back to the user via WhatsApp.
 *
 * Logs send failures but does not throw — the command has already been
 * processed and persisted, so a send failure should not trigger a queue
 * retry of the entire message.
 */
async function replyToUser(
  env: WhatsAppSenderEnv,
  phone: string,
  messages: string[],
  messageId: string,
): Promise<void> {
  if (messages.length === 0) return;

  const results = await sendMessages(env, phone, messages);
  const failures = results.filter((r) => !r.success);

  if (failures.length > 0) {
    console.log(
      JSON.stringify({
        level: 'warn',
        handler: 'inbound-message',
        messageId,
        msg: 'Some reply messages failed to send',
        failedCount: failures.length,
        totalCount: results.length,
      }),
    );
  }
}

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

  // Record inbound message timestamp for 24h service window tracking (FR-WA-008)
  await recordInboundTimestamp(env.KV, userId);

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
  const medEnv: MedicationEventEnv = { DB: env.DB };
  const injEnv: InjectionFlowEnv = { DB: env.DB, KV: env.KV };
  const seEnv: SideEffectCaptureEnv = { DB: env.DB, KV: env.KV };
  const instEnv: InstrumentFlowEnv = { DB: env.DB, KV: env.KV };
  const tagEnv: TagManagementEnv = { KV: env.KV };

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
      await replyToUser(env, phone, [dateResult.error], body.messageId);
      return;
    }

    const { date: checkinDate, isRetroactive } = dateResult;

    // Create session with retroactive flag if applicable
    let result;
    try {
      result = await startCheckin(flowEnv, userId, checkinDate, isRetroactive);
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Check-in start/resume failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        }),
      );
      await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
      return;
    }
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
    await replyToUser(env, phone, result.messages, body.messageId);
    return;
  }

  if (command.type === 'note') {
    let result;
    try {
      result = await handleNoteCommand(noteEnv, userId, command.text);
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Note command failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        }),
      );
      await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
      return;
    }
    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'inbound-message',
        messageId: body.messageId,
        msg: 'Note command processed',
        saved: result.saved,
      }),
    );
    await replyToUser(env, phone, result.messages, body.messageId);
    return;
  }

  if (command.type === 'inject') {
    let result;
    try {
      result = await startInjectionFlow(injEnv, userId);
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Injection flow start failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        }),
      );
      await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
      return;
    }
    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'inbound-message',
        messageId: body.messageId,
        msg: 'Injection flow started/resumed',
        completed: result.completed,
        saved: result.saved,
      }),
    );
    await replyToUser(env, phone, result.messages, body.messageId);
    return;
  }

  if (command.type === 'message') {
    // Check for pending note tag confirmation before other sessions
    const pendingNote = await getPendingNote(env.KV, userId);
    if (pendingNote) {
      let result;
      try {
        result = await handleTagConfirmation(noteEnv, userId, command.text);
      } catch (err) {
        console.log(
          JSON.stringify({
            level: 'error',
            handler: 'inbound-message',
            messageId: body.messageId,
            msg: 'Tag confirmation failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          }),
        );
        await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
        return;
      }
      console.log(
        JSON.stringify({
          level: 'info',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Tag confirmation processed',
          saved: result.saved,
        }),
      );
      await replyToUser(env, phone, result.messages, body.messageId);
      return;
    }

    // Check for active injection session
    const activeInjectionSession = await getInjectionSession(env.KV, userId);
    if (activeInjectionSession) {
      const user = await env.DB
        .prepare('SELECT timezone FROM user WHERE id = ?')
        .bind(userId)
        .first<{ timezone: string }>();
      const timezone = user?.timezone ?? 'UTC';

      let result;
      try {
        result = await processInjectionResponse(injEnv, userId, command.text, timezone);
      } catch (err) {
        console.log(
          JSON.stringify({
            level: 'error',
            handler: 'inbound-message',
            messageId: body.messageId,
            msg: 'Injection flow response failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          }),
        );
        await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
        return;
      }
      console.log(
        JSON.stringify({
          level: 'info',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Injection flow response processed',
          completed: result.completed,
          saved: result.saved,
        }),
      );

      // If injection completed with watch opt-in, start side-effect capture
      if (result.completed && result.saved) {
        const hasSideEffectSignal = result.messages.some(
          (m) => m === '__START_SIDE_EFFECT_CAPTURE__',
        );
        if (hasSideEffectSignal) {
          // Remove the internal signal from messages
          result.messages = result.messages.filter(
            (m) => m !== '__START_SIDE_EFFECT_CAPTURE__',
          );
          const seResult = await startSideEffectCapture(seEnv, userId, timezone);
          console.log(
            JSON.stringify({
              level: 'info',
              handler: 'inbound-message',
              messageId: body.messageId,
              msg: 'Side-effect capture started after injection',
            }),
          );
          await replyToUser(env, phone, seResult.messages, body.messageId);
        }
      }

      await replyToUser(env, phone, result.messages, body.messageId);
      return;
    }

    // Check for active side-effect session
    const activeSideEffectSession = await getSideEffectSession(env.KV, userId);
    if (activeSideEffectSession) {
      let result;
      try {
        result = await processSideEffectResponse(seEnv, userId, command.text);
      } catch (err) {
        console.log(
          JSON.stringify({
            level: 'error',
            handler: 'inbound-message',
            messageId: body.messageId,
            msg: 'Side-effect response failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          }),
        );
        await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
        return;
      }
      console.log(
        JSON.stringify({
          level: 'info',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Side-effect response processed',
          completed: result.completed,
          savedCount: result.savedCount,
        }),
      );
      await replyToUser(env, phone, result.messages, body.messageId);
      return;
    }

    // Check for active instrument session (feature-flagged)
    const activeInstrumentSession = await getInstrumentSession(env.KV, userId);
    if (activeInstrumentSession) {
      let result;
      try {
        result = await processInstrumentResponse(instEnv, userId, command.text);
      } catch (err) {
        console.log(
          JSON.stringify({
            level: 'error',
            handler: 'inbound-message',
            messageId: body.messageId,
            msg: 'Instrument response failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          }),
        );
        await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
        return;
      }
      console.log(
        JSON.stringify({
          level: 'info',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Instrument response processed',
          completed: result.completed,
          saved: result.saved,
        }),
      );
      await replyToUser(env, phone, result.messages, body.messageId);
      return;
    }

    if (activeSession) {
      // Process as an answer to the current check-in question
      let result;
      try {
        result = await processAnswer(flowEnv, userId, command.text);
      } catch (err) {
        console.log(
          JSON.stringify({
            level: 'error',
            handler: 'inbound-message',
            messageId: body.messageId,
            msg: 'Check-in answer processing failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          }),
        );
        await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
        return;
      }
      console.log(
        JSON.stringify({
          level: 'info',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Check-in answer processed',
          completed: result.completed,
        }),
      );
      await replyToUser(env, phone, result.messages, body.messageId);
      return;
    }
  }

  if (command.type === 'tags_add') {
    let result;
    try {
      result = await handleTagsAdd(tagEnv, command.tagName);
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Tags add command failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        }),
      );
      await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
      return;
    }
    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'inbound-message',
        messageId: body.messageId,
        msg: 'Tags add command processed',
        created: result.created,
      }),
    );
    await replyToUser(env, phone, result.messages, body.messageId);
    return;
  }

  if (command.type === 'tags') {
    let result;
    try {
      result = await handleTagsList(tagEnv);
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Tags list command failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        }),
      );
      await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
      return;
    }
    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'inbound-message',
        messageId: body.messageId,
        msg: 'Tags list command processed',
      }),
    );
    await replyToUser(env, phone, result.messages, body.messageId);
    return;
  }

  if (command.type === 'missed_med') {
    if (command.medicationName === null) {
      // Generic "missed med" — list active medications
      let result;
      try {
        result = await handleMissedMedGeneric(medEnv, userId);
      } catch (err) {
        console.log(
          JSON.stringify({
            level: 'error',
            handler: 'inbound-message',
            messageId: body.messageId,
            msg: 'Missed med (generic) failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          }),
        );
        await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
        return;
      }
      console.log(
        JSON.stringify({
          level: 'info',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Missed med (generic) processed',
          saved: result.saved,
        }),
      );
      await replyToUser(env, phone, result.messages, body.messageId);
      return;
    }

    // Specific "missed <med-name>"
    const user = await env.DB
      .prepare('SELECT timezone FROM user WHERE id = ?')
      .bind(userId)
      .first<{ timezone: string }>();
    const timezone = user?.timezone ?? 'UTC';

    let result;
    try {
      result = await handleMissedMedSpecific(medEnv, userId, command.medicationName, timezone);
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Missed med (specific) failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        }),
      );
      await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
      return;
    }
    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'inbound-message',
        messageId: body.messageId,
        msg: 'Missed med (specific) processed',
        saved: result.saved,
      }),
    );
    await replyToUser(env, phone, result.messages, body.messageId);
    return;
  }

  if (command.type === 'took_med') {
    const user = await env.DB
      .prepare('SELECT timezone FROM user WHERE id = ?')
      .bind(userId)
      .first<{ timezone: string }>();
    const timezone = user?.timezone ?? 'UTC';

    let result;
    try {
      result = await handleTookMed(medEnv, userId, command.medicationName, timezone);
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          handler: 'inbound-message',
          messageId: body.messageId,
          msg: 'Took med failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        }),
      );
      await replyToUser(env, phone, [WRITE_FAILURE_MESSAGE], body.messageId);
      return;
    }
    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'inbound-message',
        messageId: body.messageId,
        msg: 'Took med processed',
        saved: result.saved,
      }),
    );
    await replyToUser(env, phone, result.messages, body.messageId);
    return;
  }

  // Other commands (help, status, etc.) — stubs for future tasks
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

async function handleScheduledPrompt(body: InboundQueueMessage, env: Env): Promise<void> {
  console.log(
    JSON.stringify({
      level: 'info',
      handler: 'scheduled-prompt',
      messageId: body.messageId,
      msg: 'Processing scheduled prompt',
    }),
  );

  await processScheduledPrompt(body.rawBody, env);
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
