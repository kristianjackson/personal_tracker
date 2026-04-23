# Next Steps (Action Plan)

This plan translates the blueprint documents into an execution sequence you can start immediately.

## 1) Confirm scope and release target (today)

- Lock MVP scope to **personal-use tracker + clinician exports** (no clinician logins).
- Confirm the cut line from `03_task_list.md` section 4 (through TASK-041 plus TASK-043, 047, 048, 051, 052, 056).
- Freeze the first-release success checklist:
  - WhatsApp prompt received
  - Daily check-in completed
  - Injection logged
  - Dashboard reviewed
  - Explainable flags visible
  - Monthly PDF exported

## 2) Set up project foundation (M0)

Complete these first because everything else depends on them:

1. TASK-001: Monorepo structure (`worker-api`, `dashboard`, `shared/domain`).
2. TASK-002: TypeScript, lint/format, tests, env validation.
3. TASK-003: Cloudflare environments and bindings (D1, KV, R2, Queue).
4. TASK-004: CI pipeline for tests + preview deploys.
5. TASK-005: Seed config (question packs, meds, tags, schedules).

## 3) Build message ingestion and storage (M1)

Prioritize a reliable inbound pipeline before conversational logic:

1. TASK-006: D1 migrations for core entities.
2. TASK-007: Webhook verification endpoint.
3. TASK-008: Persist raw inbound payload with idempotency key.
4. TASK-009: Fast ack + queue publish.
5. TASK-010: Queue consumer skeleton + dead-letter strategy.
6. TASK-011: WhatsApp phone-number binding.
7. TASK-012: Audit events table + writer.

## 4) Implement WhatsApp workflow (M2)

Build the narrowest high-value flow first:

1. TASK-013: Command router (`checkin`, `note`, `inject`, `missed med`, `status`).
2. TASK-014/015: Session state + guided daily check-in.
3. TASK-016: Freeform note capture with tagging.
4. TASK-018/019/020: Medication events, Mounjaro injection details, side effects.
5. TASK-022/023: Scheduled prompts + template sends.
6. TASK-025: Save confirmations and failure copy.
7. TASK-026: Config-driven question packs and tags.

Deferrable for post-MVP: TASK-017, TASK-021, TASK-024.

## 5) Build dashboard essentials (M3)

Ship the minimum surfaces needed for review and clinical handoff prep:

1. TASK-027/028: Dashboard shell + Cloudflare Access protection.
2. TASK-029: API endpoints for check-ins, notes, meds, flags, reports.
3. TASK-031: Core trend charts.
4. TASK-032: Notes filter/search.
5. TASK-033: Medication adherence view.
6. TASK-034: Injection overlay with appetite/weight/GI symptoms.

## 6) Add analytics and exports (M4)

Focus on deterministic, explainable output:

1. TASK-036: Rolling baselines.
2. TASK-037/038/039: Rule engines for activation, ADHD/function, interpersonal, and injection effects.
3. TASK-040: Explainable flags UI.
4. TASK-041: Deterministic weekly/monthly narrative synthesis.
5. TASK-043: Monthly PDF generation.
6. TASK-047: Store artifacts in R2 and secure download endpoint.

Post-MVP option: TASK-042 (LLM summary abstraction).

## 7) Safety and release hardening (M5)

Before first production use:

1. TASK-048: PHI-minimized logs and redaction.
2. TASK-051: Non-emergency disclaimer in onboarding and reports.
3. TASK-052: Automated tests for workflow/parser/rules/exports.
4. TASK-056: Release checklist + smoke tests + cutover runbook.

## 8) Suggested immediate 7-day execution plan

### Day 1-2
- Finish M0 (TASK-001..005).
- Draft D1 migrations and run local schema checks.

### Day 3-4
- Finish core M1 (TASK-006..011).
- Verify inbound webhook + queue path end-to-end with fixture payloads.

### Day 5-6
- Ship `checkin`, `note`, `inject` conversational flows (TASK-013..016, 018..020).
- Add minimal prompt scheduling (TASK-022).

### Day 7
- Create dashboard shell, auth gate, and one chart + note list (TASK-027..032 partial).
- Demo end-to-end from WhatsApp message to dashboard rendering.

## 9) Top risks to manage now

- **WhatsApp template/policy friction:** start template approval early.
- **Idempotency gaps in async flow:** enforce dedupe keys before feature expansion.
- **PHI leakage in logs:** add redaction at ingress, not later.
- **Scope creep into clinician portal:** keep exports as the only clinician handoff in v1.

## 10) Definition of “ready for real daily use”

You are ready when all are true:

- Inbound webhook reliability and retries are stable.
- Daily check-in median completion is close to the KPI target (<= 90 seconds).
- Trend and flag views are understandable without manual SQL inspection.
- Monthly PDF + CSV exports work and are access-controlled.
- Safety copy/disclaimer and audit events are present.

