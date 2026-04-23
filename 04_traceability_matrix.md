# 04 Traceability Matrix

## 1. Traceability approach

This matrix links:
- requirements IDs
- design decisions/components
- implementation tasks

That means every build choice can be traced back to a stated need.

## 2. Requirement → design → task mapping

| Requirement ID | Requirement Summary | Design Links | Task Links |
|---|---|---|---|
| FR-WA-001 | Receive inbound WhatsApp messages | DD-001, DD-002, 2.1, 10.1 | TASK-007, TASK-008, TASK-009 |
| FR-WA-002 | Bind phone number to user | 4.1 | TASK-011 |
| FR-WA-003 | Guided daily check-in | 6.3 | TASK-014, TASK-015 |
| FR-WA-004 | Freeform note capture | 6.2, 6.5 | TASK-016 |
| FR-WA-005 | Event commands | 6.2 | TASK-013, TASK-018, TASK-019 |
| FR-WA-006 | Resume interrupted check-ins | 4.1, 6.1 | TASK-014 |
| FR-WA-007 | Scheduled prompts | 2.1, 10.1 | TASK-022 |
| FR-WA-008 | Template messages for scheduled prompts | DD-001 | TASK-023 |
| FR-WA-009 | Plain-language input parsing | 6.5 | TASK-024 |
| FR-WA-010 | Brief confirmations | 6.1 | TASK-025 |
| FR-CAP-001 | Capture core daily variables | 5, 6.3 | TASK-015 |
| FR-CAP-002 | Allow skips | 6.3 | TASK-015 |
| FR-CAP-003 | Retroactive entry | workflow extension | TASK-017 |
| FR-CAP-004 | Timestamp and source metadata | 5 | TASK-006, TASK-015 |
| FR-CAP-005 | Long freeform notes | 5.2 | TASK-016 |
| FR-CAP-006 | Tagged notes | 5.2 | TASK-016 |
| FR-CAP-007 | Custom event tags | DD-008 | TASK-026 |
| FR-MED-001 | Track meds and adherence | 5.3 | TASK-018, TASK-033 |
| FR-MED-002 | Model Mounjaro injections separately | DD-003, 5.3 | TASK-019 |
| FR-MED-003 | Relate side effects to injection window | 5.4, 7.3 | TASK-020, TASK-039 |
| FR-MED-004 | Configurable medication list | DD-008 | TASK-005 |
| FR-MED-005 | Missed-dose logging | 5.3 | TASK-018 |
| FR-MED-006 | Optional reminders | scheduler extension | future or TASK-022 extension |
| FR-INST-001 | Weekly mania screener | 7 | TASK-021 |
| FR-INST-002 | Store screener metadata and score | 4.1, 5 | TASK-021 |
| FR-INST-003 | Support future screeners | DD-008 | TASK-021, future expansion |
| FR-INST-004 | Feature-flag licensed instruments | DD-008, feature flags | TASK-005, TASK-026 |
| FR-DB-001 | Secure web dashboard | DD-005, 2.1 | TASK-027, TASK-028, TASK-029 |
| FR-DB-002 | Trend charts | 8.1 | TASK-031 |
| FR-DB-003 | Injection overlay | 8.1 | TASK-034 |
| FR-DB-004 | Note history/filtering | 8.1 | TASK-032 |
| FR-DB-005 | Med adherence summaries | 8.1 | TASK-033 |
| FR-DB-006 | Flexible date ranges | dashboard query layer | TASK-031, TASK-033, TASK-034 |
| FR-DB-007 | Clinician summary mode | DD-007 | TASK-035 |
| FR-DB-008 | Data completeness metrics | 7.2, 8.1 | TASK-030, TASK-046 |
| FR-ANL-001 | Rolling baselines | 7.2 | TASK-036 |
| FR-ANL-002 | Sleep + activation detection | 7.3 | TASK-037 |
| FR-ANL-003 | Injection/side-effect detection | 7.3 | TASK-039 |
| FR-ANL-004 | Focus decline detection | 7.3 | TASK-038 |
| FR-ANL-005 | Interpersonal strain detection | 7.3 | TASK-038 |
| FR-ANL-006 | Weekly/monthly summaries | 7.4 | TASK-041, TASK-043 |
| FR-ANL-007 | Descriptive, non-diagnostic analysis | DD-006, 7.4 | TASK-041, TASK-042, TASK-051 |
| FR-ANL-008 | Explainable flags | DD-006, 7.3 | TASK-037, TASK-038, TASK-039, TASK-040 |
| FR-ANL-009 | Optional LLM synthesis | DD-006, 7.5 | TASK-042 |
| FR-ANL-010 | Dismiss noisy flags | 5.6, 7.3 | TASK-040 |
| FR-RPT-001 | PDF clinician reports | 8 | TASK-043 |
| FR-RPT-002 | CSV export | 8.2 | TASK-044 |
| FR-RPT-003 | Monthly summary packet | 8.1 | TASK-043 |
| FR-RPT-004 | Data dictionary in report | 8.1 | TASK-045 |
| FR-RPT-005 | Missing-data section | 8.1 | TASK-046 |
| FR-RPT-006 | Note excerpts in report | 8.1 | TASK-043 |
| FR-ADM-001 | Configure schedules | DD-008, 10.1 | TASK-005, TASK-022 |
| FR-ADM-002 | Configure symptom questions | DD-008 | TASK-005, TASK-026 |
| FR-ADM-003 | Configure tags | DD-008 | TASK-005, TASK-026 |
| FR-ADM-004 | Feature flags | DD-008 | TASK-005 |
| FR-ADM-005 | Export/import config | config tooling | future task |
| NFR-SEC-001 | Dashboard auth | DD-005 | TASK-028 |
| NFR-SEC-004 | Secure export access | 9.3 | TASK-047 |
| NFR-SEC-005 | Avoid PHI in ops telemetry | 9.2 | TASK-048 |
| NFR-SEC-006 | Non-emergency disclaimer | 9.1 | TASK-051 |
| NFR-SEC-007 | User data export/delete | 9.2 | TASK-050 |
| NFR-SEC-008 | Audit logging | 9.5 | TASK-012, TASK-049 |
| NFR-OPS-001 | Fast webhook ack | DD-002 | TASK-007, TASK-009 |
| NFR-OPS-002 | Idempotent async processing | DD-002 | TASK-008, TASK-010 |
| NFR-OPS-004 | Retry scheduled/queue work | 10.2 | TASK-010, TASK-054 |
| NFR-MNT-002 | Migration-driven schema | DD-003 | TASK-006 |
| NFR-MNT-003 | Automated tests | maintainability | TASK-052 |
| NFR-MNT-005 | Local mock workflow dev | 10.3 | TASK-053 |

## 3. Data item traceability

| Data Item ID | Captured By | Used In |
|---|---|---|
| DAT-001..DAT-014 | TASK-015 | TASK-031, TASK-036, TASK-041, TASK-043 |
| DAT-015..DAT-020 | TASK-018, TASK-019, TASK-020 | TASK-033, TASK-034, TASK-039, TASK-043 |
| DAT-021..DAT-032 | TASK-019, TASK-020 | TASK-034, TASK-039, TASK-043 |

## 4. Release gating traceability

| Release Gate | Required Tasks | Why |
|---|---|---|
| MVP messaging works | TASK-007 through TASK-025 | No intake, no product |
| MVP dashboard works | TASK-027 through TASK-034 | No review surface, no value |
| MVP analytics works | TASK-036 through TASK-041 | No interpretation, weak utility |
| MVP exports work | TASK-043 through TASK-047 | No clinician handoff |
| MVP safe enough | TASK-048, TASK-051, TASK-052, TASK-056 | Avoid irresponsible release |
