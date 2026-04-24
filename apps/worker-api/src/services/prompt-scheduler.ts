/**
 * Outbound prompt scheduler service.
 *
 * Handles cron trigger events from Cloudflare Workers. The cron runs at
 * a fixed UTC interval (every 15 minutes) and checks whether the single
 * MVP user's configured local time matches their prompt schedule.
 *
 * For the daily check-in prompt, the scheduler compares the user's
 * current local time (HH:MM) against the configured daily prompt time.
 * For the weekly summary prompt, it additionally checks the day of week.
 *
 * When a prompt is due, the scheduler publishes a `scheduled-prompt`
 * message to the Cloudflare Queue for async delivery via WhatsApp.
 *
 * Validates: FR-WA-007 (send daily and weekly prompts on schedule in user's configured timezone)
 * Validates: FR-ADM-001 (allow configuration of prompt schedule)
 * Design: DD-010 (user timezone is authoritative for dates)
 * Design: Section 10.1 (scheduler — cron-triggered prompts)
 * Design: Section 10.2 (Queue topic: scheduled-prompt)
 */

import type { PromptSchedule } from '@symptom-tracker/shared';
import { getEnabledSchedules } from '@symptom-tracker/shared';
import type { Env } from '../index';

// ── Types ───────────────────────────────────────────────────────────

/** The payload published to the queue for a scheduled prompt. */
export interface ScheduledPromptPayload {
  type: 'scheduled-prompt';
  messageId: string;
  rawBody: string;
  timestamp: string;
}

/** The structured body inside rawBody for a scheduled prompt. */
export interface ScheduledPromptBody {
  scheduleId: string;
  scheduleName: string;
  scheduleType: 'daily' | 'weekly';
  userId: string;
  phoneNumber: string;
  localTime: string;
  timezone: string;
}

/** Result of checking whether a prompt is due. */
export interface PromptDueResult {
  isDue: boolean;
  schedule: PromptSchedule;
}

// ── Time helpers ────────────────────────────────────────────────────

/**
 * Get the current local time components in the given IANA timezone.
 *
 * @param timezone - IANA timezone string (e.g. "America/New_York").
 * @param now - Optional Date override for testing.
 * @returns Object with hours (0-23), minutes (0-59), and dayOfWeek (0=Sunday).
 */
export function getLocalTimeComponents(
  timezone: string,
  now?: Date,
): { hours: number; minutes: number; dayOfWeek: number } {
  const date = now ?? new Date();

  // Use Intl.DateTimeFormat to get locale-independent numeric parts
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);

  let hours = 0;
  let minutes = 0;
  let weekday = '';

  for (const part of parts) {
    if (part.type === 'hour') {
      hours = parseInt(part.value, 10);
    } else if (part.type === 'minute') {
      minutes = parseInt(part.value, 10);
    } else if (part.type === 'weekday') {
      weekday = part.value;
    }
  }

  // Intl hour12:false can return 24 for midnight in some locales — normalize
  if (hours === 24) hours = 0;

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = dayMap[weekday] ?? 0;

  return { hours, minutes, dayOfWeek };
}

/**
 * Parse a HH:MM time string into hours and minutes.
 *
 * @param time - Time string in "HH:MM" 24-hour format.
 * @returns Object with hours and minutes, or null if invalid.
 */
export function parseTimeString(time: string): { hours: number; minutes: number } | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return { hours, minutes };
}

/**
 * Check if the current local time falls within the cron window for a
 * scheduled prompt time. Since the cron runs every 15 minutes, we
 * consider a prompt "due" if the current time is within a 15-minute
 * window starting at the configured time.
 *
 * For example, if the prompt is configured for 09:00 and the cron fires
 * at 09:00, 09:07, or 09:14, the prompt is due. At 09:15 it is not.
 *
 * @param currentHours - Current local hours (0-23).
 * @param currentMinutes - Current local minutes (0-59).
 * @param targetHours - Target prompt hours (0-23).
 * @param targetMinutes - Target prompt minutes (0-59).
 * @param windowMinutes - Size of the matching window in minutes (default 15).
 */
export function isTimeInWindow(
  currentHours: number,
  currentMinutes: number,
  targetHours: number,
  targetMinutes: number,
  windowMinutes: number = 15,
): boolean {
  const currentTotal = currentHours * 60 + currentMinutes;
  const targetTotal = targetHours * 60 + targetMinutes;

  const diff = currentTotal - targetTotal;

  // Handle the simple case: current time is within [target, target + window)
  return diff >= 0 && diff < windowMinutes;
}

// ── Core scheduler logic ────────────────────────────────────────────

/**
 * Determine which enabled schedules are due for the given timezone and time.
 *
 * @param timezone - The user's IANA timezone.
 * @param now - Optional Date override for testing.
 * @returns Array of PromptDueResult indicating which schedules are due.
 */
export function checkDueSchedules(
  timezone: string,
  now?: Date,
): PromptDueResult[] {
  const { hours, minutes, dayOfWeek } = getLocalTimeComponents(timezone, now);
  const enabledSchedules = getEnabledSchedules();
  const results: PromptDueResult[] = [];

  for (const schedule of enabledSchedules) {
    const target = parseTimeString(schedule.default_time);
    if (!target) continue;

    const timeMatch = isTimeInWindow(hours, minutes, target.hours, target.minutes);

    if (schedule.type === 'daily' && timeMatch) {
      results.push({ isDue: true, schedule });
    } else if (
      schedule.type === 'weekly' &&
      timeMatch &&
      schedule.day_of_week === dayOfWeek
    ) {
      results.push({ isDue: true, schedule });
    } else {
      results.push({ isDue: false, schedule });
    }
  }

  return results;
}

/**
 * Build a queue message payload for a scheduled prompt.
 *
 * @param schedule - The prompt schedule that is due.
 * @param userId - The user's ID.
 * @param phoneNumber - The user's WhatsApp phone number.
 * @param timezone - The user's IANA timezone.
 * @param now - Optional Date override for testing.
 */
export function buildPromptQueueMessage(
  schedule: PromptSchedule,
  userId: string,
  phoneNumber: string,
  timezone: string,
  now?: Date,
): ScheduledPromptPayload {
  const date = now ?? new Date();
  const { hours, minutes } = getLocalTimeComponents(timezone, date);
  const localTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  const body: ScheduledPromptBody = {
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    scheduleType: schedule.type,
    userId,
    phoneNumber,
    localTime,
    timezone,
  };

  return {
    type: 'scheduled-prompt',
    messageId: `sched-${schedule.id}-${date.toISOString().slice(0, 16)}`,
    rawBody: JSON.stringify(body),
    timestamp: date.toISOString(),
  };
}

// ── WhatsApp prompt text ────────────────────────────────────────────

/**
 * Generate the outbound prompt text for a given schedule type.
 *
 * @param scheduleType - 'daily' or 'weekly'.
 * @returns The message text to send via WhatsApp.
 */
export function getPromptText(scheduleType: 'daily' | 'weekly'): string {
  if (scheduleType === 'daily') {
    return '👋 Good morning! Ready for your daily check-in? Reply "checkin" to start.';
  }
  return '📊 Time for your weekly summary! Your data from this past week is ready for review on the dashboard.';
}

// ── Cron handler ────────────────────────────────────────────────────

/**
 * Handle a cron trigger event. This is the main entry point called by
 * the Worker's `scheduled()` export.
 *
 * For the single-user MVP, it:
 * 1. Looks up the user and their active WhatsApp binding from D1
 * 2. Checks which prompt schedules are due based on the user's timezone
 * 3. Publishes `scheduled-prompt` queue messages for each due schedule
 *
 * @param env - The Worker environment bindings.
 * @param now - Optional Date override for testing.
 */
export async function handleScheduledEvent(
  env: Env,
  now?: Date,
): Promise<void> {
  const date = now ?? new Date();

  // Look up the single MVP user with an active WhatsApp binding
  const userRow = await env.DB
    .prepare(
      `SELECT u.id, u.timezone, wb.phone_number
       FROM user u
       JOIN whatsapp_binding wb ON wb.user_id = u.id AND wb.active = 1
       LIMIT 1`,
    )
    .first<{ id: string; timezone: string; phone_number: string }>();

  if (!userRow) {
    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'scheduler',
        msg: 'No active user with WhatsApp binding found — skipping prompt check',
      }),
    );
    return;
  }

  const { id: userId, timezone, phone_number: phoneNumber } = userRow;

  // Check which schedules are due
  const dueResults = checkDueSchedules(timezone, date);
  const dueSchedules = dueResults.filter((r) => r.isDue);

  if (dueSchedules.length === 0) {
    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'scheduler',
        msg: 'No prompts due at this time',
        timezone,
        localTime: (() => {
          const { hours, minutes } = getLocalTimeComponents(timezone, date);
          return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        })(),
      }),
    );
    return;
  }

  // Publish a queue message for each due schedule
  for (const { schedule } of dueSchedules) {
    const message = buildPromptQueueMessage(schedule, userId, phoneNumber, timezone, date);

    await env.QUEUE.send(message);

    console.log(
      JSON.stringify({
        level: 'info',
        handler: 'scheduler',
        msg: 'Scheduled prompt queued',
        scheduleId: schedule.id,
        scheduleType: schedule.type,
        userId,
      }),
    );
  }
}

/**
 * Process a scheduled-prompt queue message: send the prompt via WhatsApp.
 *
 * This is called by the queue consumer when it receives a `scheduled-prompt`
 * message. It parses the payload and sends the appropriate prompt text
 * to the user's WhatsApp number using the Cloud API.
 *
 * @param rawBody - The JSON string from the queue message's rawBody field.
 * @param env - The Worker environment bindings.
 */
export async function processScheduledPrompt(
  rawBody: string,
  env: Env,
): Promise<void> {
  const body: ScheduledPromptBody = JSON.parse(rawBody);
  const promptText = getPromptText(body.scheduleType);

  // Send via WhatsApp Cloud API
  const response = await fetch(
    `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: body.phoneNumber,
        type: 'text',
        text: { body: promptText },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `WhatsApp API error (${response.status}): ${errorText}`,
    );
  }

  console.log(
    JSON.stringify({
      level: 'info',
      handler: 'scheduled-prompt',
      msg: 'Prompt sent via WhatsApp',
      scheduleId: body.scheduleId,
      scheduleType: body.scheduleType,
      userId: body.userId,
    }),
  );
}
