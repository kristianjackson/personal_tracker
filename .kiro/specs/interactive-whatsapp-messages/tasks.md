# Implementation Plan: Interactive WhatsApp Messages

## Overview

Replace plain-text question prompts in the daily check-in flow with interactive WhatsApp messages — list menus for ordinal-scale questions (0–5) and button messages for the structured medication adherence question (yes/no/partial). This involves changes across four modules: `whatsapp-sender.ts`, `checkin-flow.ts`, `queue-consumer.ts`, and their corresponding test files. A `fast-check` dev dependency is added for property-based testing.

## Tasks

- [x] 1. Define OutboundMessage types and update CheckinFlowResult
  - [x] 1.1 Add OutboundMessage type definitions to `checkin-flow.ts`
    - Define `OutboundMessageBase`, `TextOutboundMessage`, `ButtonOption`, `ButtonsOutboundMessage`, `ListRow`, `ListOutboundMessage` interfaces
    - Define the `OutboundMessage` discriminated union type
    - Export all new types for use by other modules
    - _Requirements: 3.1_
  - [x] 1.2 Update `CheckinFlowResult` to use `OutboundMessage[]`
    - Change `messages: string[]` to `messages: OutboundMessage[]` in the `CheckinFlowResult` interface
    - _Requirements: 3.1_
  - [x] 1.3 Add `textMessages` helper function to `checkin-flow.ts`
    - Create a utility function `textMessages(strings: string[]): OutboundMessage[]` that wraps plain strings as `TextOutboundMessage` objects
    - Update all existing return sites in `checkin-flow.ts` that return `string[]` to use `textMessages()` so they produce `OutboundMessage[]`
    - _Requirements: 3.6_

- [x] 2. Implement `buildQuestionMessage` in `checkin-flow.ts`
  - [x] 2.1 Create the `buildQuestionMessage` function
    - Implement the pure function that converts a `QuestionDefinition` into the appropriate `OutboundMessage` based on question type
    - For `ordinal` questions: produce a `ListOutboundMessage` with rows from `scale.min` to `scale.max`, including scale labels on first and last rows
    - For `structured` questions: produce a `ButtonsOutboundMessage` with three buttons (Yes/No/Partial) with IDs `"yes"`, `"no"`, `"partial"`
    - For `numeric` and `text` questions: produce a `TextOutboundMessage`
    - Include the progress indicator `(N/M)` in the body text
    - _Requirements: 3.2, 3.3, 3.4, 3.5_
  - [x] 2.2 Replace `formatQuestionPrompt` calls with `buildQuestionMessage`
    - Update `startCheckin` and `processAnswer` in `checkin-flow.ts` to use `buildQuestionMessage` instead of `formatQuestionPrompt` when building question prompts
    - Ensure non-question messages (confirmations, resumption notices, completion summaries) still use `TextOutboundMessage` via `textMessages()`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 2.3 Write unit tests for `buildQuestionMessage`
    - Test ordinal question produces `ListOutboundMessage` with correct row count and IDs
    - Test structured question produces `ButtonsOutboundMessage` with exactly 3 buttons
    - Test numeric question produces `TextOutboundMessage`
    - Test text question produces `TextOutboundMessage`
    - Test progress indicator is included in body
    - Test scale labels appear on first and last rows for ordinal questions
    - _Requirements: 3.2, 3.3, 3.4, 3.5_
  - [x] 2.4 Write property test for `buildQuestionMessage` — valid type and non-empty body
    - **Property 3: All OutboundMessages have a valid type and non-empty body**
    - Generate random `QuestionDefinition` objects of all types, verify output has valid `type` and non-empty `body` containing the prompt
    - **Validates: Requirements 3.1**
  - [x] 2.5 Write property test for ordinal question list rows
    - **Property 4: Ordinal questions produce list messages with correct scale rows**
    - Generate random ordinal questions with varying `scale.min` and `scale.max`, verify row count equals `(max - min + 1)` and each row ID matches its scale value
    - **Validates: Requirements 3.2**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add interactive payload builders and sender to `whatsapp-sender.ts`
  - [x] 4.1 Implement `buildButtonMessagePayload` function
    - Create a pure function that builds a WhatsApp Cloud API interactive button message payload
    - Payload must include `messaging_product: "whatsapp"`, `recipient_type: "individual"`, `to`, `type: "interactive"`, `interactive.type: "button"`, `interactive.body.text`, and `interactive.action.buttons` array
    - _Requirements: 1.1, 7.1, 7.2_
  - [x] 4.2 Implement `buildListMessagePayload` function
    - Create a pure function that builds a WhatsApp Cloud API interactive list message payload
    - Payload must include `messaging_product: "whatsapp"`, `recipient_type: "individual"`, `to`, `type: "interactive"`, `interactive.type: "list"`, `interactive.body.text`, `interactive.action.button`, and `interactive.action.sections` array
    - _Requirements: 2.1, 7.3, 7.4, 7.5_
  - [x] 4.3 Implement `sendInteractiveMessage` function
    - Create an async function that dispatches to `buildButtonMessagePayload` or `buildListMessagePayload` based on message type
    - Use the same fetch + error handling pattern as `sendTextMessage`
    - Return `SendResult` with success/failure info
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3_
  - [x] 4.4 Implement `sendOutboundMessages` function
    - Create an async function that iterates over `OutboundMessage[]`, dispatching `"text"` to `sendTextMessage` and `"buttons"`/`"list"` to `sendInteractiveMessage`
    - Send in order, continue on failure, return all `SendResult` objects
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 4.5 Write unit tests for payload builders and sender functions
    - Test `buildButtonMessagePayload` produces correct JSON structure for DAT-013 buttons
    - Test `buildListMessagePayload` produces correct JSON structure for DAT-002 list
    - Test `sendInteractiveMessage` success, API error, and network error paths (mock fetch)
    - Test `sendOutboundMessages` dispatches by type, preserves order, and handles failures
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 5.1, 5.2, 5.3, 5.4_
  - [x] 4.6 Write property test for button payload builder
    - **Property 1: Button payload builder produces well-formed payloads**
    - Generate random `ButtonsOutboundMessage` objects (1–3 buttons, valid ID/title lengths), verify `buildButtonMessagePayload` output structure matches WhatsApp API spec
    - **Validates: Requirements 1.1, 7.1, 7.2**
  - [x] 4.7 Write property test for list payload builder
    - **Property 2: List payload builder produces well-formed payloads**
    - Generate random `ListOutboundMessage` objects (1–10 rows, valid ID/title/buttonLabel lengths), verify `buildListMessagePayload` output structure matches WhatsApp API spec
    - **Validates: Requirements 2.1, 7.3, 7.4, 7.5**
  - [x] 4.8 Write property test for send order
    - **Property 8: Outbound messages are sent in input order**
    - Generate random arrays of mixed `OutboundMessage` types, mock senders, verify the i-th send call corresponds to the i-th input message
    - **Validates: Requirements 5.3**
  - [x] 4.9 Write property test for payload round-trip
    - **Property 10: Payload construction round-trip**
    - Generate random `OutboundMessage` objects, build payloads via builders, extract body text and action metadata back, verify equivalence to original fields
    - **Validates: Requirements 7.6**

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update `queue-consumer.ts` for interactive message parsing and dispatch
  - [x] 6.1 Extend `extractTextFromPayload` to handle interactive replies
    - Add handling for `msg.type === "interactive"` with `msg.interactive.button_reply.id` (return the ID)
    - Add handling for `msg.type === "interactive"` with `msg.interactive.list_reply.id` (return the ID)
    - Preserve existing `msg.type === "text"` handling
    - Return `null` for unsupported message types
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 6.2 Update `replyToUser` to accept `OutboundMessage[]`
    - Change the `messages` parameter from `string[]` to `OutboundMessage[]`
    - Replace `sendMessages` call with `sendOutboundMessages`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 6.3 Update all `replyToUser` call sites in `queue-consumer.ts`
    - Wrap plain string arrays (e.g. `[WRITE_FAILURE_MESSAGE]`, `[helpText]`, `[statusText]`) as `TextOutboundMessage` objects using the `textMessages()` helper
    - Update non-checkin flow result `.messages` references (note-capture, injection-flow, medication-event, etc.) to wrap their `string[]` results as `OutboundMessage[]`
    - _Requirements: 3.6, 5.1_
  - [x] 6.4 Write unit tests for `extractTextFromPayload` interactive handling
    - Test button_reply extraction returns the reply ID
    - Test list_reply extraction returns the reply ID
    - Test plain text extraction still works (backward compatibility)
    - Test unsupported types (image, audio, status) return null
    - Test malformed JSON returns null
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 6.5 Write property test for interactive reply extraction
    - **Property 5: Interactive reply extraction returns the reply ID**
    - Generate random reply ID strings, build interactive webhook payloads (both button_reply and list_reply), verify `extractTextFromPayload` returns the ID
    - **Validates: Requirements 4.1, 4.2**
  - [x] 6.6 Write property test for text extraction backward compatibility
    - **Property 6: Text message extraction backward compatibility**
    - Generate random non-empty text strings, build text webhook payloads, verify `extractTextFromPayload` returns the text
    - **Validates: Requirements 4.3**
  - [x] 6.7 Write property test for unsupported message types
    - **Property 7: Unsupported message types return null**
    - Generate random unsupported type strings (not `"text"` or `"interactive"`), build payloads, verify `extractTextFromPayload` returns null
    - **Validates: Requirements 4.4**

- [ ] 7. Add `fast-check` dev dependency and write parser compatibility property test
  - [~] 7.1 Add `fast-check` as a dev dependency in `apps/worker-api/package.json`
    - Run `npm install --save-dev fast-check` in `apps/worker-api`
    - _Requirements: (testing infrastructure)_
  - [~] 7.2 Write property test for parser compatibility with interactive reply IDs
    - **Property 9: Interactive reply IDs are accepted by existing answer parsers**
    - Generate random ordinal values in valid `[min, max]` ranges, verify `parseOrdinalAnswer(String(v), min, max)` returns `v`
    - Verify `parseStructuredAnswer` accepts `"yes"`, `"no"`, `"partial"` and returns `1`, `0`, `0.5` respectively
    - **Validates: Requirements 6.1, 6.2**

- [ ] 8. Update existing tests for new OutboundMessage types
  - [~] 8.1 Update existing `checkin-flow.test.ts` assertions
    - Update all test assertions that check `result.messages` to expect `OutboundMessage[]` instead of `string[]`
    - Verify non-question messages produce `TextOutboundMessage` objects
    - Verify skip commands still work for all question types
    - _Requirements: 3.6, 6.1, 6.2, 6.3_
  - [~] 8.2 Update existing `queue-consumer.test.ts` assertions
    - Update test mocks and assertions to work with `OutboundMessage[]` instead of `string[]`
    - _Requirements: 5.1, 5.2_

- [~] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all code examples and implementations use TypeScript
- `fast-check` is used as the property-based testing library alongside Vitest
- Task 7.1 (adding `fast-check`) should be done before running any property tests, but is listed later to keep implementation tasks grouped logically — execute it first if running property tests early
