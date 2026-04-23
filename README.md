# Symptom Tracker Blueprint (Cloudflare + WhatsApp)

This bundle is a build-ready planning package for a **personal symptom-tracking system** with:
- **WhatsApp** as the primary input interface
- **Cloudflare** as the hosting/runtime platform
- a secure **web dashboard**
- structured outputs for **you, your primary care doctor, your therapist, and your psychiatrist**

## What is in this bundle

1. `01_requirements.md` — requirements document with IDs and acceptance criteria  
2. `02_design.md` — system design and architecture  
3. `03_task_list.md` — implementation task list with dependencies  
4. `04_traceability_matrix.md` — requirement → design → task mapping  
5. `05_codex_handoff_prompt.md` — optional prompt to drop into Codex

## Straight answer before you build

For **v1**, treat this as a **personal-use tracking system with clinician-facing exports**, not a live multi-clinician portal.

Reason:
- the app will process health information
- Cloudflare states BAAs are only available to enterprise customers
- WhatsApp is fine as a user interface channel for a personal workflow, but it is the wrong thing to assume is automatically clinician-grade or HIPAA-ready for a shared care platform

So the practical MVP is:

- **You** interact through WhatsApp
- **You** view the private dashboard
- **You** export PDF/CSV summaries and share them with clinicians manually

That gets you something useful fast, without pretending it is a regulated clinical system on day one.

## Core product stance

The app should be optimized for:
- very low-friction daily use
- structured longitudinal data
- good freeform notes
- useful trend detection
- descriptive analysis, not diagnosis
- clinician-readable summaries

## Symptom strategy

The MVP should track the things most likely to matter across:
- **bipolar/hypomanic instability**
- **ADHD functioning**
- **behavioral/interpersonal dysregulation**
- **medication adherence/tolerability**
- **Mounjaro initiation and side effects**

The highest-value data points are not exotic. They are:
- sleep
- mood
- energy
- irritability/anger
- focus
- racing thoughts
- impulsivity/risk drive
- interpersonal conflict
- medication adherence
- appetite and weight trend
- GI side effects after injection
- freeform notes

## Recommended build order

1. ingest WhatsApp messages
2. implement daily check-in flow
3. store structured data in D1
4. build dashboard
5. add summary/report generation
6. add trend detection and clinician exports
7. harden auth/privacy/ops
