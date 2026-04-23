# Requirements: Symptom Tracker MVP

## Product objective

Build a low-friction personal symptom-tracking system hosted on Cloudflare that captures structured and freeform symptom data via WhatsApp, provides a secure web dashboard for review and trend analysis, and produces clinician-shareable exports. This is a single-user personal tool, not a clinical portal.

## Stakeholders

| Role | Need |
|---|---|
| User | Fast daily check-ins (<= 90s), notes, trends, useful self-observation |
| Primary care doctor | Medication tolerance, appetite/weight trend, GI side effects, adherence summary |
| Therapist | Interpersonal patterns, triggers, conflict load, emotional/behavioral patterning, notes |
| Psychiatrist | Mood instability markers, sleep changes, activation/hypomania risk indicators, adherence, side-effect timeline |

## Assumptions

| ID | Assumption |
|---|---|
| ASM-001 | MVP serves a single patient account |
| ASM-002 | The patient is the only live dashboard user in MVP |
| ASM-003 | Clinicians receive exported summaries rather than real-time access |
| ASM-004 | WhatsApp Business Platform (Cloud API) is used for messaging and webhook delivery |
| ASM-005 | Cloudflare is the primary hosting/runtime platform (Workers, Pages, D1, R2, KV, Queues) |
| ASM-006 | Current medication tracking must include Mounjaro at initiation-stage dosing |
| ASM-007 | User has a configured IANA timezone; all "date" fields are local-date in that zone; all timestamps stored UTC |

## Out of scope for MVP

- Direct EHR/FHIR integration
- Automated diagnosis or medication recommendations
- Live clinician logins or clinician portal
- Emergency/crisis response workflow
- Insurance/billing workflows
- Multi-user support
- Wearable/sensor imports

## Success criteria

| ID | Metric | Target |
|---|---|---|
| KPI-001 | Daily check-in completion time | <= 90 seconds median |
| KPI-002 | Daily completion rate | >= 70% of prompted days over 30 days |
| KPI-003 | Weekly note capture rate | >= 1 freeform note per week on average |
| KPI-004 | Dashboard load time | <= 2.5 sec for main views |
| KPI-005 | Report usefulness | User can export a monthly summary containing mood, sleep, meds, side effects, notes, and flags |
| KPI-006 | Trend detection value | Dashboard can identify at least 5 clinically relevant pattern types |

---

## Symptom model

### Canonical ordinal scale

All ordinal measures (DAT-002 through DAT-012, DAT-024 through DAT-030) use a **0–5 integer scale**:

| Value | Meaning |
|---|---|
| 0 | None / not present |
| 1 | Minimal |
| 2 | Mild |
| 3 | Moderate |
| 4 | Significant |
| 5 | Severe / extreme |

DAT-001 (sleep duration) is numeric in **hours** (decimal allowed, e.g. 6.5). DAT-031 (weight) is numeric in **pounds**. DAT-032 (glucose) is numeric in **mg/dL**. DAT-013 (medication adherence) is a structured boolean/event per medication. DAT-014 (freeform note) is text up to 4,000 characters.

### Daily structured measures

| Data Item ID | Variable | Type | Scale | Cadence |
|---|---|---|---|---|
| DAT-001 | Sleep duration | numeric | hours | daily |
| DAT-002 | Sleep quality | ordinal | 0–5 | daily |
| DAT-003 | Mood valence | ordinal | 0–5 | daily |
| DAT-004 | Energy/activation | ordinal | 0–5 | daily |
| DAT-005 | Irritability/anger | ordinal | 0–5 | daily |
| DAT-006 | Anxiety/tension | ordinal | 0–5 | daily |
| DAT-007 | Focus/attention | ordinal | 0–5 | daily |
| DAT-008 | Racing thoughts | ordinal | 0–5 | daily |
| DAT-009 | Impulsivity/urge to act | ordinal | 0–5 | daily |
| DAT-010 | Risk-taking/goal-drive | ordinal | 0–5 | daily |
| DAT-011 | Interpersonal conflict load | ordinal | 0–5 | daily |
| DAT-012 | Appetite | ordinal | 0–5 | daily |
| DAT-013 | Medication adherence | boolean/event per med | — | daily |
| DAT-014 | Freeform note | text | max 4000 chars | optional daily |

### Event-based tracking

| Data Item ID | Event | Type |
|---|---|---|
| DAT-015 | Mounjaro injection | medication event |
| DAT-016 | Missed medication dose | medication event |
| DAT-017 | Behavioral incident | tagged event |
| DAT-018 | Conflict/escalation event | tagged event |
| DAT-019 | Substance-use event | tagged event |
| DAT-020 | Extra note/journal entry | text event |

### Mounjaro-specific variables

| Data Item ID | Variable | Type | Scale | Cadence |
|---|---|---|---|---|
| DAT-021 | Injection date/time | event | — | per injection |
| DAT-022 | Injection dose | enum | 2.5, 5, 7.5, 10, 12.5, 15 mg | per injection |
| DAT-023 | Injection site | enum | abdomen, thigh-L, thigh-R, upper-arm-L, upper-arm-R | per injection |
| DAT-024 | Nausea | ordinal | 0–5 | daily around injection |
| DAT-025 | Diarrhea | ordinal | 0–5 | daily around injection |
| DAT-026 | Vomiting | ordinal | 0–5 | daily around injection |
| DAT-027 | Constipation | ordinal | 0–5 | daily around injection |
| DAT-028 | Abdominal pain | ordinal | 0–5 | daily around injection |
| DAT-029 | Hydration difficulty | ordinal | 0–5 | daily when symptomatic |
| DAT-030 | Appetite suppression | ordinal | 0–5 | daily |
| DAT-031 | Weight | numeric | pounds | optional daily/weekly |
| DAT-032 | Glucose reading | numeric | mg/dL | optional manual entry |

---

## Functional requirements

### WhatsApp intake

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-WA-001 | System shall receive inbound WhatsApp messages via webhook | Must | Valid inbound message is persisted and acknowledged within 1s |
| FR-WA-002 | System shall identify the user by WhatsApp phone number binding | Must | Messages from bound number are assigned to correct user |
| FR-WA-003 | System shall support a guided daily check-in conversation | Must | User can complete full check-in (DAT-001 through DAT-014) through WhatsApp |
| FR-WA-004 | System shall support freeform note capture at any time | Must | User can send a note without entering check-in mode |
| FR-WA-005 | System shall support event commands: `checkin`, `note:`, `inject`, `missed med`, `status`, `report month` | Should | Commands produce structured records |
| FR-WA-006 | System shall recover gracefully if a user stops mid-check-in and resumes later | Must | Session state resumes correctly; sessions expire after 4 hours of inactivity |
| FR-WA-007 | System shall send daily and weekly prompts on schedule in the user's configured timezone | Must | Prompt is sent at configured local time |
| FR-WA-008 | System shall use template messages where required by WhatsApp policy (outside 24h service window) | Must | Outbound scheduled prompts succeed outside service window |
| FR-WA-009 | System shall support plain-language replies rather than requiring rigid syntax | Should | Parser maps common phrases to structured values (e.g. "slept 4 hours" → DAT-001=4) |
| FR-WA-010 | System shall confirm saved entries succinctly | Should | User receives brief structured confirmation after each save |

### Symptom capture and note-taking

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-CAP-001 | System shall capture all core daily variables DAT-001 through DAT-014 | Must | Daily record contains all prompted fields or explicit nulls with skip status |
| FR-CAP-002 | System shall allow skipping a question without abandoning the session | Must | Skipped fields remain null, session continues to next question |
| FR-CAP-003 | System shall allow retroactive entry for prior dates within a 7-day lookback | Should | User can log a missed day; retroactive records are flagged as such |
| FR-CAP-004 | System shall timestamp every observation in UTC and preserve source channel | Must | Stored records include created_at (UTC), source, and user timezone |
| FR-CAP-005 | System shall support long-form notes of at least 4,000 characters | Should | Notes save and render successfully |
| FR-CAP-006 | System shall support tagged notes with predefined tags (meds, work, conflict, sleep, mood, therapy, injection) | Should | User can associate one or more tags to a note |
| FR-CAP-007 | System shall allow the user to define custom event tags | Should | Custom tags can be created via command and reused |

### Medication tracking

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-MED-001 | System shall track scheduled medications and adherence events | Must | Medication dose events can be logged and summarized per medication |
| FR-MED-002 | System shall model Mounjaro injections separately from oral meds with dedicated fields (dose, site, time) | Must | Injection records stored with DAT-021, DAT-022, DAT-023 |
| FR-MED-003 | System shall associate side-effect observations to nearest injection event within a 72-hour window | Must | Side-effect chart shows temporal relation to injection timeline |
| FR-MED-004 | System shall support configurable medication lists (add/edit/deactivate) | Must | Medication definitions are data-driven, not hardcoded |
| FR-MED-005 | System shall support missed-dose logging | Must | Missed dose appears in adherence trend |
| FR-MED-006 | System shall support optional reminder prompts for meds and injections | Could | Scheduled reminder can be toggled on/off per medication |

### Dashboard and review

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-DB-001 | System shall provide a web dashboard accessible online, protected by authentication | Must | Authenticated user can open dashboard; unauthenticated requests blocked |
| FR-DB-002 | Dashboard shall show time-series trends for sleep, mood, energy, focus, impulsivity, and side effects | Must | Charts render across selected date range with the 0–5 ordinal scale on y-axis |
| FR-DB-003 | Dashboard shall show injection timeline overlaid with appetite, weight, and GI symptoms | Must | Overlay view shows injection markers with side-effect severity curves |
| FR-DB-004 | Dashboard shall show note history with filtering by date and tag | Must | Notes can be searched by text and filtered by tag and date range |
| FR-DB-005 | Dashboard shall show adherence summaries by medication | Must | User can inspect missed and taken dose trends per medication |
| FR-DB-006 | Dashboard shall support daily, weekly, monthly, and custom date ranges | Must | Time filters work consistently across all views |
| FR-DB-007 | Dashboard shall support a clinician-friendly summary mode that hides admin/config UI | Should | Summary page shows only clinical data and trends |
| FR-DB-008 | Dashboard shall show data completeness metrics (missing data by date and measure) | Should | Missing data is visible as gaps in charts and in a completeness summary |

### Analysis and pattern detection

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-ANL-001 | System shall compute rolling 7-day baselines for key metrics (sleep, mood, energy, focus, appetite) with a minimum of 4 data points required | Must | Baseline values are visible in analytics layer; insufficient-data flag raised when < 4 points |
| FR-ANL-002 | System shall detect hypomania risk: sleep below personal baseline by >= 1.0 for >= 2 days AND energy >= 4 AND racing thoughts >= 3 | Must | Rule-based flag FLG-HYPO-001 produced with contributing data points |
| FR-ANL-003 | System shall detect appetite/weight and GI patterns within 72h of injection | Must | Injection-effect summary produced as FLG-MJ-001 (GI cluster) and FLG-MJ-002 (appetite shift) |
| FR-ANL-004 | System shall detect worsening focus: focus <= 2 for >= 3 of last 5 days | Must | ADHD functioning flag FLG-ADHD-001 produced |
| FR-ANL-005 | System shall detect interpersonal strain: conflict >= 3 AND irritability >= 3 for >= 2 days in a 5-day window | Should | Conflict flag FLG-CONFLICT-001 produced |
| FR-ANL-006 | System shall generate descriptive weekly and monthly summaries on demand | Must | Narrative summary covers all report sections |
| FR-ANL-007 | Analysis output shall be descriptive and hypothesis-oriented, never diagnostic | Must | Copy avoids diagnosis/treatment claims; uses hedging language |
| FR-ANL-008 | System shall make rule-based flags explainable with exact dates, contributing variables, thresholds used, and confidence tier | Must | Each flag links to contributing data points |
| FR-ANL-009 | System should support optional LLM narrative synthesis behind a provider abstraction | Should | Summary provider can be swapped or disabled via feature flag |
| FR-ANL-010 | System shall allow manual dismissal of non-useful flags | Could | User can mark a flag as dismissed; dismissed flags hidden from default view |

### Reporting and export

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-RPT-001 | System shall export clinician-readable PDF summaries for a selected date range | Must | PDF generated with cover page, disclaimer, trends, flags, notes |
| FR-RPT-002 | System shall export CSV for raw structured data (one CSV per entity group) | Must | CSV contains normalized records with headers matching data dictionary |
| FR-RPT-003 | System shall generate monthly summary packets | Should | Monthly packet includes trends, notes, meds, flags in one PDF |
| FR-RPT-004 | Export shall include a data dictionary page explaining the 0–5 scale, variable codes, and flag codes | Should | PDF explains all scales and symbols used |
| FR-RPT-005 | Export shall identify missing-data periods | Should | Report clearly shows date gaps and incomplete check-ins |
| FR-RPT-006 | Export shall include freeform note excerpts (truncated to 500 chars each in PDF, full in CSV) | Must | Notes are included in condensed form in PDF |

### Admin and configuration

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-ADM-001 | System shall allow configuration of prompt schedule (daily time, weekly day/time) | Must | Schedules editable via config file or admin API |
| FR-ADM-002 | System shall allow configuration of symptom questions (reorder, disable, re-enable) | Should | Question pack changes take effect on next check-in |
| FR-ADM-003 | System shall allow configuration of event tags (predefined + custom) | Should | Tags persist and appear in dashboard filters |
| FR-ADM-004 | System shall support feature flags for instruments and LLM analysis | Must | Features can be toggled per environment |
| FR-ADM-005 | System shall allow export/import of config as JSON | Could | JSON config can be moved between environments |

### Weekly instruments

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-INST-001 | System shall support a weekly mania screener flow via WhatsApp | Should | Screener can be completed through guided conversation |
| FR-INST-002 | System shall store instrument name, version, date, raw responses, and calculated score | Should | Instrument response record is complete and queryable |
| FR-INST-003 | System shall support manual entry or future integration of additional validated screeners | Should | Instrument definitions are data-driven |
| FR-INST-004 | Instrument integrations that require licensing review shall be feature-flagged until approved | Must | Feature flag prevents unlicensed instrument from activating |

---

## Non-functional requirements

### Security, privacy, and safety

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| NFR-SEC-001 | Dashboard shall require authentication via Cloudflare Access | Must | Unauthenticated requests return 403 |
| NFR-SEC-002 | Principle of least privilege shall apply to all secrets and service bindings | Must | Secrets not exposed to client; each Worker has only needed bindings |
| NFR-SEC-003 | All data in transit shall be encrypted (HTTPS/TLS) | Must | No plaintext HTTP endpoints |
| NFR-SEC-004 | Export download URLs shall be signed with short expiry (max 15 minutes) | Must | Unsigned or expired URLs return 403 |
| NFR-SEC-005 | Operational telemetry shall exclude PHI (no freeform notes, no symptom text in logs) | Must | Logs contain only IDs, codes, and counts |
| NFR-SEC-006 | System shall display a non-emergency disclaimer in onboarding, dashboard footer, and report cover page | Must | Disclaimer text present in all three locations |
| NFR-SEC-007 | System shall support user-controlled data export and deletion | Should | User can export all data as CSV and request full deletion |
| NFR-SEC-008 | System shall log audit events for auth, exports, config changes, summary generation, and deletions | Should | Audit records stored in D1 and queryable via API |

### Performance and reliability

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| NFR-OPS-001 | Webhook ingestion shall acknowledge inbound messages within 1 second (P95) before async processing | Must | Webhook returns 200 quickly; processing happens via Queue |
| NFR-OPS-002 | Async processing shall be idempotent using message_id as dedup key | Must | Duplicate webhook delivery does not create duplicate records |
| NFR-OPS-003 | Dashboard shall be responsive on mobile (>= 375px) and desktop | Must | Layouts pass visual smoke test at 375px, 768px, 1280px |
| NFR-OPS-004 | Scheduled prompts and queue jobs shall retry on transient failure with exponential backoff | Must | Retry path exists; dead-letter after 3 attempts |
| NFR-OPS-005 | System shall preserve raw inbound message envelopes for 30 days | Should | Raw payloads archived in R2 with TTL |
| NFR-OPS-006 | Core services shall be observable (errors, queue failures, cron failures visible) | Must | Structured logging with error counts |

### Maintainability

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| NFR-MNT-001 | Codebase shall be modular: messaging, domain, analytics, reporting, and UI as separate packages | Must | Clear package boundaries in monorepo |
| NFR-MNT-002 | Data model shall be migration-driven with versioned schema files | Must | Schema changes applied via numbered migration files |
| NFR-MNT-003 | Domain rules (rule engine, parser, workflow) shall be covered by automated tests | Must | Test suite runs in CI |
| NFR-MNT-004 | Prompt text and scoring configs shall be data-driven (JSON/config files, not hardcoded) | Should | Question changes require only config edits |
| NFR-MNT-005 | System shall support local development with mock WhatsApp webhook fixtures | Must | Developer can test full flow locally without live WhatsApp |

---

## Safety constraints

| ID | Constraint |
|---|---|
| SAF-001 | The system shall not present itself as a medical device or diagnostic system |
| SAF-002 | The system shall not give medication dosing advice |
| SAF-003 | The system shall not recommend starting/stopping medication |
| SAF-004 | Safety alerts, if present, shall direct the user to contact a clinician or emergency services |
| SAF-005 | LLM-generated summaries shall be clearly labeled as AI-generated summaries, not medical conclusions |

---

## MVP acceptance summary

The MVP is acceptable when the user can:
1. Receive a daily WhatsApp prompt at their configured local time
2. Complete a structured check-in in under 90 seconds
3. Add freeform notes at any time with optional tags
4. Log Mounjaro injections with dose, site, and time
5. See side-effect tracking linked to injection windows
6. Review trends in a secure web dashboard with time-series charts
7. See explainable pattern flags with contributing data points
8. Export a clinician-readable monthly PDF report
9. Export raw data as CSV
10. See a non-emergency disclaimer in the UI and reports
