eiifcbnunfjlulncrbidfvruedhdihbujfeinvelddvg
# Requirements Document

## Introduction

This feature adds interactive WhatsApp message support (buttons and lists) to the existing daily check-in flow. Currently, all check-in questions are sent as plain text and all user replies are parsed from free-text input. With interactive messages, ordinal-scale questions (0–5) will be presented as button or list menus, and the structured medication adherence question will use buttons, reducing input friction and parsing errors. Numeric questions (DAT-001: sleep hours) and text questions (DAT-014, DAT-015) will continue to use plain text input since buttons are not appropriate for freeform answers.

The change spans four areas: the WhatsApp sender (new interactive message API call), the check-in flow (structured message objects instead of plain strings), the queue consumer (parsing interactive reply payloads), and the question type mapping (deciding which questions get which UI treatment).

## Glossary

- **WhatsApp_Sender**: The service module (`whatsapp-sender.ts`) responsible for sending messages to users via the WhatsApp Cloud API.
- **Checkin_Flow**: The service module (`checkin-flow.ts`) that manages the guided daily check-in conversation, formats question prompts, parses answers, and persists completed check-ins.
- **Queue_Consumer**: The service module (`queue-consumer.ts`) that processes inbound WhatsApp webhook messages from the Cloudflare Queue, extracts user text, and routes commands.
- **Interactive_Message**: A WhatsApp Cloud API message of `type: "interactive"` that presents the user with tappable buttons or a selectable list, rather than requiring typed text input.
- **Button_Reply**: A WhatsApp webhook payload where `msg.type === "interactive"` and the selected value is in `msg.interactive.button_reply.id`.
- **List_Reply**: A WhatsApp webhook payload where `msg.type === "interactive"` and the selected value is in `msg.interactive.list_reply.id`.
- **Ordinal_Question**: A check-in question with type `"ordinal"` that uses a 0–5 integer scale (DAT-002 through DAT-012).
- **Structured_Question**: A check-in question with type `"structured"` that expects yes/no/partial answers (DAT-013).
- **Numeric_Question**: A check-in question with type `"numeric"` that expects a freeform number (DAT-001).
- **Text_Question**: A check-in question with type `"text"` that expects freeform text (DAT-014, DAT-015).
- **Outbound_Message**: A structured object returned by the Checkin_Flow that describes what to send to the user, including the message type (text, buttons, or list) and associated metadata.
- **WhatsApp_Cloud_API**: The Facebook/Meta Graph API endpoint (`graph.facebook.com/v21.0`) used to send WhatsApp messages.

## Requirements

### Requirement 1: Send Interactive Button Messages

**User Story:** As a user completing a daily check-in, I want to see tappable buttons for yes/no/partial questions, so that I can answer quickly without typing.

#### Acceptance Criteria

1. WHEN the Checkin_Flow produces an Outbound_Message with type `"buttons"`, THE WhatsApp_Sender SHALL send a WhatsApp Cloud API request with `type: "interactive"`, `interactive.type: "button"`, a `body.text` field containing the question prompt, and an `action.buttons` array containing up to 3 button objects each with a unique `reply.id` and `reply.title`.
2. WHEN the WhatsApp Cloud API returns a success response for an interactive button message, THE WhatsApp_Sender SHALL return a SendResult with `success: true` and the WhatsApp message ID.
3. IF the WhatsApp Cloud API returns an error response for an interactive button message, THEN THE WhatsApp_Sender SHALL return a SendResult with `success: false`, the HTTP status code, and a descriptive error string.
4. IF a network error occurs while sending an interactive button message, THEN THE WhatsApp_Sender SHALL return a SendResult with `success: false` and the error message, without throwing an exception.

### Requirement 2: Send Interactive List Messages

**User Story:** As a user completing a daily check-in, I want to see a selectable list for ordinal scale questions (0–5), so that I can tap a value instead of typing a number.

#### Acceptance Criteria

1. WHEN the Checkin_Flow produces an Outbound_Message with type `"list"`, THE WhatsApp_Sender SHALL send a WhatsApp Cloud API request with `type: "interactive"`, `interactive.type: "list"`, a `body.text` field containing the question prompt, an `action.button` string for the list open label, and an `action.sections` array containing list rows each with a unique `id` and `title`.
2. WHEN the WhatsApp Cloud API returns a success response for an interactive list message, THE WhatsApp_Sender SHALL return a SendResult with `success: true` and the WhatsApp message ID.
3. IF the WhatsApp Cloud API returns an error response for an interactive list message, THEN THE WhatsApp_Sender SHALL return a SendResult with `success: false`, the HTTP status code, and a descriptive error string.

### Requirement 3: Structured Outbound Message Objects from Checkin Flow

**User Story:** As a developer, I want the check-in flow to return structured message objects that indicate the intended UI type, so that the reply layer can choose the correct WhatsApp API call.

#### Acceptance Criteria

1. THE Checkin_Flow SHALL return Outbound_Message objects that each contain a `type` field with value `"text"`, `"buttons"`, or `"list"`, and a `body` field containing the message text.
2. WHEN the Checkin_Flow formats a prompt for an Ordinal_Question (DAT-002 through DAT-012), THE Checkin_Flow SHALL produce an Outbound_Message with type `"list"`, the question prompt as the body, and list rows representing each scale value from the question's `scale.min` to `scale.max` with the scale labels.
3. WHEN the Checkin_Flow formats a prompt for a Structured_Question (DAT-013), THE Checkin_Flow SHALL produce an Outbound_Message with type `"buttons"`, the question prompt as the body, and three buttons with IDs and titles for "Yes", "No", and "Partial".
4. WHEN the Checkin_Flow formats a prompt for a Numeric_Question (DAT-001), THE Checkin_Flow SHALL produce an Outbound_Message with type `"text"` and the question prompt as the body.
5. WHEN the Checkin_Flow formats a prompt for a Text_Question (DAT-014, DAT-015), THE Checkin_Flow SHALL produce an Outbound_Message with type `"text"` and the question prompt as the body.
6. WHEN the Checkin_Flow produces non-question messages (e.g. confirmations, resumption notices, completion summaries), THE Checkin_Flow SHALL produce Outbound_Message objects with type `"text"`.

### Requirement 4: Parse Interactive Reply Payloads in Queue Consumer

**User Story:** As a user, I want my button and list selections to be recognized as valid answers, so that the check-in flow advances correctly when I tap an interactive element.

#### Acceptance Criteria

1. WHEN the Queue_Consumer receives a WhatsApp webhook payload where `msg.type` is `"interactive"` and `msg.interactive.button_reply` is present, THE Queue_Consumer SHALL extract the value from `msg.interactive.button_reply.id` and return it as the user's text input.
2. WHEN the Queue_Consumer receives a WhatsApp webhook payload where `msg.type` is `"interactive"` and `msg.interactive.list_reply` is present, THE Queue_Consumer SHALL extract the value from `msg.interactive.list_reply.id` and return it as the user's text input.
3. WHEN the Queue_Consumer receives a WhatsApp webhook payload where `msg.type` is `"text"`, THE Queue_Consumer SHALL continue to extract the value from `msg.text.body` as it does today.
4. WHEN the Queue_Consumer receives a WhatsApp webhook payload with an unsupported `msg.type` (not `"text"` and not `"interactive"`), THE Queue_Consumer SHALL return null.

### Requirement 5: Dispatch Outbound Messages by Type

**User Story:** As a developer, I want the reply dispatch layer to send the correct WhatsApp API call based on the Outbound_Message type, so that users see the intended interactive UI.

#### Acceptance Criteria

1. WHEN the reply dispatch layer receives an Outbound_Message with type `"text"`, THE WhatsApp_Sender SHALL send the message using the existing `sendTextMessage` function.
2. WHEN the reply dispatch layer receives an Outbound_Message with type `"buttons"` or `"list"`, THE WhatsApp_Sender SHALL send the message using the new `sendInteractiveMessage` function.
3. THE reply dispatch layer SHALL send Outbound_Message objects in the order they appear in the Checkin_Flow result array.
4. IF any single Outbound_Message fails to send, THEN THE reply dispatch layer SHALL continue sending the remaining messages and log the failure.

### Requirement 6: Backward Compatibility with Plain Text Replies

**User Story:** As a user, I want to still be able to type my answer even when buttons or a list are shown, so that I am not locked into using the interactive UI.

#### Acceptance Criteria

1. WHILE a check-in session is active and the current question is an Ordinal_Question, THE Checkin_Flow SHALL accept both a plain text numeric answer (e.g. "3") and an interactive list reply ID as valid input.
2. WHILE a check-in session is active and the current question is a Structured_Question, THE Checkin_Flow SHALL accept both a plain text answer (e.g. "yes", "no", "partial") and an interactive button reply ID as valid input.
3. THE Checkin_Flow SHALL continue to accept the skip command ("skip", "s", "next") as plain text for all question types, regardless of whether the question was presented with interactive UI.

### Requirement 7: Interactive Message Payload Construction

**User Story:** As a developer, I want well-formed interactive message payloads that conform to the WhatsApp Cloud API specification, so that messages render correctly on user devices.

#### Acceptance Criteria

1. THE WhatsApp_Sender SHALL construct button payloads with `messaging_product: "whatsapp"`, `recipient_type: "individual"`, `to` set to the phone number, `type: "interactive"`, and `interactive.type: "button"`.
2. THE WhatsApp_Sender SHALL include no more than 3 buttons in a single button message, each with a `reply.id` of at most 256 characters and a `reply.title` of at most 20 characters.
3. THE WhatsApp_Sender SHALL construct list payloads with `messaging_product: "whatsapp"`, `recipient_type: "individual"`, `to` set to the phone number, `type: "interactive"`, and `interactive.type: "list"`.
4. THE WhatsApp_Sender SHALL include no more than 10 rows per section in a list message, each with an `id` of at most 200 characters and a `title` of at most 24 characters.
5. THE WhatsApp_Sender SHALL include an `action.button` string of at most 20 characters in list messages as the button label that opens the list.
6. FOR ALL valid Outbound_Message objects, constructing the API payload and then extracting the body text and action metadata from the payload SHALL produce values equivalent to the original Outbound_Message fields (round-trip property).
