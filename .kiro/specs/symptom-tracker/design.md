# Design: Symptom Tracker MVP

## 1. Design goal

Deliver the fastest realistic version of a personal symptom tracker without building a fake-clinical system. WhatsApp for frictionless intake, Cloudflare for hosting, one private dashboard user, clinician exports instead of live clinician accounts, rule-based analytics first.

## 2. Architecture overview

### 2.1 MVP stack

| Layer | Choice | Why |
|---|---|---|
| Messaging | WhatsApp Business Platform (Cloud API) | Native WhatsApp, webhook-based |
| Webhook/API runtime | Cloudflare Workers + Hono | Fast edge runtime, simple routing |
| Front-end | Cloudflare Pages + React + TypeScript | Dashboard with preview deploys |
| Primary database | Cloudflare D1 (SQLite) | Relational queries for longitudinal data |
| Async processing | Cloudflare Queues | Decouples webhook ack from processing |
| Object storage | Cloudflare R2 | PDFs, CSVs, raw payload archive |
| Session/config state | Workers KV | Ephemeral check-in sessions, cached config |
| Auth | Cloudflare Access | Single-user dashboard protection |
| Scheduling | Cron Triggers | Daily/weekly prompts and report jobs |
| Observability | Workers structured logs (no PHI) | Operational insight without symptom data |

### 2.2 Architecture diagram

```
WhatsApp User → Meta Cloud API → [ingress Worker] → ack 200
                                       ↓
                                 Cloudflare Queue
                                       ↓
                              [workflow Worker] → D1, KV, R2
                                       
Cron Triggers → [scheduler Worker] → Meta Cloud API (template messages)

Dashboard (Pages) → [api Worker] → D1, R2, KV
                         ↑
                  Cloudflare Access

[analytics Worker] → D1 (read) → D1 (write flags) → R2 (reports)
```

## 3. Key design decisions

### DD-001: WhatsApp is capture, dashboard is analysis
WhatsApp handles short daily interactions. The dashboard handles charts, notes, and exports.

### DD-002: Fast webhook ack, async processing
Ingress Worker stores raw envelope, publishes to Queue, returns 200 within 200ms. All parsing, workflow, and persistence happen in the queue consumer.

### DD-003: D1 for structured data
Longitudinal symptom tracking is relational. Trend queries, joins, and exports are easier in SQL.

### DD-004: R2 for artifacts only
PDFs, CSVs, and raw webhook payload archives go in R2. No structured data in R2.

### DD-005: Cloudflare Access for dashboard auth
Single-user MVP. Access provides strong protection without building a custom auth stack.

### DD-006: Rule engine first, LLM second
Deterministic, explainable analytics first. LLM narrative synthesis is optional and feature-flagged.

### DD-007: Export-to-clinician, not clinician-portal
Only the user gets dashboard access. Clinicians receive exported PDFs/CSVs.

### DD-008: Configurable question packs
Symptom prompts, medication lists, tags, and schedules are driven by JSON config, not hardcoded.

### DD-009: KV for session state, D1 for canonical records
In-progress check-in sessions live in KV with a 4-hour TTL. Completed check-ins are written to D1. This avoids polluting D1 with abandoned session fragments.

### DD-010: User timezone is authoritative for dates
All "daily" boundaries, prompt scheduling, and date-based queries use the user's configured IANA timezone. Timestamps are stored in UTC. Local dates are derived at query time.

## 4. Domain model

### 4.1 Core entities

| Entity | Storage | Purpose |
|---|---|---|
| user | D1 | Patient profile, preferences, IANA timezone |
| whatsapp_binding | D1 | Phone number → user mapping |
| checkin_session | KV (TTL 4h) | In-progress guided flow state |
| daily_checkin | D1 | Canonical daily record (complete/partial/abandoned) |
| symptom_observation | D1 | Normalized scored observation per variable per day |
| note | D1 | Freeform note or journal entry with optional tags |
| medication_definition | D1 | Configured medication list |
| medication_event | D1 | Taken, missed, injected events |
| side_effect_observation | D1 | Structured tolerability data linked to injection window |
| behavioral_event | D1 | Tagged incidents (conflict, substance use, etc.) |
| instrument_definition | D1 | Screener metadata |
| instrument_response | D1 | Raw weekly instrument responses and scores |
| analytic_flag | D1 | Explainable pattern flags |
| summary_report | D1 | Generated report metadata (PDF/CSV location in R2) |
| audit_event | D1 | Auth, export, config, deletion actions |
| raw_message | R2 | Raw inbound/outbound message envelope (30-day retention) |

### 4.2 Entity relationships

```
USER 1──* WHATSAPP_BINDING
USER 1──* DAILY_CHECKIN
USER 1──* NOTE
USER 1──* MEDICATION_EVENT
USER 1──* SIDE_EFFECT_OBSERVATION
USER 1──* BEHAVIORAL_EVENT
USER 1──* INSTRUMENT_RESPONSE
USER 1──* ANALYTIC_FLAG
USER 1──* SUMMARY_REPORT
USER 1──* AUDIT_EVENT

DAILY_CHECKIN 1──* SYMPTOM_OBSERVATION
DAILY_CHECKIN 1──* NOTE (optional link)
MEDICATION_DEFINITION 1──* MEDICATION_EVENT
MEDICATION_EVENT 1──* SIDE_EFFECT_OBSERVATION (within 72h window)
```

## 5. Data model detail

### 5.1 `user`
- id: TEXT PRIMARY KEY (ULID)
- display_name: TEXT
- timezone: TEXT NOT NULL (IANA, e.g. "America/New_York")
- created_at: TEXT NOT NULL (ISO 8601 UTC)
- updated_at: TEXT NOT NULL

### 5.2 `whatsapp_binding`
- id: TEXT PRIMARY KEY (ULID)
- user_id: TEXT NOT NULL FK → user
- phone_number: TEXT NOT NULL UNIQUE
- verified_at: TEXT NOT NULL
- active: INTEGER NOT NULL DEFAULT 1

### 5.3 `daily_checkin`
- id: TEXT PRIMARY KEY (ULID)
- user_id: TEXT NOT NULL FK → user
- checkin_date: TEXT NOT NULL (YYYY-MM-DD in user's timezone)
- status: TEXT NOT NULL CHECK (complete, partial, abandoned)
- source: TEXT NOT NULL DEFAULT 'whatsapp'
- is_retroactive: INTEGER NOT NULL DEFAULT 0
- created_at: TEXT NOT NULL (UTC)
- updated_at: TEXT NOT NULL (UTC)
- UNIQUE(user_id, checkin_date)

### 5.4 `symptom_observation`
- id: TEXT PRIMARY KEY (ULID)
- daily_checkin_id: TEXT NOT NULL FK → daily_checkin
- variable_code: TEXT NOT NULL (e.g. DAT-001)
- value_numeric: REAL (nullable — null means skipped)
- value_text: TEXT (nullable — for DAT-014 freeform)
- scale_min: INTEGER (0 for ordinal, null for numeric/text)
- scale_max: INTEGER (5 for ordinal, null for numeric/text)
- skipped: INTEGER NOT NULL DEFAULT 0
- entered_at: TEXT NOT NULL (UTC)

### 5.5 `note`
- id: TEXT PRIMARY KEY (ULID)
- user_id: TEXT NOT NULL FK → user
- daily_checkin_id: TEXT (nullable — notes can exist without a check-in)
- body: TEXT NOT NULL (max 4000 chars enforced at app layer)
- tags: TEXT (JSON array of tag strings, e.g. '["meds","conflict"]')
- source: TEXT NOT NULL DEFAULT 'whatsapp'
- created_at: TEXT NOT NULL (UTC)

### 5.6 `medication_definition`
- id: TEXT PRIMARY KEY (ULID)
- code: TEXT NOT NULL UNIQUE (e.g. "mounjaro", "seroquel")
- display_name: TEXT NOT NULL
- route: TEXT NOT NULL CHECK (oral, injection)
- default_dose_value: REAL (nullable)
- default_dose_unit: TEXT (nullable)
- active: INTEGER NOT NULL DEFAULT 1
- created_at: TEXT NOT NULL

### 5.7 `medication_event`
- id: TEXT PRIMARY KEY (ULID)
- user_id: TEXT NOT NULL FK → user
- medication_definition_id: TEXT NOT NULL FK → medication_definition
- event_type: TEXT NOT NULL CHECK (taken, missed, injected, skipped)
- dose_value: REAL (nullable)
- dose_unit: TEXT (nullable)
- injection_site: TEXT (nullable — for injections only)
- event_at: TEXT NOT NULL (UTC)
- event_date: TEXT NOT NULL (YYYY-MM-DD local)
- note_id: TEXT (nullable FK → note)
- created_at: TEXT NOT NULL (UTC)

### 5.8 `side_effect_observation`
- id: TEXT PRIMARY KEY (ULID)
- user_id: TEXT NOT NULL FK → user
- linked_medication_event_id: TEXT (nullable FK → medication_event)
- variable_code: TEXT NOT NULL (e.g. DAT-024)
- severity: INTEGER NOT NULL CHECK (0–5)
- observed_date: TEXT NOT NULL (YYYY-MM-DD local)
- observed_at: TEXT NOT NULL (UTC)
- note_id: TEXT (nullable FK → note)

### 5.9 `behavioral_event`
- id: TEXT PRIMARY KEY (ULID)
- user_id: TEXT NOT NULL FK → user
- event_date: TEXT NOT NULL (YYYY-MM-DD local)
- tag: TEXT NOT NULL (e.g. "conflict", "substance-use", "risk-behavior")
- severity: INTEGER CHECK (0–5, nullable)
- description: TEXT (nullable, max 2000 chars)
- related_checkin_id: TEXT (nullable FK → daily_checkin)
- created_at: TEXT NOT NULL (UTC)

### 5.10 `instrument_response`
- id: TEXT PRIMARY KEY (ULID)
- user_id: TEXT NOT NULL FK → user
- instrument_name: TEXT NOT NULL
- instrument_version: TEXT NOT NULL
- response_date: TEXT NOT NULL (YYYY-MM-DD local)
- raw_responses: TEXT NOT NULL (JSON)
- calculated_score: REAL (nullable)
- created_at: TEXT NOT NULL (UTC)

### 5.11 `analytic_flag`
- id: TEXT PRIMARY KEY (ULID)
- user_id: TEXT NOT NULL FK → user
- flag_code: TEXT NOT NULL (e.g. FLG-HYPO-001)
- started_on: TEXT NOT NULL (YYYY-MM-DD local)
- ended_on: TEXT (nullable)
- severity: TEXT NOT NULL CHECK (weak, moderate, strong)
- explanation: TEXT NOT NULL (JSON: { dates, variables, thresholds, narrative })
- dismissed_at: TEXT (nullable UTC)
- created_at: TEXT NOT NULL (UTC)

### 5.12 `summary_report`
- id: TEXT PRIMARY KEY (ULID)
- user_id: TEXT NOT NULL FK → user
- report_type: TEXT NOT NULL CHECK (weekly, monthly, custom)
- period_start: TEXT NOT NULL (YYYY-MM-DD)
- period_end: TEXT NOT NULL (YYYY-MM-DD)
- r2_pdf_key: TEXT (nullable)
- r2_csv_key: TEXT (nullable)
- generated_at: TEXT NOT NULL (UTC)
- generator: TEXT NOT NULL CHECK (deterministic, llm)

### 5.13 `audit_event`
- id: TEXT PRIMARY KEY (ULID)
- user_id: TEXT (nullable — some events are system-level)
- action: TEXT NOT NULL (e.g. "login", "export", "config_change", "delete", "summary_generate")
- detail: TEXT (JSON, no PHI)
- ip_address: TEXT (nullable)
- created_at: TEXT NOT NULL (UTC)

## 6. WhatsApp interaction design

### 6.1 Principles
- One question at a time
- Allow natural-language responses
- Allow commands at any time (even mid-check-in)
- Confirm saves briefly
- Resume interrupted sessions (KV TTL 4h)
- All times displayed in user's timezone

### 6.2 Commands

| Command | Action |
|---|---|
| `checkin` | Start or resume today's check-in |
| `note: <text>` | Save a freeform note (tags auto-suggested) |
| `inject` | Start Mounjaro injection logging flow |
| `missed med` or `missed <med-name>` | Log missed medication dose |
| `status` | Show today's completion state |
| `report month` | Queue monthly PDF report generation |
| `tags` | List available tags |
| `help` | Show command list |

### 6.3 Daily check-in sequence
Order (sleep first — anchors interpretation of everything else):

1. Sleep hours (DAT-001): "How many hours did you sleep?" → numeric
2. Sleep quality (DAT-002): "Sleep quality? (0=terrible, 5=great)" → 0–5
3. Mood (DAT-003): "Mood today? (0=very low, 5=very elevated)" → 0–5
4. Energy (DAT-004): "Energy level? (0=none, 5=wired)" → 0–5
5. Irritability (DAT-005): "Irritability? (0=none, 5=extreme)" → 0–5
6. Anxiety (DAT-006): "Anxiety/tension? (0=none, 5=extreme)" → 0–5
7. Focus (DAT-007): "Focus/attention? (0=none, 5=laser)" → 0–5
8. Racing thoughts (DAT-008): "Racing thoughts? (0=none, 5=constant)" → 0–5
9. Impulsivity (DAT-009): "Impulsivity/urge to act? (0=none, 5=extreme)" → 0–5
10. Risk-drive (DAT-010): "Risk-taking drive? (0=none, 5=extreme)" → 0–5
11. Conflict (DAT-011): "Interpersonal conflict? (0=none, 5=severe)" → 0–5
12. Appetite (DAT-012): "Appetite? (0=none, 5=ravenous)" → 0–5
13. Meds taken (DAT-013): "Meds taken today? (yes/no/partial — which missed?)" → structured
14. Side effects: "Any side effects to note? (skip or describe)" → optional text
15. Note (DAT-014): "Anything else to note? (skip or type)" → optional text

User can reply "skip" or "s" to skip any question. User can reply with a command at any point to switch context.

### 6.4 Injection flow
When user sends `inject`:
1. "Which dose? (2.5 / 5 / 7.5 / 10 / 12.5 / 15 mg)"
2. "When? (now / or enter time like 8:30am)"
3. "Injection site? (abdomen / thigh-L / thigh-R / arm-L / arm-R)"
4. "Start 72h symptom watch? (yes/no)" — if yes, schedule follow-up prompts at +24h and +48h
5. Confirm: "✓ Mounjaro [dose]mg logged at [time], [site]. Watch active for 72h."

### 6.5 Natural-language parser
The parser should handle common patterns:
- "slept 4 hours" → DAT-001 = 4
- "6.5" during sleep question → DAT-001 = 6.5
- "mood 4" or "4/5" or "pretty elevated, maybe 4" → extract numeric
- "missed seroquel" → medication_event(seroquel, missed)
- "note: big fight, felt activated" → note with auto-suggested tags [conflict, mood]
- "skip" / "s" / "next" → skip current question
- Numbers 0–5 during ordinal questions → direct mapping

## 7. Analytics design

### 7.1 Baseline algorithm
- **Window:** Rolling 7-day trailing average
- **Minimum sample:** 4 data points in the window; fewer triggers FLG-DATA-001
- **Computation:** Simple arithmetic mean of non-null values in window
- **Storage:** Baselines are computed on-demand (not pre-stored), cached in KV with 1-hour TTL
- **"Below baseline":** Value is >= 1.0 below the 7-day mean
- **"Above baseline":** Value is >= 1.0 above the 7-day mean

### 7.2 Descriptive aggregates
- Rolling 7-day average: sleep, mood, energy, focus, appetite
- Medication adherence rate by week (taken / (taken + missed))
- Weight trend (linear regression over available points)
- Side-effect intensity by injection day offset (day 0, +1, +2, +3)
- Completion rate: (days with check-in / days in range)
- Missing-data score: count of null observations per variable per week

### 7.3 Rule-based flags

| Flag Code | Trigger | Confidence |
|---|---|---|
| FLG-HYPO-001 | sleep < baseline by >= 1.0 for >= 2 days AND energy >= 4 AND racing_thoughts >= 3 | moderate if 2 days, strong if >= 3 |
| FLG-HYPO-002 | risk_drive >= 4 AND impulsivity >= 4 AND mood >= 4 | moderate |
| FLG-ADHD-001 | focus <= 2 for >= 3 of last 5 days | moderate |
| FLG-CONFLICT-001 | conflict >= 3 AND irritability >= 3 for >= 2 days in 5-day window | weak if 2 days, moderate if >= 3 |
| FLG-MJ-001 | any of (nausea, diarrhea, vomiting) >= 3 within 72h of injection | moderate |
| FLG-MJ-002 | appetite_suppression increased by >= 2 over pre-injection baseline within 72h | weak |
| FLG-MED-001 | >= 2 missed doses of same medication within 7 days | moderate if 2, strong if >= 3 |
| FLG-DATA-001 | < 4 data points in 7-day window for any key metric | weak |

Each flag record stores:
- flag_code
- exact dates contributing
- variable codes and values
- threshold used
- confidence tier (weak/moderate/strong)
- human-readable explanation sentence

### 7.4 Narrative summary engine
Deterministic summary generator (no LLM required):
- Pulls structured aggregates for the period
- Cites actual values and date ranges
- Summarizes notes conservatively (count + top tags, not full text)
- Avoids treatment advice
- Labels uncertainty ("insufficient data for this period")

Output sections:
1. Period overview (dates, completion rate)
2. Sleep and activation pattern
3. Attention/focus pattern
4. Medication adherence
5. Mounjaro and side effects
6. Conflict/behavioral notes
7. Active flags with explanations
8. Missing data caveats

### 7.5 LLM usage (optional, feature-flagged)
If enabled:
- Provider abstraction interface (swap OpenAI/Anthropic/Workers AI)
- Input: structured aggregates + selected note excerpts (max 5 per section)
- System prompt forbids diagnosis/treatment language
- Output clearly labeled "AI-generated summary"
- Source snippets stored for auditability
- Fallback to deterministic summary if LLM fails

## 8. Reporting design

### 8.1 Monthly PDF contents
1. Cover page: period, user name, disclaimer, generation date
2. Quick stats: completion rate, check-in count, note count, flag count
3. Sleep/mood/energy trend chart
4. Focus/impulsivity/conflict trend chart
5. Medication adherence table
6. Mounjaro injection timeline with side-effect overlay
7. Weight/appetite summary
8. Top note excerpts (max 10, truncated to 500 chars each)
9. Active analytic flags with explanations
10. Missing data and caveats
11. Data dictionary appendix (scale definitions, variable codes, flag codes)

### 8.2 CSV export groups
Each group is a separate CSV file:
- daily_checkins.csv
- symptom_observations.csv
- notes.csv
- medication_events.csv
- side_effect_observations.csv
- instrument_responses.csv
- analytic_flags.csv

## 9. Security and privacy design

### 9.1 Scope
Private personal-use MVP. Not a claim of HIPAA readiness.

### 9.2 Auth model
- Dashboard: Cloudflare Access (email-based, single allowed identity)
- API: Validates Cloudflare Access JWT on every request
- Report downloads: Signed R2 URLs with 15-minute expiry
- No public sign-up, no clinician accounts

### 9.3 Data minimization
- No PHI in structured logs (only IDs, codes, counts, durations)
- Note text never appears in logs or error messages
- Raw webhook payloads archived in R2 (not D1) with 30-day TTL

### 9.4 Secret handling
- Meta WhatsApp tokens: Workers secrets (not env vars)
- Webhook verify token: Workers secrets
- No secrets in front-end bundle
- Per-environment secret isolation

### 9.5 Audit trail
Tracked events: login, export_generate, config_change, summary_generate, data_delete, flag_dismiss

## 10. Operational design

### 10.1 Worker modules
Start as one Worker codebase with separated modules, split later only if needed:
- `ingress` — webhook verification + raw archive + queue publish
- `workflow` — command routing, session management, parsing, D1 writes
- `api` — dashboard REST endpoints
- `scheduler` — cron-triggered prompts and follow-up sends
- `analytics` — baseline computation, flag evaluation, summary generation
- `report` — PDF/CSV generation, R2 storage

### 10.2 Queue topics
- `inbound-message` — raw message → parse + workflow
- `scheduled-prompt` — cron → send prompt via WhatsApp
- `report-generate` — request → PDF/CSV → R2
- `analytics-refresh` — trigger → recompute flags for recent window

### 10.3 Environments
- `local` — Miniflare, mock WhatsApp fixtures, local D1
- `dev` — Cloudflare dev environment, test WhatsApp number
- `prod` — Production Cloudflare, real WhatsApp number

Each environment has independent D1, R2, KV, and feature flags.

### 10.4 Observability
Capture (without PHI):
- Webhook receive count, success/failure rate
- Queue depth, processing time, failure count
- Cron execution success/failure
- Report generation duration
- Dashboard API latency (P50, P95)
- Check-in completion rate (aggregate, not per-user detail)
