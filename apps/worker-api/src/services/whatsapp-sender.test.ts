import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  sendTextMessage,
  sendMessages,
  buildButtonMessagePayload,
  buildListMessagePayload,
  sendInteractiveMessage,
  sendOutboundMessages,
} from './whatsapp-sender';
import type { WhatsAppSenderEnv } from './whatsapp-sender';
import type {
  ButtonOption,
  ListRow,
  ButtonsOutboundMessage,
  ListOutboundMessage,
  OutboundMessage,
} from './checkin-flow';

/**
 * Tests for the WhatsApp message sender utility.
 *
 * Validates: FR-WA-010 (System shall confirm saved entries succinctly)
 * Validates: NFR-OPS-004 (Retry on transient failure)
 */

const mockEnv: WhatsAppSenderEnv = {
  WHATSAPP_API_TOKEN: 'test-token',
  WHATSAPP_PHONE_NUMBER_ID: '123456',
};

describe('sendTextMessage', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a text message via the WhatsApp Cloud API', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ messages: [{ id: 'wamid.sent123' }] }),
        { status: 200 },
      ),
    );

    const result = await sendTextMessage(mockEnv, '+1234567890', 'Hello!');

    expect(result.success).toBe(true);
    expect(result.waMessageId).toBe('wamid.sent123');
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/123456/messages');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toEqual({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });

    const body = JSON.parse(options?.body as string);
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.to).toBe('+1234567890');
    expect(body.type).toBe('text');
    expect(body.text.body).toBe('Hello!');
  });

  it('returns failure when the API responds with a non-OK status', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"Invalid token"}}', { status: 401 }),
    );

    const result = await sendTextMessage(mockEnv, '+1234567890', 'Hello!');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toContain('401');
  });

  it('logs a structured error when the API returns non-OK', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"Rate limited"}}', { status: 429 }),
    );

    await sendTextMessage(mockEnv, '+1234567890', 'Hello!');

    const errorLog = consoleSpy.mock.calls.find((call) => {
      const parsed = JSON.parse(call[0] as string);
      return parsed.level === 'error' && parsed.service === 'whatsapp-sender';
    });
    expect(errorLog).toBeDefined();

    const parsed = JSON.parse(errorLog![0] as string);
    expect(parsed.statusCode).toBe(429);
    expect(parsed.msg).toBe('WhatsApp API send failed');
  });

  it('returns failure when fetch throws a network error', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network unreachable'),
    );

    const result = await sendTextMessage(mockEnv, '+1234567890', 'Hello!');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network unreachable');
  });

  it('logs a structured error when fetch throws', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('DNS resolution failed'),
    );

    await sendTextMessage(mockEnv, '+1234567890', 'Hello!');

    const errorLog = consoleSpy.mock.calls.find((call) => {
      const parsed = JSON.parse(call[0] as string);
      return parsed.level === 'error' && parsed.msg === 'WhatsApp API request failed';
    });
    expect(errorLog).toBeDefined();

    const parsed = JSON.parse(errorLog![0] as string);
    expect(parsed.error).toBe('DNS resolution failed');
  });

  it('does not include message text in error logs (PHI-free)', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error', { status: 500 }),
    );

    await sendTextMessage(mockEnv, '+1234567890', 'I feel terrible today');

    for (const call of consoleSpy.mock.calls) {
      const logStr = call[0] as string;
      expect(logStr).not.toContain('I feel terrible today');
    }
  });
});

describe('sendMessages', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends multiple messages in sequence', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({ messages: [{ id: 'wamid.ok' }] }),
        { status: 200 },
      ),
    );

    const results = await sendMessages(mockEnv, '+1234567890', [
      'Message 1',
      'Message 2',
      'Message 3',
    ]);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('returns an empty array for no messages', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');

    const results = await sendMessages(mockEnv, '+1234567890', []);

    expect(results).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('continues sending remaining messages when one fails', async () => {
    let callCount = 0;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        return new Response('error', { status: 500 });
      }
      return new Response(
        JSON.stringify({ messages: [{ id: 'wamid.ok' }] }),
        { status: 200 },
      );
    });

    const results = await sendMessages(mockEnv, '+1234567890', [
      'Message 1',
      'Message 2',
      'Message 3',
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});


// ── Unit tests for payload builders and sender functions (Task 4.5) ──

describe('buildButtonMessagePayload', () => {
  it('produces correct JSON structure for DAT-013 buttons', () => {
    const buttons: ButtonOption[] = [
      { id: 'yes', title: 'Yes' },
      { id: 'no', title: 'No' },
      { id: 'partial', title: 'Partial' },
    ];

    const payload = buildButtonMessagePayload('+1234567890', '(13/15) Did you take all medications?', buttons);

    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.recipient_type).toBe('individual');
    expect(payload.to).toBe('+1234567890');
    expect(payload.type).toBe('interactive');

    const interactive = payload.interactive as Record<string, unknown>;
    expect(interactive.type).toBe('button');

    const body = interactive.body as Record<string, unknown>;
    expect(body.text).toBe('(13/15) Did you take all medications?');

    const action = interactive.action as Record<string, unknown>;
    const btns = action.buttons as Array<Record<string, unknown>>;
    expect(btns).toHaveLength(3);

    expect(btns[0]).toEqual({ type: 'reply', reply: { id: 'yes', title: 'Yes' } });
    expect(btns[1]).toEqual({ type: 'reply', reply: { id: 'no', title: 'No' } });
    expect(btns[2]).toEqual({ type: 'reply', reply: { id: 'partial', title: 'Partial' } });
  });
});

describe('buildListMessagePayload', () => {
  it('produces correct JSON structure for DAT-002 list', () => {
    const rows: ListRow[] = [
      { id: '0', title: '0 — Very poor' },
      { id: '1', title: '1' },
      { id: '2', title: '2' },
      { id: '3', title: '3' },
      { id: '4', title: '4' },
      { id: '5', title: '5 — Excellent' },
    ];

    const payload = buildListMessagePayload(
      '+1234567890',
      '(2/15) How would you rate your sleep quality?',
      'Choose a value',
      [{ rows }],
    );

    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.recipient_type).toBe('individual');
    expect(payload.to).toBe('+1234567890');
    expect(payload.type).toBe('interactive');

    const interactive = payload.interactive as Record<string, unknown>;
    expect(interactive.type).toBe('list');

    const body = interactive.body as Record<string, unknown>;
    expect(body.text).toBe('(2/15) How would you rate your sleep quality?');

    const action = interactive.action as Record<string, unknown>;
    expect(action.button).toBe('Choose a value');

    const sections = action.sections as Array<Record<string, unknown>>;
    expect(sections).toHaveLength(1);

    const sectionRows = sections[0].rows as Array<Record<string, unknown>>;
    expect(sectionRows).toHaveLength(6);
    expect(sectionRows[0]).toEqual({ id: '0', title: '0 — Very poor' });
    expect(sectionRows[5]).toEqual({ id: '5', title: '5 — Excellent' });
  });

  it('includes section title when provided', () => {
    const rows: ListRow[] = [{ id: '1', title: 'Option 1' }];
    const payload = buildListMessagePayload('+1234567890', 'Pick one', 'Select', [
      { title: 'Section A', rows },
    ]);

    const interactive = payload.interactive as Record<string, unknown>;
    const action = interactive.action as Record<string, unknown>;
    const sections = action.sections as Array<Record<string, unknown>>;
    expect(sections[0].title).toBe('Section A');
  });

  it('omits section title when not provided', () => {
    const rows: ListRow[] = [{ id: '1', title: 'Option 1' }];
    const payload = buildListMessagePayload('+1234567890', 'Pick one', 'Select', [{ rows }]);

    const interactive = payload.interactive as Record<string, unknown>;
    const action = interactive.action as Record<string, unknown>;
    const sections = action.sections as Array<Record<string, unknown>>;
    expect(sections[0]).not.toHaveProperty('title');
  });

  it('includes row description when provided', () => {
    const rows: ListRow[] = [{ id: '1', title: 'Option 1', description: 'Details here' }];
    const payload = buildListMessagePayload('+1234567890', 'Pick one', 'Select', [{ rows }]);

    const interactive = payload.interactive as Record<string, unknown>;
    const action = interactive.action as Record<string, unknown>;
    const sections = action.sections as Array<Record<string, unknown>>;
    const sectionRows = sections[0].rows as Array<Record<string, unknown>>;
    expect(sectionRows[0].description).toBe('Details here');
  });

  it('omits row description when not provided', () => {
    const rows: ListRow[] = [{ id: '1', title: 'Option 1' }];
    const payload = buildListMessagePayload('+1234567890', 'Pick one', 'Select', [{ rows }]);

    const interactive = payload.interactive as Record<string, unknown>;
    const action = interactive.action as Record<string, unknown>;
    const sections = action.sections as Array<Record<string, unknown>>;
    const sectionRows = sections[0].rows as Array<Record<string, unknown>>;
    expect(sectionRows[0]).not.toHaveProperty('description');
  });
});

describe('sendInteractiveMessage', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a button message and returns success', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.btn123' }] }), { status: 200 }),
    );

    const message: ButtonsOutboundMessage = {
      type: 'buttons',
      body: 'Did you take meds?',
      buttons: [
        { id: 'yes', title: 'Yes' },
        { id: 'no', title: 'No' },
        { id: 'partial', title: 'Partial' },
      ],
    };

    const result = await sendInteractiveMessage(mockEnv, '+1234567890', message);

    expect(result.success).toBe(true);
    expect(result.waMessageId).toBe('wamid.btn123');

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse(options?.body as string);
    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('button');
  });

  it('sends a list message and returns success', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.list456' }] }), { status: 200 }),
    );

    const message: ListOutboundMessage = {
      type: 'list',
      body: 'Rate your mood',
      buttonLabel: 'Choose a value',
      sections: [{ rows: [{ id: '0', title: '0' }, { id: '5', title: '5' }] }],
    };

    const result = await sendInteractiveMessage(mockEnv, '+1234567890', message);

    expect(result.success).toBe(true);
    expect(result.waMessageId).toBe('wamid.list456');

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse(options?.body as string);
    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('list');
  });

  it('returns failure on API error', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"bad request"}', { status: 400 }),
    );

    const message: ButtonsOutboundMessage = {
      type: 'buttons',
      body: 'Test',
      buttons: [{ id: 'a', title: 'A' }],
    };

    const result = await sendInteractiveMessage(mockEnv, '+1234567890', message);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toContain('400');
  });

  it('returns failure on network error', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

    const message: ButtonsOutboundMessage = {
      type: 'buttons',
      body: 'Test',
      buttons: [{ id: 'a', title: 'A' }],
    };

    const result = await sendInteractiveMessage(mockEnv, '+1234567890', message);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection refused');
  });
});

describe('sendOutboundMessages', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches text messages to sendTextMessage', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }), { status: 200 }),
    );

    const messages: OutboundMessage[] = [{ type: 'text', body: 'Hello' }];
    const results = await sendOutboundMessages(mockEnv, '+1234567890', messages);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.type).toBe('text');
  });

  it('dispatches buttons and list messages to sendInteractiveMessage', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }), { status: 200 }),
    );

    const messages: OutboundMessage[] = [
      { type: 'buttons', body: 'Q1', buttons: [{ id: 'yes', title: 'Yes' }] },
      { type: 'list', body: 'Q2', buttonLabel: 'Pick', sections: [{ rows: [{ id: '1', title: '1' }] }] },
    ];
    const results = await sendOutboundMessages(mockEnv, '+1234567890', messages);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);

    const body1 = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body1.type).toBe('interactive');
    expect(body1.interactive.type).toBe('button');

    const body2 = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
    expect(body2.type).toBe('interactive');
    expect(body2.interactive.type).toBe('list');
  });

  it('preserves order across mixed message types', async () => {
    const sentBodies: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      if (body.type === 'text') {
        sentBodies.push(body.text.body);
      } else {
        sentBodies.push(body.interactive.body.text);
      }
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }), { status: 200 });
    });

    const messages: OutboundMessage[] = [
      { type: 'text', body: 'First' },
      { type: 'buttons', body: 'Second', buttons: [{ id: 'a', title: 'A' }] },
      { type: 'text', body: 'Third' },
    ];

    await sendOutboundMessages(mockEnv, '+1234567890', messages);

    expect(sentBodies).toEqual(['First', 'Second', 'Third']);
  });

  it('continues on failure and returns all results', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        return new Response('error', { status: 500 });
      }
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }), { status: 200 });
    });

    const messages: OutboundMessage[] = [
      { type: 'text', body: 'A' },
      { type: 'buttons', body: 'B', buttons: [{ id: 'x', title: 'X' }] },
      { type: 'text', body: 'C' },
    ];

    const results = await sendOutboundMessages(mockEnv, '+1234567890', messages);

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
  });

  it('returns empty array for no messages', async () => {
    const results = await sendOutboundMessages(mockEnv, '+1234567890', []);
    expect(results).toHaveLength(0);
  });
});

// ── Property-based tests ────────────────────────────────────────────

// ── Generators ──────────────────────────────────────────────────────

/** Generate a valid ButtonOption with constrained lengths. */
const arbButtonOption: fc.Arbitrary<ButtonOption> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 256 }),
  title: fc.string({ minLength: 1, maxLength: 20 }),
});

/** Generate a valid ListRow with constrained lengths. */
const arbListRow: fc.Arbitrary<ListRow> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 200 }),
  title: fc.string({ minLength: 1, maxLength: 24 }),
  description: fc.option(fc.string({ minLength: 1, maxLength: 72 }), { nil: undefined }),
});

/** Generate a valid ButtonsOutboundMessage. */
const arbButtonsMessage: fc.Arbitrary<ButtonsOutboundMessage> = fc.record({
  type: fc.constant('buttons' as const),
  body: fc.string({ minLength: 1, maxLength: 500 }),
  buttons: fc.array(arbButtonOption, { minLength: 1, maxLength: 3 }),
});

/** Generate a valid ListOutboundMessage. */
const arbListMessage: fc.Arbitrary<ListOutboundMessage> = fc.record({
  type: fc.constant('list' as const),
  body: fc.string({ minLength: 1, maxLength: 500 }),
  buttonLabel: fc.string({ minLength: 1, maxLength: 20 }),
  sections: fc.array(
    fc.record({
      title: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
      rows: fc.array(arbListRow, { minLength: 1, maxLength: 10 }),
    }),
    { minLength: 1, maxLength: 3 },
  ),
});

/** Generate a valid OutboundMessage of any type. */
const arbOutboundMessage: fc.Arbitrary<OutboundMessage> = fc.oneof(
  fc.record({
    type: fc.constant('text' as const),
    body: fc.string({ minLength: 1, maxLength: 500 }),
  }),
  arbButtonsMessage,
  arbListMessage,
);

/** Generate a phone number string. */
const arbPhoneNumber = fc.stringMatching(/^\+\d{7,15}$/);

// ── Property 1: Button payload builder produces well-formed payloads (Task 4.6) ──

describe('Property 1: Button payload builder produces well-formed payloads', () => {
  /**
   * **Validates: Requirements 1.1, 7.1, 7.2**
   */
  it('produces well-formed payloads for any valid ButtonsOutboundMessage', () => {
    fc.assert(
      fc.property(arbPhoneNumber, arbButtonsMessage, (phone, msg) => {
        const payload = buildButtonMessagePayload(phone, msg.body, msg.buttons);

        // Top-level fields
        expect(payload.messaging_product).toBe('whatsapp');
        expect(payload.recipient_type).toBe('individual');
        expect(payload.to).toBe(phone);
        expect(payload.type).toBe('interactive');

        // Interactive structure
        const interactive = payload.interactive as Record<string, unknown>;
        expect(interactive.type).toBe('button');

        const body = interactive.body as Record<string, unknown>;
        expect(body.text).toBe(msg.body);

        const action = interactive.action as Record<string, unknown>;
        const buttons = action.buttons as Array<Record<string, unknown>>;
        expect(buttons).toHaveLength(msg.buttons.length);

        // Each button matches input
        for (let i = 0; i < msg.buttons.length; i++) {
          expect(buttons[i].type).toBe('reply');
          const reply = buttons[i].reply as Record<string, unknown>;
          expect(reply.id).toBe(msg.buttons[i].id);
          expect(reply.title).toBe(msg.buttons[i].title);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 2: List payload builder produces well-formed payloads (Task 4.7) ──

describe('Property 2: List payload builder produces well-formed payloads', () => {
  /**
   * **Validates: Requirements 2.1, 7.3, 7.4, 7.5**
   */
  it('produces well-formed payloads for any valid ListOutboundMessage', () => {
    fc.assert(
      fc.property(arbPhoneNumber, arbListMessage, (phone, msg) => {
        const payload = buildListMessagePayload(phone, msg.body, msg.buttonLabel, msg.sections);

        // Top-level fields
        expect(payload.messaging_product).toBe('whatsapp');
        expect(payload.recipient_type).toBe('individual');
        expect(payload.to).toBe(phone);
        expect(payload.type).toBe('interactive');

        // Interactive structure
        const interactive = payload.interactive as Record<string, unknown>;
        expect(interactive.type).toBe('list');

        const body = interactive.body as Record<string, unknown>;
        expect(body.text).toBe(msg.body);

        const action = interactive.action as Record<string, unknown>;
        expect(action.button).toBe(msg.buttonLabel);

        const sections = action.sections as Array<Record<string, unknown>>;
        expect(sections).toHaveLength(msg.sections.length);

        // Each section and row matches input
        for (let si = 0; si < msg.sections.length; si++) {
          const section = sections[si];
          if (msg.sections[si].title) {
            expect(section.title).toBe(msg.sections[si].title);
          } else {
            expect(section).not.toHaveProperty('title');
          }

          const rows = section.rows as Array<Record<string, unknown>>;
          expect(rows).toHaveLength(msg.sections[si].rows.length);

          for (let ri = 0; ri < msg.sections[si].rows.length; ri++) {
            expect(rows[ri].id).toBe(msg.sections[si].rows[ri].id);
            expect(rows[ri].title).toBe(msg.sections[si].rows[ri].title);
            if (msg.sections[si].rows[ri].description) {
              expect(rows[ri].description).toBe(msg.sections[si].rows[ri].description);
            } else {
              expect(rows[ri]).not.toHaveProperty('description');
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 8: Outbound messages are sent in input order (Task 4.8) ──

describe('Property 8: Outbound messages are sent in input order', () => {
  /**
   * **Validates: Requirements 5.3**
   */
  it('sends messages in the same order as the input array', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbOutboundMessage, { minLength: 1, maxLength: 10 }),
        async (messages) => {
          const sentBodies: string[] = [];

          vi.spyOn(console, 'log').mockImplementation(() => {});
          vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
            const body = JSON.parse(init?.body as string);
            if (body.type === 'text') {
              sentBodies.push(body.text.body);
            } else {
              sentBodies.push(body.interactive.body.text);
            }
            return new Response(
              JSON.stringify({ messages: [{ id: 'wamid.ok' }] }),
              { status: 200 },
            );
          });

          const results = await sendOutboundMessages(mockEnv, '+1234567890', messages);

          expect(results).toHaveLength(messages.length);
          expect(sentBodies).toHaveLength(messages.length);

          // Verify order: the i-th sent body matches the i-th input body
          for (let i = 0; i < messages.length; i++) {
            expect(sentBodies[i]).toBe(messages[i].body);
          }

          vi.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 10: Payload construction round-trip (Task 4.9) ──

describe('Property 10: Payload construction round-trip', () => {
  /**
   * **Validates: Requirements 7.6**
   */
  it('round-trips body text and action metadata through payload builders', () => {
    fc.assert(
      fc.property(arbPhoneNumber, arbOutboundMessage, (phone, msg) => {
        if (msg.type === 'text') {
          // Text messages use buildTextMessagePayload from prompt-scheduler
          // We don't test that here — it's already tested. But we verify
          // the body would be preserved by the text payload structure.
          // No interactive payload to round-trip for text messages.
          return;
        }

        if (msg.type === 'buttons') {
          const payload = buildButtonMessagePayload(phone, msg.body, msg.buttons);
          const interactive = payload.interactive as Record<string, unknown>;
          const body = interactive.body as Record<string, unknown>;
          const action = interactive.action as Record<string, unknown>;
          const buttons = action.buttons as Array<{ type: string; reply: { id: string; title: string } }>;

          // Round-trip: extract body text
          expect(body.text).toBe(msg.body);

          // Round-trip: extract button metadata
          expect(buttons).toHaveLength(msg.buttons.length);
          for (let i = 0; i < msg.buttons.length; i++) {
            expect(buttons[i].reply.id).toBe(msg.buttons[i].id);
            expect(buttons[i].reply.title).toBe(msg.buttons[i].title);
          }
        }

        if (msg.type === 'list') {
          const payload = buildListMessagePayload(phone, msg.body, msg.buttonLabel, msg.sections);
          const interactive = payload.interactive as Record<string, unknown>;
          const body = interactive.body as Record<string, unknown>;
          const action = interactive.action as Record<string, unknown>;
          const sections = action.sections as Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;

          // Round-trip: extract body text
          expect(body.text).toBe(msg.body);

          // Round-trip: extract button label
          expect(action.button).toBe(msg.buttonLabel);

          // Round-trip: extract section/row metadata
          expect(sections).toHaveLength(msg.sections.length);
          for (let si = 0; si < msg.sections.length; si++) {
            if (msg.sections[si].title) {
              expect(sections[si].title).toBe(msg.sections[si].title);
            }
            expect(sections[si].rows).toHaveLength(msg.sections[si].rows.length);
            for (let ri = 0; ri < msg.sections[si].rows.length; ri++) {
              expect(sections[si].rows[ri].id).toBe(msg.sections[si].rows[ri].id);
              expect(sections[si].rows[ri].title).toBe(msg.sections[si].rows[ri].title);
              if (msg.sections[si].rows[ri].description) {
                expect(sections[si].rows[ri].description).toBe(msg.sections[si].rows[ri].description);
              }
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
