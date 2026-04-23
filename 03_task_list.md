# 03 Task List

## 1. Delivery plan

This task list is ordered for a practical build. Each task includes:
- task ID
- description
- dependency
- mapped requirement IDs
- mapped design decisions/components

## 2. Milestone overview

| Milestone | Goal |
|---|---|
| M0 | Repository, toolchain, environments |
| M1 | Webhook ingress and data model |
| M2 | WhatsApp workflow engine |
| M3 | Dashboard foundation |
| M4 | Analytics and reports |
| M5 | Security hardening and release readiness |

## 3. Detailed tasks

### M0 — Repository and environments

| Task ID | Title | Depends On | Satisfies | Design Links |
|---|---|---|---|---|
| TASK-001 | Create monorepo with apps for worker API, dashboard, shared domain package | — | NFR-MNT-001 | DD-002, DD-003 |
| TASK-002 | Set up TypeScript, linting, formatting, test runner, env validation | TASK-001 | NFR-MNT-003, NFR-MNT-005 | operational baseline |
| TASK-003 | Configure Cloudflare environments for dev/prod with D1, KV, R2, Queue bindings | TASK-001 | NFR-MNT-002, NFR-OPS-006 | 10.3 |
| TASK-004 | Add CI pipeline for tests and preview deploys | TASK-002 | NFR-MNT-003 | 10.3 |
| TASK-005 | Create seed config for symptom questions, meds, tags, schedules | TASK-002 | FR-ADM-001, FR-ADM-002, FR-MED-004 | DD-008 |

### M1 — Ingress and persistence

| Task ID | Title | Depends On | Satisfies | Design Links |
|---|---|---|---|---|
| TASK-006 | Implement D1 schema migrations for core entities | TASK-003 | NFR-MNT-002, FR-CAP-004 | 4, 5 |
| TASK-007 | Implement inbound webhook verification endpoint | TASK-003 | FR-WA-001 | DD-002 |
| TASK-008 | Persist raw inbound message envelope with idempotency key | TASK-007, TASK-006 | NFR-OPS-002, NFR-OPS-005 | DD-002, 9.2 |
| TASK-009 | Publish inbound events to Queue after quick ack | TASK-007 | NFR-OPS-001, NFR-OPS-004 | DD-002 |
| TASK-010 | Build queue consumer skeleton with dead-letter strategy | TASK-009 | NFR-OPS-004, NFR-OPS-006 | 10.2 |
| TASK-011 | Implement phone-number to user binding model | TASK-006 | FR-WA-002 | 4.1 |
| TASK-012 | Implement audit event table and writer utility | TASK-006 | NFR-SEC-008 | 9.5 |

### M2 — WhatsApp workflow engine

| Task ID | Title | Depends On | Satisfies | Design Links |
|---|---|---|---|---|
| TASK-013 | Implement command router for `checkin`, `note`, `inject`, `missed med`, `status` | TASK-010, TASK-011 | FR-WA-005, FR-WA-010 | 6.2 |
| TASK-014 | Implement check-in session state storage and resume logic | TASK-013 | FR-WA-006 | 4.1, 6.3 |
| TASK-015 | Implement daily check-in question flow | TASK-014 | FR-WA-003, FR-CAP-001, FR-CAP-002 | 6.3 |
| TASK-016 | Implement freeform note capture and tagging | TASK-013 | FR-WA-004, FR-CAP-005, FR-CAP-006 | 4.1 |
| TASK-017 | Implement retroactive date selection for missed check-ins | TASK-015 | FR-CAP-003 | workflow extension |
| TASK-018 | Implement medication event logging flows | TASK-013 | FR-MED-001, FR-MED-005 | 5.3 |
| TASK-019 | Implement Mounjaro injection flow including dose/site/time capture | TASK-018 | FR-MED-002, DAT-021..DAT-023 | 6.4 |
| TASK-020 | Implement side-effect capture model and storage | TASK-019 | FR-MED-003, DAT-024..DAT-030 | 5.4 |
| TASK-021 | Implement weekly mania screener scaffold | TASK-015 | FR-INST-001, FR-INST-002 | 7 |
| TASK-022 | Implement outbound prompt scheduler with cron | TASK-003 | FR-WA-007, FR-ADM-001 | 10.1 |
| TASK-023 | Implement WhatsApp template send support for scheduled prompts | TASK-022 | FR-WA-008 | DD-001 |
| TASK-024 | Implement plain-language parsing for common numeric/value replies | TASK-015 | FR-WA-009 | 6.5 |
| TASK-025 | Add concise save confirmations and failure recovery copy | TASK-015 | FR-WA-010, NFR-OPS-004 | 6.1 |
| TASK-026 | Add configurable question packs and event tags | TASK-005, TASK-015 | FR-ADM-002, FR-ADM-003 | DD-008 |

### M3 — Dashboard foundation

| Task ID | Title | Depends On | Satisfies | Design Links |
|---|---|---|---|---|
| TASK-027 | Create React dashboard shell and route structure | TASK-001 | FR-DB-001 | 2.1 |
| TASK-028 | Protect dashboard with Cloudflare Access | TASK-027 | NFR-SEC-001 | DD-005 |
| TASK-029 | Implement API endpoints for check-ins, notes, meds, flags, reports | TASK-006 | FR-DB-001, FR-DB-004, FR-DB-005 | 10.1 |
| TASK-030 | Build overview page with key metrics and completion status | TASK-027, TASK-029 | FR-DB-008 | 7.2 |
| TASK-031 | Build time-series charts for sleep, mood, energy, focus, impulsivity | TASK-029 | FR-DB-002, FR-DB-006 | 8.1 |
| TASK-032 | Build note viewer with search and tag/date filters | TASK-029 | FR-DB-004 | 8.1 |
| TASK-033 | Build medication adherence view | TASK-029 | FR-DB-005 | 8.1 |
| TASK-034 | Build injection overlay view for appetite, weight, and GI symptoms | TASK-029 | FR-DB-003 | 8.1 |
| TASK-035 | Add clinician-summary dashboard mode | TASK-030 | FR-DB-007 | DD-007 |

### M4 — Analytics and reports

| Task ID | Title | Depends On | Satisfies | Design Links |
|---|---|---|---|---|
| TASK-036 | Implement analytics projection layer and rolling baselines | TASK-006 | FR-ANL-001 | 7.1, 7.2 |
| TASK-037 | Implement rule engine for hypomania/activation flags | TASK-036 | FR-ANL-002, FR-ANL-008 | 7.3 |
| TASK-038 | Implement rule engine for ADHD/function and conflict flags | TASK-036 | FR-ANL-004, FR-ANL-005, FR-ANL-008 | 7.3 |
| TASK-039 | Implement Mounjaro side-effect and appetite/injection rules | TASK-036, TASK-020 | FR-ANL-003, FR-ANL-008 | 7.3 |
| TASK-040 | Build explainable flag UI in dashboard | TASK-037, TASK-038, TASK-039 | FR-ANL-008, FR-ANL-010 | 7.3 |
| TASK-041 | Implement deterministic weekly summary generator | TASK-036 | FR-ANL-006, FR-ANL-007 | 7.4 |
| TASK-042 | Add optional LLM summary provider abstraction | TASK-041 | FR-ANL-009, SAF-005 | 7.5 |
| TASK-043 | Implement PDF monthly report generation | TASK-041 | FR-RPT-001, FR-RPT-003, FR-RPT-006 | 8 |
| TASK-044 | Implement CSV export generation | TASK-029 | FR-RPT-002 | 8.2 |
| TASK-045 | Add data dictionary section to report | TASK-043 | FR-RPT-004 | 8.1 |
| TASK-046 | Add missing-data and caveat section to report | TASK-043 | FR-RPT-005, FR-DB-008 | 8.1 |
| TASK-047 | Store generated artifacts in R2 and expose secure download endpoint | TASK-043, TASK-044 | NFR-SEC-004 | DD-004 |

### M5 — Hardening and release readiness

| Task ID | Title | Depends On | Satisfies | Design Links |
|---|---|---|---|---|
| TASK-048 | Minimize PHI in logs and redact sensitive fields | TASK-007, TASK-029 | NFR-SEC-005 | 9.2 |
| TASK-049 | Add audit events for login, export, config changes, and summary generation | TASK-012, TASK-028, TASK-047 | NFR-SEC-008 | 9.5 |
| TASK-050 | Add data export and delete controls | TASK-029 | NFR-SEC-007 | 9.2 |
| TASK-051 | Add non-emergency disclaimer and safety copy to onboarding and reports | TASK-027 | NFR-SEC-006, SAF-001..SAF-004 | 9.1 |
| TASK-052 | Add automated tests for workflow engine, parser, rule engine, and export generation | TASK-015, TASK-036, TASK-043 | NFR-MNT-003 | maintainability |
| TASK-053 | Add local mock webhook fixtures and CLI dev helpers | TASK-007 | NFR-MNT-005 | 10.3 |
| TASK-054 | Add retry/backoff and dead-letter dashboards for queue jobs | TASK-010 | NFR-OPS-004, NFR-OPS-006 | 10.2 |
| TASK-055 | Performance pass on dashboard queries and chart rendering | TASK-031, TASK-034 | KPI-004, NFR-OPS-003 | 7.2 |
| TASK-056 | Release checklist, smoke tests, and production cutover runbook | TASK-052, TASK-055 | release readiness | operations |

## 4. Recommended MVP cut line

If you want the fastest useful release, ship after:
- TASK-001 through TASK-041
- TASK-043
- TASK-047
- TASK-048
- TASK-051
- TASK-052
- TASK-056

That gives you:
- WhatsApp intake
- structured tracking
- Mounjaro tracking
- dashboard
- rule-based flags
- monthly PDF
- basic hardening

## 5. Recommended deferrals

Safe to defer until after first real usage:
- TASK-017 retroactive date entry
- TASK-021 richer instrument support
- TASK-024 smarter natural-language parsing
- TASK-035 clinician-summary mode polish
- TASK-042 LLM summaries
- TASK-050 self-service delete UX
