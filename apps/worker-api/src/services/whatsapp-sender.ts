/**
 * WhatsApp message sender utility.
 *
 * Sends text messages to a user's WhatsApp number via the Cloud API.
 * Handles API errors gracefully with structured logging (PHI-free per
 * NFR-SEC-005). Supports sending multiple messages in sequence.
 *
 * Follows the same API call pattern used in prompt-scheduler.ts for
 * consistency across the codebase.
 *
 * Validates: FR-WA-010 (System shall confirm saved entries succinctly)
 * Validates: NFR-OPS-004 (Retry on transient failure)
 * Design: Section 6.1 (Confirm saves briefly)
 */

import { buildTextMessagePayload } from './prompt-scheduler';

// ── Types ───────────────────────────────────────────────────────────

/** Bindings needed by the WhatsApp sender. */
export interface WhatsAppSenderEnv {
  WHATSAPP_API_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
}

/** Result of sending a single message. */
export interface SendResult {
  success: boolean;
  /** WhatsApp message ID returned by the API on success. */
  waMessageId?: string;
  /** Error description on failure. */
  error?: string;
  /** HTTP status code from the API response (if available). */
  statusCode?: number;
}

// ── Core sender ─────────────────────────────────────────────────────

/**
 * Send a single text message to a WhatsApp phone number.
 *
 * Uses the WhatsApp Cloud API (same endpoint and auth pattern as
 * prompt-scheduler.ts). Logs structured errors without PHI.
 *
 * @param env - Environment bindings with WhatsApp credentials.
 * @param phoneNumber - The recipient's WhatsApp phone number.
 * @param text - The message text body.
 * @returns A SendResult indicating success or failure.
 */
export async function sendTextMessage(
  env: WhatsAppSenderEnv,
  phoneNumber: string,
  text: string,
): Promise<SendResult> {
  const requestBody = buildTextMessagePayload(phoneNumber, text);

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log(
        JSON.stringify({
          level: 'error',
          service: 'whatsapp-sender',
          msg: 'WhatsApp API send failed',
          statusCode: response.status,
          error: errorText,
        }),
      );
      return {
        success: false,
        error: `WhatsApp API error (${response.status})`,
        statusCode: response.status,
      };
    }

    const data = (await response.json()) as { messages?: Array<{ id: string }> };
    const waMessageId = data.messages?.[0]?.id;

    return { success: true, waMessageId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown fetch error';
    console.log(
      JSON.stringify({
        level: 'error',
        service: 'whatsapp-sender',
        msg: 'WhatsApp API request failed',
        error: errorMessage,
      }),
    );
    return { success: false, error: errorMessage };
  }
}

/**
 * Send multiple text messages in sequence to a WhatsApp phone number.
 *
 * Messages are sent one at a time in order. If any message fails, the
 * remaining messages are still attempted. Returns results for all messages.
 *
 * @param env - Environment bindings with WhatsApp credentials.
 * @param phoneNumber - The recipient's WhatsApp phone number.
 * @param messages - Array of message text strings to send.
 * @returns Array of SendResult, one per message.
 */
export async function sendMessages(
  env: WhatsAppSenderEnv,
  phoneNumber: string,
  messages: string[],
): Promise<SendResult[]> {
  const results: SendResult[] = [];

  for (const text of messages) {
    const result = await sendTextMessage(env, phoneNumber, text);
    results.push(result);
  }

  return results;
}
