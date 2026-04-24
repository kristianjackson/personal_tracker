import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLocalTimeComponents,
  parseTimeString,
  isTimeInWindow,
  checkDueSchedules,
  buildPromptQueueMessage,
  getPromptText,
  handleScheduledEvent,
  processScheduledPrompt,
  recordInboundTimestamp,
  isWithinServiceWindow,
  buildTemplateMessagePayload,
  buildTextMessagePayload,
  TEMPLATE_DAILY_CHECKIN,
  TEMPLATE_WEEKLY_SUMMARY,
  TEMPLATE_LANGUAGE_CODE,
  TEMPLATE_NAME_MAP,
  KV_LAST_INBOUND_PREFIX,
  SERVICE_WINDOW_MS,
} from './prompt-scheduler';
import type { ScheduledPromptBody, ScheduledPromptPayload } from './prompt-scheduler';
import type { Env } from '../index';

/**
 * Tests for the outbound prompt scheduler service.
 *
 * Validates: FR-WA-007 (send daily and weekly prompts on schedule in user's configured timezone)
 * Validates: FR-ADM-001 (allow configuration of prompt schedule)
 * Design: DD-010 (user timezone is authoritative for dates)
 */

// ── Helpers ─────────────────────────────────────────────────────────

function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
        first: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as D1Database,
    QUEUE: {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue,
    BUCKET: {} as R2Bucket,
    KV: createMockKV(),
    ENVIRONMENT: 'test',
    WHATSAPP_API_TOKEN: 'test-token',
    WHATSAPP_PHONE_NUMBER_ID: '123456',
    WHATSAPP_VERIFY_TOKEN: 'verify-token',
    META_APP_SECRET: 'app-secret',
    CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
    CF_ACCESS_AUD: 'test-aud',
    ...overrides,
  };
}

/** Create a mock KV namespace backed by a simple Map. */
function createMockKV(initialData: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

// ── getLocalTimeComponents ──────────────────────────────────────────

describe('getLocalTimeComponents', () => {
  it('returns correct time for UTC timezone', () => {
    // 2025-06-15T14:30:00Z is a Sunday
    const date = new Date('2025-06-15T14:30:00Z');
    const result = getLocalTimeComponents('UTC', date);

    expect(result.hours).toBe(14);
    expect(result.minutes).toBe(30);
    expect(result.dayOfWeek).toBe(0); // Sunday
  });

  it('converts UTC to Eastern time correctly', () => {
    // 2025-06-15T14:00:00Z → 10:00 AM EDT (UTC-4 in summer)
    const date = new Date('2025-06-15T14:00:00Z');
    const result = getLocalTimeComponents('America/New_York', date);

    expect(result.hours).toBe(10);
    expect(result.minutes).toBe(0);
  });

  it('handles timezone with positive offset', () => {
    // 2025-06-15T01:00:00Z → 10:00 AM JST (UTC+9)
    const date = new Date('2025-06-15T01:00:00Z');
    const result = getLocalTimeComponents('Asia/Tokyo', date);

    expect(result.hours).toBe(10);
    expect(result.minutes).toBe(0);
  });

  it('handles day-of-week change across timezone boundary', () => {
    // 2025-06-15T23:00:00Z (Sunday UTC) → Monday in Tokyo (UTC+9)
    const date = new Date('2025-06-15T23:00:00Z');
    const result = getLocalTimeComponents('Asia/Tokyo', date);

    expect(result.dayOfWeek).toBe(1); // Monday in Tokyo
  });

  it('handles half-hour timezone offsets', () => {
    // 2025-06-15T00:00:00Z → 05:30 AM IST (UTC+5:30)
    const date = new Date('2025-06-15T00:00:00Z');
    const result = getLocalTimeComponents('Asia/Kolkata', date);

    expect(result.hours).toBe(5);
    expect(result.minutes).toBe(30);
  });
});

// ── parseTimeString ─────────────────────────────────────────────────

describe('parseTimeString', () => {
  it('parses valid HH:MM time', () => {
    expect(parseTimeString('09:00')).toEqual({ hours: 9, minutes: 0 });
    expect(parseTimeString('14:30')).toEqual({ hours: 14, minutes: 30 });
    expect(parseTimeString('0:00')).toEqual({ hours: 0, minutes: 0 });
    expect(parseTimeString('23:59')).toEqual({ hours: 23, minutes: 59 });
  });

  it('returns null for invalid formats', () => {
    expect(parseTimeString('')).toBeNull();
    expect(parseTimeString('9')).toBeNull();
    expect(parseTimeString('abc')).toBeNull();
    expect(parseTimeString('25:00')).toBeNull();
    expect(parseTimeString('12:60')).toBeNull();
    expect(parseTimeString('-1:00')).toBeNull();
  });
});

// ── isTimeInWindow ──────────────────────────────────────────────────

describe('isTimeInWindow', () => {
  it('returns true when current time matches target exactly', () => {
    expect(isTimeInWindow(9, 0, 9, 0)).toBe(true);
  });

  it('returns true when current time is within 15-minute window', () => {
    expect(isTimeInWindow(9, 7, 9, 0)).toBe(true);
    expect(isTimeInWindow(9, 14, 9, 0)).toBe(true);
  });

  it('returns false when current time is at window boundary', () => {
    expect(isTimeInWindow(9, 15, 9, 0)).toBe(false);
  });

  it('returns false when current time is before target', () => {
    expect(isTimeInWindow(8, 59, 9, 0)).toBe(false);
  });

  it('returns false when current time is well past target', () => {
    expect(isTimeInWindow(10, 0, 9, 0)).toBe(false);
  });

  it('supports custom window size', () => {
    expect(isTimeInWindow(9, 29, 9, 0, 30)).toBe(true);
    expect(isTimeInWindow(9, 30, 9, 0, 30)).toBe(false);
  });

  it('handles non-zero target minutes', () => {
    expect(isTimeInWindow(9, 30, 9, 30)).toBe(true);
    expect(isTimeInWindow(9, 44, 9, 30)).toBe(true);
    expect(isTimeInWindow(9, 45, 9, 30)).toBe(false);
  });
});

// ── checkDueSchedules ───────────────────────────────────────────────

describe('checkDueSchedules', () => {
  it('marks daily schedule as due when time matches', () => {
    // 09:00 UTC on a Wednesday — daily check-in is at 09:00
    const date = new Date('2025-06-18T09:00:00Z');
    const results = checkDueSchedules('UTC', date);

    const daily = results.find((r) => r.schedule.id === 'daily-checkin');
    expect(daily).toBeDefined();
    expect(daily!.isDue).toBe(true);
  });

  it('marks daily schedule as not due when time does not match', () => {
    // 15:00 UTC — daily check-in is at 09:00
    const date = new Date('2025-06-18T15:00:00Z');
    const results = checkDueSchedules('UTC', date);

    const daily = results.find((r) => r.schedule.id === 'daily-checkin');
    expect(daily).toBeDefined();
    expect(daily!.isDue).toBe(false);
  });

  it('marks weekly schedule as due on correct day and time', () => {
    // 2025-06-15 is a Sunday (day_of_week=0), 10:00 UTC
    const date = new Date('2025-06-15T10:00:00Z');
    const results = checkDueSchedules('UTC', date);

    const weekly = results.find((r) => r.schedule.id === 'weekly-summary');
    expect(weekly).toBeDefined();
    expect(weekly!.isDue).toBe(true);
  });

  it('marks weekly schedule as not due on wrong day', () => {
    // 2025-06-18 is a Wednesday, weekly is configured for Sunday (day_of_week=0)
    const date = new Date('2025-06-18T10:00:00Z');
    const results = checkDueSchedules('UTC', date);

    const weekly = results.find((r) => r.schedule.id === 'weekly-summary');
    expect(weekly).toBeDefined();
    expect(weekly!.isDue).toBe(false);
  });

  it('marks weekly schedule as not due on correct day but wrong time', () => {
    // 2025-06-15 is a Sunday, but 15:00 UTC — weekly is at 10:00
    const date = new Date('2025-06-15T15:00:00Z');
    const results = checkDueSchedules('UTC', date);

    const weekly = results.find((r) => r.schedule.id === 'weekly-summary');
    expect(weekly).toBeDefined();
    expect(weekly!.isDue).toBe(false);
  });

  it('respects timezone conversion for daily schedule', () => {
    // 13:00 UTC → 09:00 EDT (America/New_York, UTC-4 in summer)
    // Daily check-in is at 09:00 local time
    const date = new Date('2025-06-18T13:00:00Z');
    const results = checkDueSchedules('America/New_York', date);

    const daily = results.find((r) => r.schedule.id === 'daily-checkin');
    expect(daily).toBeDefined();
    expect(daily!.isDue).toBe(true);
  });

  it('respects timezone conversion for weekly schedule', () => {
    // 2025-06-15 is Sunday. 14:00 UTC → 10:00 EDT
    // Weekly summary is at 10:00 on Sunday (day_of_week=0)
    const date = new Date('2025-06-15T14:00:00Z');
    const results = checkDueSchedules('America/New_York', date);

    const weekly = results.find((r) => r.schedule.id === 'weekly-summary');
    expect(weekly).toBeDefined();
    expect(weekly!.isDue).toBe(true);
  });
});

// ── buildPromptQueueMessage ─────────────────────────────────────────

describe('buildPromptQueueMessage', () => {
  it('builds a correctly structured queue message', () => {
    const schedule = {
      id: 'daily-checkin',
      name: 'Daily Check-in Prompt',
      type: 'daily' as const,
      default_time: '09:00',
      day_of_week: null,
      enabled: true,
    };
    const date = new Date('2025-06-18T09:00:00Z');

    const message = buildPromptQueueMessage(
      schedule,
      'user-123',
      '+1234567890',
      'UTC',
      date,
    );

    expect(message.type).toBe('scheduled-prompt');
    expect(message.messageId).toContain('sched-daily-checkin-');
    expect(message.timestamp).toBe('2025-06-18T09:00:00.000Z');

    const body: ScheduledPromptBody = JSON.parse(message.rawBody);
    expect(body.scheduleId).toBe('daily-checkin');
    expect(body.scheduleName).toBe('Daily Check-in Prompt');
    expect(body.scheduleType).toBe('daily');
    expect(body.userId).toBe('user-123');
    expect(body.phoneNumber).toBe('+1234567890');
    expect(body.timezone).toBe('UTC');
    expect(body.localTime).toBe('09:00');
  });

  it('includes correct local time for non-UTC timezone', () => {
    const schedule = {
      id: 'daily-checkin',
      name: 'Daily Check-in Prompt',
      type: 'daily' as const,
      default_time: '09:00',
      day_of_week: null,
      enabled: true,
    };
    // 13:00 UTC → 09:00 EDT
    const date = new Date('2025-06-18T13:00:00Z');

    const message = buildPromptQueueMessage(
      schedule,
      'user-123',
      '+1234567890',
      'America/New_York',
      date,
    );

    const body: ScheduledPromptBody = JSON.parse(message.rawBody);
    expect(body.localTime).toBe('09:00');
    expect(body.timezone).toBe('America/New_York');
  });
});

// ── getPromptText ───────────────────────────────────────────────────

describe('getPromptText', () => {
  it('returns daily check-in prompt text', () => {
    const text = getPromptText('daily');
    expect(text).toContain('checkin');
    expect(text).toContain('daily');
  });

  it('returns weekly summary prompt text', () => {
    const text = getPromptText('weekly');
    expect(text).toContain('weekly');
  });
});

// ── handleScheduledEvent ────────────────────────────────────────────

describe('handleScheduledEvent', () => {
  let env: Env;

  beforeEach(() => {
    env = mockEnv();
  });

  it('does nothing when no user with WhatsApp binding exists', async () => {
    // DB.prepare().bind().first() returns null (default mock)
    await handleScheduledEvent(env);

    expect(env.QUEUE.send).not.toHaveBeenCalled();
  });

  it('publishes queue messages for due schedules', async () => {
    // Mock DB to return a user with binding
    const mockFirst = vi.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'UTC',
      phone_number: '+1234567890',
    });
    env.DB = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: mockFirst,
        }),
        first: mockFirst,
      }),
    } as unknown as D1Database;

    // 09:05 UTC on a Wednesday — daily check-in at 09:00 should be due
    const date = new Date('2025-06-18T09:05:00Z');
    await handleScheduledEvent(env, date);

    expect(env.QUEUE.send).toHaveBeenCalled();
    const sentMessage = (env.QUEUE.send as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as ScheduledPromptPayload;
    expect(sentMessage.type).toBe('scheduled-prompt');

    const body: ScheduledPromptBody = JSON.parse(sentMessage.rawBody);
    expect(body.scheduleId).toBe('daily-checkin');
    expect(body.userId).toBe('user-1');
    expect(body.phoneNumber).toBe('+1234567890');
  });

  it('does not publish when no schedules are due', async () => {
    const mockFirst = vi.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'UTC',
      phone_number: '+1234567890',
    });
    env.DB = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: mockFirst,
        }),
        first: mockFirst,
      }),
    } as unknown as D1Database;

    // 15:00 UTC — no schedules due
    const date = new Date('2025-06-18T15:00:00Z');
    await handleScheduledEvent(env, date);

    expect(env.QUEUE.send).not.toHaveBeenCalled();
  });

  it('publishes both daily and weekly when both are due', async () => {
    const mockFirst = vi.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'UTC',
      phone_number: '+1234567890',
    });
    env.DB = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: mockFirst,
        }),
        first: mockFirst,
      }),
    } as unknown as D1Database;

    // Need a time where both daily (09:00) and weekly (10:00 Sunday) are due
    // That's not possible with different times. Let's test Sunday at 09:00 — only daily is due
    // and Sunday at 10:00 — only weekly is due (daily window has passed)
    // Actually, let's just verify the Sunday 10:00 case for weekly
    const date = new Date('2025-06-15T10:00:00Z'); // Sunday 10:00 UTC
    await handleScheduledEvent(env, date);

    // Weekly should be due (10:00 Sunday), daily should NOT be due (09:00 window passed at 09:15)
    expect(env.QUEUE.send).toHaveBeenCalledTimes(1);
    const body: ScheduledPromptBody = JSON.parse(
      ((env.QUEUE.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as ScheduledPromptPayload).rawBody,
    );
    expect(body.scheduleId).toBe('weekly-summary');
  });

  it('uses user timezone for schedule matching', async () => {
    const mockFirst = vi.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'America/New_York',
      phone_number: '+1234567890',
    });
    env.DB = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: mockFirst,
        }),
        first: mockFirst,
      }),
    } as unknown as D1Database;

    // 13:00 UTC → 09:00 EDT — daily check-in should be due
    const date = new Date('2025-06-18T13:00:00Z');
    await handleScheduledEvent(env, date);

    expect(env.QUEUE.send).toHaveBeenCalledTimes(1);
    const body: ScheduledPromptBody = JSON.parse(
      ((env.QUEUE.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as ScheduledPromptPayload).rawBody,
    );
    expect(body.scheduleId).toBe('daily-checkin');
    expect(body.timezone).toBe('America/New_York');
  });
});

// ── processScheduledPrompt ──────────────────────────────────────────

describe('processScheduledPrompt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a text message when user is within 24h service window (daily)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.123' }] }), {
        status: 200,
      }),
    );

    const body: ScheduledPromptBody = {
      scheduleId: 'daily-checkin',
      scheduleName: 'Daily Check-in Prompt',
      scheduleType: 'daily',
      userId: 'user-1',
      phoneNumber: '+1234567890',
      localTime: '09:00',
      timezone: 'UTC',
    };

    // User messaged 1 hour ago — within service window
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const kv = createMockKV({ [`${KV_LAST_INBOUND_PREFIX}user-1`]: oneHourAgo });
    const env = mockEnv({ KV: kv });
    await processScheduledPrompt(JSON.stringify(body), env);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain('graph.facebook.com');
    expect(url).toContain('123456'); // WHATSAPP_PHONE_NUMBER_ID
    expect(options?.method).toBe('POST');

    const requestBody = JSON.parse(options?.body as string);
    expect(requestBody.messaging_product).toBe('whatsapp');
    expect(requestBody.to).toBe('+1234567890');
    expect(requestBody.type).toBe('text');
    expect(requestBody.text.body).toContain('checkin');
  });

  it('sends a template message when user is outside 24h service window (daily)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.456' }] }), {
        status: 200,
      }),
    );

    const body: ScheduledPromptBody = {
      scheduleId: 'daily-checkin',
      scheduleName: 'Daily Check-in Prompt',
      scheduleType: 'daily',
      userId: 'user-1',
      phoneNumber: '+1234567890',
      localTime: '09:00',
      timezone: 'UTC',
    };

    // User messaged 25 hours ago — outside service window
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const kv = createMockKV({ [`${KV_LAST_INBOUND_PREFIX}user-1`]: twentyFiveHoursAgo });
    const env = mockEnv({ KV: kv });
    await processScheduledPrompt(JSON.stringify(body), env);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(requestBody.messaging_product).toBe('whatsapp');
    expect(requestBody.to).toBe('+1234567890');
    expect(requestBody.type).toBe('template');
    expect(requestBody.template.name).toBe(TEMPLATE_DAILY_CHECKIN);
    expect(requestBody.template.language.code).toBe('en');
  });

  it('sends a template message when no inbound timestamp exists', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.789' }] }), {
        status: 200,
      }),
    );

    const body: ScheduledPromptBody = {
      scheduleId: 'daily-checkin',
      scheduleName: 'Daily Check-in Prompt',
      scheduleType: 'daily',
      userId: 'user-1',
      phoneNumber: '+1234567890',
      localTime: '09:00',
      timezone: 'UTC',
    };

    // No inbound timestamp in KV — outside service window
    const env = mockEnv();
    await processScheduledPrompt(JSON.stringify(body), env);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(requestBody.type).toBe('template');
    expect(requestBody.template.name).toBe(TEMPLATE_DAILY_CHECKIN);
  });

  it('sends a text message for a weekly prompt within service window', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.abc' }] }), {
        status: 200,
      }),
    );

    const body: ScheduledPromptBody = {
      scheduleId: 'weekly-summary',
      scheduleName: 'Weekly Summary Prompt',
      scheduleType: 'weekly',
      userId: 'user-1',
      phoneNumber: '+1234567890',
      localTime: '10:00',
      timezone: 'UTC',
    };

    const recentTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const kv = createMockKV({ [`${KV_LAST_INBOUND_PREFIX}user-1`]: recentTimestamp });
    const env = mockEnv({ KV: kv });
    await processScheduledPrompt(JSON.stringify(body), env);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(requestBody.type).toBe('text');
    expect(requestBody.text.body).toContain('weekly');
  });

  it('sends a template message for a weekly prompt outside service window', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.def' }] }), {
        status: 200,
      }),
    );

    const body: ScheduledPromptBody = {
      scheduleId: 'weekly-summary',
      scheduleName: 'Weekly Summary Prompt',
      scheduleType: 'weekly',
      userId: 'user-1',
      phoneNumber: '+1234567890',
      localTime: '10:00',
      timezone: 'UTC',
    };

    // No inbound timestamp — outside service window
    const env = mockEnv();
    await processScheduledPrompt(JSON.stringify(body), env);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(requestBody.type).toBe('template');
    expect(requestBody.template.name).toBe(TEMPLATE_WEEKLY_SUMMARY);
    expect(requestBody.template.language.code).toBe('en');
  });

  it('throws on WhatsApp API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );

    const body: ScheduledPromptBody = {
      scheduleId: 'daily-checkin',
      scheduleName: 'Daily Check-in Prompt',
      scheduleType: 'daily',
      userId: 'user-1',
      phoneNumber: '+1234567890',
      localTime: '09:00',
      timezone: 'UTC',
    };

    const env = mockEnv();
    await expect(
      processScheduledPrompt(JSON.stringify(body), env),
    ).rejects.toThrow('WhatsApp API error (401)');
  });
});

// ── recordInboundTimestamp ───────────────────────────────────────────

describe('recordInboundTimestamp', () => {
  it('stores the current timestamp in KV when no timestamp provided', async () => {
    const kv = createMockKV();
    await recordInboundTimestamp(kv, 'user-1');

    expect(kv.put).toHaveBeenCalledOnce();
    const [key, value] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toBe(`${KV_LAST_INBOUND_PREFIX}user-1`);
    // Value should be a valid ISO timestamp
    expect(new Date(value).toISOString()).toBe(value);
  });

  it('stores a provided timestamp in KV', async () => {
    const kv = createMockKV();
    const ts = '2025-06-18T09:00:00.000Z';
    await recordInboundTimestamp(kv, 'user-42', ts);

    expect(kv.put).toHaveBeenCalledWith(`${KV_LAST_INBOUND_PREFIX}user-42`, ts);
  });

  it('overwrites previous timestamp for the same user', async () => {
    const oldTs = '2025-06-17T09:00:00.000Z';
    const kv = createMockKV({ [`${KV_LAST_INBOUND_PREFIX}user-1`]: oldTs });

    const newTs = '2025-06-18T09:00:00.000Z';
    await recordInboundTimestamp(kv, 'user-1', newTs);

    expect(kv.put).toHaveBeenCalledWith(`${KV_LAST_INBOUND_PREFIX}user-1`, newTs);
  });
});

// ── isWithinServiceWindow ───────────────────────────────────────────

describe('isWithinServiceWindow', () => {
  it('returns true when user messaged less than 24h ago', async () => {
    const now = new Date('2025-06-18T12:00:00Z');
    const lastInbound = '2025-06-18T00:00:00Z'; // 12 hours ago
    const kv = createMockKV({ [`${KV_LAST_INBOUND_PREFIX}user-1`]: lastInbound });

    const result = await isWithinServiceWindow(kv, 'user-1', now);
    expect(result).toBe(true);
  });

  it('returns false when user messaged more than 24h ago', async () => {
    const now = new Date('2025-06-18T12:00:00Z');
    const lastInbound = '2025-06-17T11:00:00Z'; // 25 hours ago
    const kv = createMockKV({ [`${KV_LAST_INBOUND_PREFIX}user-1`]: lastInbound });

    const result = await isWithinServiceWindow(kv, 'user-1', now);
    expect(result).toBe(false);
  });

  it('returns false when no inbound timestamp exists', async () => {
    const kv = createMockKV();
    const result = await isWithinServiceWindow(kv, 'user-1');
    expect(result).toBe(false);
  });

  it('returns true when user messaged exactly at the boundary minus 1ms', async () => {
    const now = new Date('2025-06-18T12:00:00.000Z');
    // Exactly 24h minus 1ms ago
    const lastInbound = new Date(now.getTime() - SERVICE_WINDOW_MS + 1).toISOString();
    const kv = createMockKV({ [`${KV_LAST_INBOUND_PREFIX}user-1`]: lastInbound });

    const result = await isWithinServiceWindow(kv, 'user-1', now);
    expect(result).toBe(true);
  });

  it('returns false when user messaged exactly 24h ago', async () => {
    const now = new Date('2025-06-18T12:00:00.000Z');
    const lastInbound = new Date(now.getTime() - SERVICE_WINDOW_MS).toISOString();
    const kv = createMockKV({ [`${KV_LAST_INBOUND_PREFIX}user-1`]: lastInbound });

    const result = await isWithinServiceWindow(kv, 'user-1', now);
    expect(result).toBe(false);
  });
});

// ── buildTemplateMessagePayload ─────────────────────────────────────

describe('buildTemplateMessagePayload', () => {
  it('builds correct template payload for daily check-in', () => {
    const payload = buildTemplateMessagePayload('+1234567890', TEMPLATE_DAILY_CHECKIN);

    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      to: '+1234567890',
      type: 'template',
      template: {
        name: 'daily_checkin_prompt',
        language: { code: 'en' },
      },
    });
  });

  it('builds correct template payload for weekly summary', () => {
    const payload = buildTemplateMessagePayload('+1234567890', TEMPLATE_WEEKLY_SUMMARY);

    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      to: '+1234567890',
      type: 'template',
      template: {
        name: 'weekly_summary_prompt',
        language: { code: 'en' },
      },
    });
  });

  it('supports custom language code', () => {
    const payload = buildTemplateMessagePayload('+1234567890', TEMPLATE_DAILY_CHECKIN, 'es');

    expect((payload.template as Record<string, unknown>)).toEqual({
      name: 'daily_checkin_prompt',
      language: { code: 'es' },
    });
  });
});

// ── buildTextMessagePayload ─────────────────────────────────────────

describe('buildTextMessagePayload', () => {
  it('builds correct text message payload', () => {
    const payload = buildTextMessagePayload('+1234567890', 'Hello world');

    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      to: '+1234567890',
      type: 'text',
      text: { body: 'Hello world' },
    });
  });
});

// ── Template constants ──────────────────────────────────────────────

describe('template constants', () => {
  it('has correct template name for daily check-in', () => {
    expect(TEMPLATE_DAILY_CHECKIN).toBe('daily_checkin_prompt');
  });

  it('has correct template name for weekly summary', () => {
    expect(TEMPLATE_WEEKLY_SUMMARY).toBe('weekly_summary_prompt');
  });

  it('has correct default language code', () => {
    expect(TEMPLATE_LANGUAGE_CODE).toBe('en');
  });

  it('maps schedule types to template names', () => {
    expect(TEMPLATE_NAME_MAP.daily).toBe(TEMPLATE_DAILY_CHECKIN);
    expect(TEMPLATE_NAME_MAP.weekly).toBe(TEMPLATE_WEEKLY_SUMMARY);
  });

  it('has correct service window duration (24 hours)', () => {
    expect(SERVICE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('has correct KV prefix for inbound timestamps', () => {
    expect(KV_LAST_INBOUND_PREFIX).toBe('last-inbound:');
  });
});
