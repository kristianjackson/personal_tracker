# Tasks: Symptom Tracker MVP

## Milestone M0 — Repository and environments

- [x] 1. Create monorepo with `apps/worker-api`, `apps/dashboard`, `packages/shared` (domain types, config, utils)
  - Requirements: NFR-MNT-001
  - Design: DD-002, DD-003

- [x] 2. Set up TypeScript, ESLint, Prettier, Vitest, and environment validation
  - Requirements: NFR-MNT-003, NFR-MNT-005
  - Depends on: Task 1

- [x] 3. Configure Cloudflare environments (dev/prod) with D1, KV, R2, Queue bindings in wrangler.toml
  - Requirements: NFR-MNT-002, NFR-OPS-006
  - Depends on: Task 1

- [x] 4. Add CI pipeline (GitHub Actions) for lint, test, and preview deploys
  - Requirements: NFR-MNT-003
  - Depends on: Task 2

- [x] 5. Create seed config JSON files for symptom questions (0–5 ordinal scale), medication definitions (including Mounjaro with dose enum), predefined tags, prompt schedules, and feature flags
  - Requirements: FR-ADM-001, FR-ADM-002, FR-ADM-003, FR-ADM-004, FR-MED-004, DD-008
  - Depends on: Task 2

## Milestone M1 — Ingress and persistence

- [x] 6. Implement D1 schema migrations for all core entities: user (with IANA timezone), whatsapp_binding, daily_checkin (with UNIQUE user_id+checkin_date), symptom_observation (with skipped flag), note (with JSON tags array), medication_definition, medication_event (with injection_site), side_effect_observation, behavioral_event, instrument_response, analytic_flag, summary_report, audit_event
  - Requirements: NFR-MNT-002, FR-CAP-004
  - Design: Sections 5.1–5.13
  - Depends on: Task 3

- [x] 7. Implement inbound webhook verification endpoint (Meta webhook challenge/verify token validation) that returns 200 within 200ms
  - Requirements: FR-WA-001, NFR-OPS-001
  - Design: DD-002
  - Depends on: Task 3

- [x] 8. Persist raw inbound message envelope to R2 (30-day TTL) with message_id as idempotency/dedup key
  - Requirements: NFR-OPS-002, NFR-OPS-005
  - Design: DD-002, DD-004
  - Depends on: Task 7, Task 6

- [x] 9. Publish inbound message events to Cloudflare Queue after quick ack (return 200 before processing)
  - Requirements: NFR-OPS-001, NFR-OPS-004
  - Design: DD-002
  - Depends on: Task 7

- [x] 10. Build queue consumer skeleton with dead-letter strategy (retry 3x with exponential backoff, then dead-letter)
  - Requirements: NFR-OPS-004, NFR-OPS-006
  - Design: Section 10.2
  - Depends on: Task 9

- [x] 11. Implement phone-number to user binding model (whatsapp_binding table, lookup by phone number, assign to user)
  - Requirements: FR-WA-002
  - Design: Section 5.2
  - Depends on: Task 6

- [x] 12. Implement audit_event table and writer utility (action types: login, export, config_change, delete, summary_generate, flag_dismiss)
  - Requirements: NFR-SEC-008
  - Design: Section 5.13, 9.5
  - Depends on: Task 6

## Milestone M2 — WhatsApp workflow engine

- [x] 13. Implement command router that parses inbound text for commands: `checkin`, `note:`, `inject`, `missed med`, `status`, `report month`, `tags`, `help`
  - Requirements: FR-WA-005, FR-WA-010
  - Design: Section 6.2
  - Depends on: Task 10, Task 11

- [x] 14. Implement check-in session state in KV (4-hour TTL) with resume logic: store current question index, partial answers, session start time; resume from last unanswered question
  - Requirements: FR-WA-006
  - Design: DD-009, Section 6.1
  - Depends on: Task 13

- [x] 15. Implement daily check-in question flow: 13 questions in order (sleep hours → sleep quality → mood → energy → irritability → anxiety → focus → racing thoughts → impulsivity → risk-drive → conflict → appetite → meds taken), plus optional side effects and note. Support "skip"/"s"/"next" to skip. Write completed check-in to D1 daily_checkin + symptom_observation rows.
  - Requirements: FR-WA-003, FR-CAP-001, FR-CAP-002
  - Design: Section 6.3
  - Depends on: Task 14

- [x] 16. Implement freeform note capture: parse `note: <text>` command, store in note table with body (max 4000 chars), auto-suggest tags from predefined list based on keyword matching, allow user to confirm/edit tags
  - Requirements: FR-WA-004, FR-CAP-005, FR-CAP-006
  - Design: Section 5.5
  - Depends on: Task 13

- [x] 17. Implement retroactive date selection: allow `checkin yesterday` or `checkin 2025-04-20` within 7-day lookback, flag record as is_retroactive=1
  - Requirements: FR-CAP-003
  - Depends on: Task 15
  - Note: Deferrable to post-MVP

- [~] 18. Implement medication event logging: `missed med` and `missed <med-name>` commands create medication_event records with event_type=missed; `took <med-name>` creates event_type=taken
  - Requirements: FR-MED-001, FR-MED-005
  - Design: Section 5.7
  - Depends on: Task 13

- [~] 19. Implement Mounjaro injection flow: `inject` command triggers guided flow asking dose (2.5/5/7.5/10/12.5/15 mg), time (now or specific), site (abdomen/thigh-L/thigh-R/arm-L/arm-R), and 72h symptom watch opt-in. Creates medication_event with event_type=injected and injection_site.
  - Requirements: FR-MED-002, DAT-021, DAT-022, DAT-023
  - Design: Section 6.4
  - Depends on: Task 18

- [~] 20. Implement side-effect capture: after injection (and during 72h watch follow-ups), prompt for nausea/diarrhea/vomiting/constipation/abdominal pain/hydration difficulty/appetite suppression on 0–5 scale. Store as side_effect_observation linked to nearest medication_event within 72h window.
  - Requirements: FR-MED-003, DAT-024–DAT-030
  - Design: Section 5.8
  - Depends on: Task 19

- [~] 21. Implement weekly mania screener scaffold: feature-flagged instrument flow via WhatsApp, stores instrument_response with name, version, raw JSON responses, and calculated score
  - Requirements: FR-INST-001, FR-INST-002, FR-INST-004
  - Depends on: Task 15
  - Note: Deferrable to post-MVP

- [~] 22. Implement outbound prompt scheduler: cron trigger sends daily check-in prompt and weekly summary prompt at user's configured local time (convert IANA timezone to UTC for cron scheduling)
  - Requirements: FR-WA-007, FR-ADM-001
  - Design: DD-010, Section 10.1
  - Depends on: Task 3

- [~] 23. Implement WhatsApp template message support: use pre-approved templates for scheduled prompts sent outside the 24h service window
  - Requirements: FR-WA-008
  - Design: DD-001
  - Depends on: Task 22

- [~] 24. Implement plain-language parser for common reply patterns: extract numbers from "slept 4 hours", "mood 4", "4/5", "pretty elevated maybe 4"; handle "skip"/"s"/"next"; detect medication names in "missed seroquel"
  - Requirements: FR-WA-009
  - Design: Section 6.5
  - Depends on: Task 15
  - Note: Deferrable — start with strict numeric parsing, enhance later

- [~] 25. Add concise save confirmations after each persisted record (e.g. "✓ Check-in saved (11/13 answered)") and failure recovery messages when writes fail
  - Requirements: FR-WA-010, NFR-OPS-004
  - Design: Section 6.1
  - Depends on: Task 15

- [~] 26. Add configurable question packs: load check-in questions from seed config JSON, support reordering and disabling questions. Add custom tag creation via `tags add <name>` command.
  - Requirements: FR-ADM-002, FR-ADM-003, FR-CAP-007
  - Design: DD-008
  - Depends on: Task 5, Task 15

## Milestone M3 — Dashboard foundation

- [ ] 27. Create React + TypeScript dashboard shell on Cloudflare Pages: app layout, routing (overview, trends, notes, medications, flags, reports, settings), responsive design (375px/768px/1280px breakpoints)
  - Requirements: FR-DB-001, NFR-OPS-003
  - Design: Section 2.1
  - Depends on: Task 1

- [ ] 28. Protect dashboard with Cloudflare Access: configure Access policy for single allowed email, validate Access JWT on all API requests
  - Requirements: NFR-SEC-001
  - Design: DD-005, Section 9.2
  - Depends on: Task 27

- [ ] 29. Implement dashboard API endpoints (Hono on Workers): GET /api/checkins (with date range), GET /api/notes (with tag/date filters, text search), GET /api/medications (events + adherence), GET /api/flags (active/dismissed), GET /api/reports (list + download), GET /api/overview (completion stats)
  - Requirements: FR-DB-001, FR-DB-004, FR-DB-005, FR-DB-006
  - Design: Section 10.1
  - Depends on: Task 6

- [ ] 30. Build overview page: completion rate chart, check-in streak, note count, active flag count, missing-data-by-variable heatmap, last check-in timestamp
  - Requirements: FR-DB-008
  - Design: Section 7.2
  - Depends on: Task 27, Task 29

- [ ] 31. Build time-series trend charts: line charts for sleep (hours), mood, energy, focus, impulsivity, irritability (0–5 y-axis) with daily/weekly/monthly/custom date range selector. Show 7-day rolling average overlay.
  - Requirements: FR-DB-002, FR-DB-006
  - Design: Section 7.2
  - Depends on: Task 29

- [ ] 32. Build note viewer: paginated note list with full-text search, tag filter chips, date range filter, expandable note cards showing full body and tags
  - Requirements: FR-DB-004
  - Depends on: Task 29

- [ ] 33. Build medication adherence view: per-medication taken/missed/injected timeline, weekly adherence percentage bar chart, missed-dose highlights
  - Requirements: FR-DB-005
  - Depends on: Task 29

- [ ] 34. Build injection overlay view: injection event markers on timeline with appetite suppression, weight, and GI symptom (nausea/diarrhea/vomiting/constipation/abdominal pain) severity curves overlaid. Show day-offset from injection (day 0, +1, +2, +3).
  - Requirements: FR-DB-003
  - Design: Section 7.2
  - Depends on: Task 29

- [ ] 35. Add clinician-summary dashboard mode: toggle that hides settings/admin/config UI and shows only clinical data views (trends, meds, flags, notes) with print-friendly styling
  - Requirements: FR-DB-007
  - Design: DD-007
  - Depends on: Task 30
  - Note: Deferrable — polish post-MVP

## Milestone M4 — Analytics and reports

- [ ] 36. Implement analytics projection layer: compute rolling 7-day baselines (minimum 4 data points) for sleep, mood, energy, focus, appetite. Cache in KV with 1-hour TTL. Compute adherence rate, completion rate, missing-data score.
  - Requirements: FR-ANL-001
  - Design: Section 7.1, 7.2
  - Depends on: Task 6

- [ ] 37. Implement rule engine for hypomania/activation flags: FLG-HYPO-001 (sleep < baseline by >=1.0 for >=2 days AND energy >=4 AND racing_thoughts >=3), FLG-HYPO-002 (risk_drive >=4 AND impulsivity >=4 AND mood >=4). Store with dates, variables, thresholds, confidence tier, explanation.
  - Requirements: FR-ANL-002, FR-ANL-008
  - Design: Section 7.3
  - Depends on: Task 36

- [ ] 38. Implement rule engine for ADHD/function and conflict flags: FLG-ADHD-001 (focus <=2 for >=3 of last 5 days), FLG-CONFLICT-001 (conflict >=3 AND irritability >=3 for >=2 days in 5-day window), FLG-MED-001 (>=2 missed doses same med in 7 days), FLG-DATA-001 (<4 data points in 7-day window).
  - Requirements: FR-ANL-004, FR-ANL-005, FR-ANL-008
  - Design: Section 7.3
  - Depends on: Task 36

- [ ] 39. Implement Mounjaro side-effect and appetite/injection rules: FLG-MJ-001 (nausea/diarrhea/vomiting >=3 within 72h of injection), FLG-MJ-002 (appetite suppression increased by >=2 over pre-injection baseline within 72h).
  - Requirements: FR-ANL-003, FR-ANL-008
  - Design: Section 7.3
  - Depends on: Task 36, Task 20

- [ ] 40. Build explainable flag UI in dashboard: flag list with code, severity badge (weak/moderate/strong), date range, contributing data points, threshold explanation, and dismiss button. Dismissed flags hidden from default view.
  - Requirements: FR-ANL-008, FR-ANL-010
  - Design: Section 7.3
  - Depends on: Task 37, Task 38, Task 39

- [ ] 41. Implement deterministic weekly/monthly summary generator: pull structured aggregates, produce narrative text covering period overview, sleep/activation, focus, medication adherence, Mounjaro/side effects, conflict/behavioral notes, active flags, missing data caveats. No treatment advice. Label uncertainty.
  - Requirements: FR-ANL-006, FR-ANL-007
  - Design: Section 7.4
  - Depends on: Task 36

- [ ] 42. Add optional LLM summary provider abstraction: interface for swapping providers (OpenAI/Anthropic/Workers AI), system prompt forbidding diagnosis/treatment, "AI-generated summary" label, source snippet storage, fallback to deterministic summary. Feature-flagged off by default.
  - Requirements: FR-ANL-009, SAF-005
  - Design: Section 7.5
  - Depends on: Task 41
  - Note: Deferrable to post-MVP

- [ ] 43. Implement PDF monthly report generation: cover page (period, disclaimer, date), quick stats, sleep/mood/energy chart, focus/impulsivity/conflict chart, medication adherence table, injection timeline with side-effect overlay, weight/appetite summary, top 10 note excerpts (truncated 500 chars), active flags with explanations, missing data caveats, data dictionary appendix.
  - Requirements: FR-RPT-001, FR-RPT-003, FR-RPT-006
  - Design: Section 8.1
  - Depends on: Task 41

- [ ] 44. Implement CSV export generation: separate CSV files for daily_checkins, symptom_observations, notes, medication_events, side_effect_observations, instrument_responses, analytic_flags. Headers match data dictionary.
  - Requirements: FR-RPT-002
  - Design: Section 8.2
  - Depends on: Task 29

- [ ] 45. Add data dictionary section to PDF report: explain 0–5 ordinal scale, all variable codes (DAT-001 through DAT-032), flag codes (FLG-*), event types, and symbols used in charts
  - Requirements: FR-RPT-004
  - Design: Section 8.1
  - Depends on: Task 43

- [ ] 46. Add missing-data and caveat section to PDF report: show date gaps, incomplete check-ins, variables with insufficient data, and FLG-DATA-001 flags
  - Requirements: FR-RPT-005, FR-DB-008
  - Depends on: Task 43

- [ ] 47. Store generated PDF/CSV artifacts in R2 with structured key paths, expose secure download endpoint with signed URLs (15-minute expiry). Log export generation as audit event.
  - Requirements: NFR-SEC-004
  - Design: DD-004, Section 9.2
  - Depends on: Task 43, Task 44

## Milestone M5 — Hardening and release readiness

- [ ] 48. Minimize PHI in logs: ensure structured logs contain only IDs, codes, counts, and durations. Redact note text, symptom values, and freeform content from all error messages and operational telemetry.
  - Requirements: NFR-SEC-005
  - Design: Section 9.3
  - Depends on: Task 7, Task 29

- [ ] 49. Add audit events for login (Cloudflare Access), export generation, config changes, summary generation, flag dismissal, and data deletion
  - Requirements: NFR-SEC-008
  - Design: Section 9.5
  - Depends on: Task 12, Task 28, Task 47

- [ ] 50. Add data export and delete controls: API endpoint to export all user data as CSV bundle, API endpoint to delete all user data with confirmation, both logged as audit events
  - Requirements: NFR-SEC-007
  - Depends on: Task 29
  - Note: Deferrable — UX polish post-MVP

- [ ] 51. Add non-emergency disclaimer to: WhatsApp onboarding message, dashboard footer, report cover page. Text: "This is a personal tracking tool, not a medical device. It does not provide diagnosis, treatment advice, or emergency support. If you are in crisis, contact your clinician or call 988."
  - Requirements: NFR-SEC-006, SAF-001, SAF-002, SAF-003, SAF-004
  - Design: Section 9.1
  - Depends on: Task 27

- [ ] 52. Add automated tests: unit tests for command router, check-in flow, natural-language parser, all 8 flag rules, baseline computation, PDF/CSV generation. Integration tests for webhook → queue → D1 pipeline with mock fixtures.
  - Requirements: NFR-MNT-003
  - Depends on: Task 15, Task 36, Task 43

- [ ] 53. Add local mock webhook fixtures and CLI dev helpers: sample WhatsApp webhook payloads for each message type, script to send mock webhooks to local Miniflare, mock KV/D1 seed data
  - Requirements: NFR-MNT-005
  - Depends on: Task 7

- [ ] 54. Add retry/backoff monitoring and dead-letter visibility: log queue retry counts, expose dead-letter queue contents via admin API endpoint, alert on repeated failures
  - Requirements: NFR-OPS-004, NFR-OPS-006
  - Design: Section 10.2
  - Depends on: Task 10

- [ ] 55. Performance pass: optimize D1 queries with indexes on (user_id, checkin_date), (user_id, event_date), (user_id, observed_date). Lazy-load dashboard chart data. Target <= 2.5s main view load.
  - Requirements: KPI-004, NFR-OPS-003
  - Depends on: Task 31, Task 34

- [ ] 56. Release checklist: smoke test script covering webhook → check-in → dashboard → flag → export flow, production cutover runbook, environment variable checklist, WhatsApp template approval status verification
  - Requirements: Release readiness
  - Depends on: Task 52, Task 55
