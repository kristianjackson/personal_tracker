# 01 Requirements Document

## 1. Document purpose

This document defines the functional and non-functional requirements for a Cloudflare-hosted symptom-tracking application that uses WhatsApp as the primary interaction channel and provides a secure web dashboard for review and analysis.

## 2. Product objective

Build a low-friction system that captures structured and freeform symptom data over time, turns that data into useful trend analysis, and produces outputs that are meaningful to:
- the user
- the user's primary care doctor
- the user's therapist
- the user's psychiatrist

## 3. Product stance

### 3.1 MVP positioning
The MVP is a **personal symptom tracker with clinician-shareable exports**, not a full clinical portal.

### 3.2 Out of scope for MVP
- direct EHR integration
- automated diagnosis
- medication recommendations
- live clinician logins
- emergency/crisis response workflow
- insurance/billing workflows

## 4. Stakeholders

| Role | Need |
|---|---|
| User | Fast daily check-ins, notes, trends, useful self-observation |
| Primary care doctor | Medication tolerance, appetite/weight trend, GI side effects, adherence summary |
| Therapist | Interpersonal patterns, triggers, conflict load, emotional/behavioral patterning, notes |
| Psychiatrist | Mood instability markers, sleep changes, activation/hypomania risk indicators, adherence, side-effect timeline |

## 5. Assumptions

| ID | Assumption |
|---|---|
| ASM-001 | MVP serves a single patient account |
| ASM-002 | The patient is the only live dashboard user in MVP |
| ASM-003 | Clinicians receive exported summaries rather than real-time access |
| ASM-004 | WhatsApp Business Platform is used for messaging and webhook delivery |
| ASM-005 | Cloudflare is the primary hosting/runtime platform |
| ASM-006 | Current medication tracking must include Mounjaro at initiation-stage dosing |

## 6. Success criteria

| ID | Metric | Target |
|---|---|---|
| KPI-001 | Daily check-in completion time | <= 90 seconds median |
| KPI-002 | Daily completion rate | >= 70% of prompted days over 30 days |
| KPI-003 | Weekly note capture rate | >= 1 freeform note per week on average |
| KPI-004 | Dashboard load time | <= 2.5 sec for main views |
| KPI-005 | Report usefulness | User can export a monthly summary containing mood, sleep, meds, side effects, notes, and flags |
| KPI-006 | Trend detection value | Dashboard can identify at least 5 clinically relevant pattern types |

## 7. Symptom model

### 7.1 Daily structured measures
The MVP shall support daily capture of the following high-value variables.

| Data Item ID | Variable | Type | Cadence | Why it matters |
|---|---|---|---|---|
| DAT-001 | Sleep duration | numeric | daily | Bipolar risk marker and ADHD functioning marker |
| DAT-002 | Sleep quality | ordinal | daily | Distinguishes short but okay sleep from fractured sleep |
| DAT-003 | Mood valence | ordinal | daily | Tracks depression/elevation swing |
| DAT-004 | Energy/activation | ordinal | daily | Useful for hypomania vs exhaustion patterns |
| DAT-005 | Irritability/anger | ordinal | daily | High-value cross-diagnostic marker |
| DAT-006 | Anxiety/tension | ordinal | daily | Helps separate activation from anxiety |
| DAT-007 | Focus/attention | ordinal | daily | ADHD functioning marker |
| DAT-008 | Racing thoughts | ordinal | daily | Hypomanic activation marker |
| DAT-009 | Impulsivity/urge to act | ordinal | daily | ADHD + bipolar + behavioral risk relevance |
| DAT-010 | Risk-taking/goal-drive | ordinal | daily | Distinguishes productive activation from destabilization |
| DAT-011 | Interpersonal conflict load | ordinal | daily | Useful to therapy and behavioral pattern review |
| DAT-012 | Appetite | ordinal | daily | Important for Mounjaro and mood changes |
| DAT-013 | Medication adherence | structured boolean/event | daily | Core clinical utility |
| DAT-014 | Freeform note | text | optional daily | Captures nuance that ratings miss |

### 7.2 Event-based tracking
The MVP shall support event capture outside the daily check-in.

| Data Item ID | Event | Type |
|---|---|---|
| DAT-015 | Mounjaro injection | medication event |
| DAT-016 | Missed medication dose | medication event |
| DAT-017 | Behavioral incident | tagged event |
| DAT-018 | Conflict/escalation event | tagged event |
| DAT-019 | Substance-use event | tagged event |
| DAT-020 | Extra note/journal entry | text event |

### 7.3 Mounjaro-specific variables
The app shall specifically support Mounjaro initiation and tolerability tracking.

| Data Item ID | Variable | Type | Cadence |
|---|---|---|---|
| DAT-021 | Injection date/time | event | per injection |
| DAT-022 | Injection dose | enum/numeric | per injection |
| DAT-023 | Injection site | enum | per injection |
| DAT-024 | Nausea | ordinal | daily around injection |
| DAT-025 | Diarrhea | ordinal | daily around injection |
| DAT-026 | Vomiting | ordinal | daily around injection |
| DAT-027 | Constipation | ordinal | daily around injection |
| DAT-028 | Abdominal pain | ordinal | daily around injection |
| DAT-029 | Hydration difficulty | ordinal | daily when symptomatic |
| DAT-030 | Appetite suppression | ordinal | daily |
| DAT-031 | Weight | numeric | optional daily/weekly |
| DAT-032 | Glucose reading | numeric | optional manual entry |

### 7.4 Optional weekly instruments
The MVP should support a weekly structured mania check and configurable future instruments.

| Requirement ID | Requirement |
|---|---|
| FR-INST-001 | System shall support a weekly mania screener flow |
| FR-INST-002 | System shall store instrument name, version, date, raw responses, and calculated score |
| FR-INST-003 | System shall support manual entry or future integration of additional validated screeners |
| FR-INST-004 | Instrument integrations that require licensing review shall be feature-flagged until approved |

## 8. Functional requirements

### 8.1 WhatsApp intake

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-WA-001 | System shall receive inbound WhatsApp messages via webhook | Must | Valid inbound message is persisted and acknowledged |
| FR-WA-002 | System shall identify the user by WhatsApp phone number binding | Must | Messages from bound number are assigned to correct user |
| FR-WA-003 | System shall support a guided daily check-in conversation | Must | User can complete full check-in through WhatsApp |
| FR-WA-004 | System shall support freeform note capture at any time | Must | User can send a note without entering check-in mode |
| FR-WA-005 | System shall support event commands such as `inject`, `missed med`, `note`, and `checkin` | Should | Commands produce structured records |
| FR-WA-006 | System shall recover gracefully if a user stops mid-check-in and resumes later | Must | Workflow state resumes correctly |
| FR-WA-007 | System shall send daily and weekly prompts on schedule | Must | Prompt is sent by configured schedule |
| FR-WA-008 | System shall use template messages where required by WhatsApp policy | Must | Outbound scheduled prompts succeed outside service window |
| FR-WA-009 | System shall support plain-language replies rather than requiring rigid syntax | Should | NLP parser maps common phrases to structured values |
| FR-WA-010 | System shall confirm saved entries succinctly | Should | User receives brief structured confirmation |

### 8.2 Symptom capture and note-taking

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-CAP-001 | System shall capture all core daily variables DAT-001 through DAT-014 | Must | Daily record contains all prompted fields or nulls with status |
| FR-CAP-002 | System shall allow skipping a question without abandoning the session | Must | Skipped fields remain null and session continues |
| FR-CAP-003 | System shall allow retroactive entry for prior dates | Should | User can log a missed day within a configured lookback |
| FR-CAP-004 | System shall timestamp every observation and preserve source channel | Must | Stored records include created_at and source metadata |
| FR-CAP-005 | System shall support long-form notes of at least 4,000 characters | Should | Notes save and render successfully |
| FR-CAP-006 | System shall support tagged notes | Should | User can associate tags such as meds, work, conflict, sleep |
| FR-CAP-007 | System shall allow the user to define custom event tags | Should | Custom tags can be created and reused |

### 8.3 Medication tracking

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-MED-001 | System shall track scheduled medications and adherence events | Must | Medication dose events can be logged and summarized |
| FR-MED-002 | System shall model Mounjaro injections separately from oral meds | Must | Injection records have dedicated fields |
| FR-MED-003 | System shall associate side-effect observations to nearest injection window | Must | Side-effect chart shows relation to injection timeline |
| FR-MED-004 | System shall support configurable medication lists | Must | Admin can add/edit/deactivate medication definitions |
| FR-MED-005 | System shall support missed-dose logging | Must | Missed dose appears in adherence trend |
| FR-MED-006 | System shall support optional reminder prompts for meds and injections | Could | Scheduled reminder can be toggled on/off |

### 8.4 Dashboard and review

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-DB-001 | System shall provide a web dashboard accessible online | Must | Authenticated user can open dashboard from browser |
| FR-DB-002 | Dashboard shall show time-series trends for sleep, mood, energy, focus, impulsivity, and side effects | Must | Charts render across selected date range |
| FR-DB-003 | Dashboard shall show injection timeline overlaid with appetite, weight, and GI symptoms | Must | Overlay view is available |
| FR-DB-004 | Dashboard shall show note history with filtering by date and tag | Must | Notes can be searched and filtered |
| FR-DB-005 | Dashboard shall show adherence summaries by medication | Must | User can inspect missed and taken dose trends |
| FR-DB-006 | Dashboard shall support daily, weekly, monthly, and custom ranges | Must | Time filters work consistently |
| FR-DB-007 | Dashboard shall support clinician-friendly summary mode | Should | A summary page hides build/admin clutter |
| FR-DB-008 | Dashboard shall show data completeness metrics | Should | Missing data is visible by date and measure |

### 8.5 Analysis and pattern detection

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-ANL-001 | System shall compute rolling baselines for key metrics | Must | Baseline values are visible in analytics layer |
| FR-ANL-002 | System shall detect sleep reduction plus activation clusters | Must | Rule-based flag can be produced |
| FR-ANL-003 | System shall detect appetite/weight and GI patterns around injections | Must | Injection-effect summary can be produced |
| FR-ANL-004 | System shall detect worsening focus/attention patterns | Must | ADHD functioning trend can be produced |
| FR-ANL-005 | System shall detect interpersonal strain clusters | Should | Conflict-related pattern summary can be produced |
| FR-ANL-006 | System shall generate descriptive weekly and monthly summaries | Must | Narrative summary is generated on demand |
| FR-ANL-007 | Analysis output shall be descriptive and hypothesis-oriented, not diagnostic | Must | Copy avoids diagnosis/treatment claims |
| FR-ANL-008 | System shall make rule-based flags explainable | Must | Each flag links to contributing data points |
| FR-ANL-009 | System should support optional LLM narrative synthesis behind a provider abstraction | Should | Summary provider can be swapped or disabled |
| FR-ANL-010 | System shall allow manual dismissal of non-useful flags | Could | User can mark a flag as noise |

### 8.6 Reporting and export

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-RPT-001 | System shall export clinician-readable PDF summaries | Must | PDF can be generated for selected range |
| FR-RPT-002 | System shall export CSV for raw structured data | Must | CSV contains normalized records |
| FR-RPT-003 | System shall generate monthly summary packets | Should | Monthly packet includes trends, notes, meds, flags |
| FR-RPT-004 | Export shall include a data dictionary page | Should | PDF explains scales and symbols |
| FR-RPT-005 | Export shall identify missing-data periods | Should | Report clearly shows gaps |
| FR-RPT-006 | Export shall include freeform note excerpts | Must | Notes are included in condensed form |

### 8.7 Admin and configuration

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-ADM-001 | System shall allow configuration of prompt schedule | Must | Daily/weekly schedules can be edited |
| FR-ADM-002 | System shall allow configuration of symptom questions | Should | Admin can reorder or disable selected questions |
| FR-ADM-003 | System shall allow configuration of event tags | Should | Tags persist and appear in UI |
| FR-ADM-004 | System shall support feature flags for instruments and LLM analysis | Must | Features can be toggled per environment |
| FR-ADM-005 | System shall allow export/import of config | Could | JSON config can be moved between environments |

## 9. Non-functional requirements

### 9.1 Security, privacy, and safety

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| NFR-SEC-001 | Dashboard shall require authentication | Must | Unauthenticated requests are blocked |
| NFR-SEC-002 | Principle of least privilege shall apply to all secrets and services | Must | Secrets are not exposed to client |
| NFR-SEC-003 | Sensitive data shall be encrypted in transit | Must | HTTPS/TLS enforced end to end |
| NFR-SEC-004 | Sensitive exports shall be access-controlled | Must | Export URLs are non-public or signed |
| NFR-SEC-005 | Operational telemetry shall avoid PHI where possible | Must | Logs/metrics exclude freeform notes and symptom text |
| NFR-SEC-006 | System shall include a clear non-emergency disclaimer | Must | UI and onboarding include this notice |
| NFR-SEC-007 | System shall support user-controlled data deletion/export | Should | User can export and delete records |
| NFR-SEC-008 | System shall support audit logging for auth, exports, and admin changes | Should | Audit records stored and queryable |

### 9.2 Performance and reliability

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| NFR-OPS-001 | Webhook ingestion shall acknowledge inbound messages quickly | Must | P95 webhook response <= 1 second before async processing |
| NFR-OPS-002 | Async processing shall be idempotent | Must | Duplicate webhook/event does not create duplicate records |
| NFR-OPS-003 | Dashboard shall remain usable on mobile and desktop | Must | Responsive layouts pass smoke test |
| NFR-OPS-004 | Scheduled prompts shall retry on transient failure | Must | Retry path exists |
| NFR-OPS-005 | System shall preserve raw inbound event records for troubleshooting | Should | Raw payload archive available for limited retention |
| NFR-OPS-006 | Core services shall be observable | Must | Errors, queue failures, and cron failures are visible |

### 9.3 Maintainability

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| NFR-MNT-001 | Codebase shall be modular across messaging, domain, analytics, reporting, and UI layers | Must | Clear package separation exists |
| NFR-MNT-002 | Data model shall be migration-driven | Must | Schema changes are versioned |
| NFR-MNT-003 | Domain rules shall be covered by automated tests | Must | Rule engine has test coverage |
| NFR-MNT-004 | Prompt text and scoring configs shall be data-driven where practical | Should | Changes do not require deep code edits |
| NFR-MNT-005 | System shall support local development with mock WhatsApp events | Must | Developer can test flows locally |

## 10. Safety constraints

| ID | Constraint |
|---|---|
| SAF-001 | The system shall not present itself as a medical device or diagnostic system |
| SAF-002 | The system shall not give medication dosing advice |
| SAF-003 | The system shall not recommend starting/stopping medication |
| SAF-004 | Safety alerts, if present, shall direct the user to contact a clinician or emergency services rather than improvising treatment |
| SAF-005 | LLM-generated summaries shall be clearly labeled as summaries, not medical conclusions |

## 11. Acceptance summary for MVP

The MVP is acceptable when the user can:
1. receive a daily WhatsApp prompt
2. complete a structured check-in in under 90 seconds
3. add notes freely at any time
4. log Mounjaro injections and related side effects
5. review trends in a secure web dashboard
6. export a clinician-readable monthly report
7. inspect explainable pattern flags without the app pretending to diagnose anything
