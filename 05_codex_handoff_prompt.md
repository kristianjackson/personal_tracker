# 05 Codex Handoff Prompt

Use this exactly or modify it lightly.

---

Build the application described in the attached documents:

- `01_requirements.md`
- `02_design.md`
- `03_task_list.md`
- `04_traceability_matrix.md`

## What I want from you

Create a production-minded MVP for a **personal symptom-tracking system** with these constraints:

- **Cloudflare-hosted**
- **WhatsApp is the primary user interface**
- **secure web dashboard**
- **single-user MVP**
- **clinician-shareable exports**
- **rule-based analytics first**
- optional LLM summary abstraction second
- **do not build this as a fake medical device**

## Build priorities

1. WhatsApp webhook ingestion
2. Guided daily check-in flow
3. Medication tracking with special support for Mounjaro injections and side effects
4. D1-backed longitudinal storage
5. Dashboard with charts and note review
6. Explainable rule-based flags
7. Monthly PDF export
8. Hardening and tests

## Required technical preferences

- TypeScript
- Cloudflare Workers for backend/API/webhooks
- Cloudflare Pages for dashboard
- D1 for structured data
- R2 for artifacts
- Queues for async work
- Hono is acceptable
- React for UI
- migration-driven schema
- modular architecture

## Important implementation rules

- Follow the requirement IDs exactly where practical
- Preserve traceability by including requirement IDs in code comments, PR-style task notes, or commit grouping
- Prefer deterministic analytics over opaque AI behavior
- LLM-generated summaries, if implemented, must be optional and clearly labeled
- Do not expose secrets client-side
- Keep PHI out of logs where possible
- Protect the dashboard with a strong auth approach appropriate for a single-user private MVP
- Do not create clinician accounts in MVP
- Exports are the clinician handoff mechanism

## What I want you to output first

1. proposed repo/file tree
2. implementation plan by milestone
3. schema design
4. API route list
5. WhatsApp flow design
6. any contradictions or gaps you detect in the documents
7. then begin implementation

## Definition of done for first working release

A working release is complete when I can:
- receive a WhatsApp prompt
- complete a daily check-in
- log a Mounjaro injection
- review my data in the dashboard
- see explainable trend flags
- export a monthly summary PDF

---
