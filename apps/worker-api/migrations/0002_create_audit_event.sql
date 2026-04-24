-- Migration 0002: Add composite index on audit_event for efficient querying
-- Requirement: NFR-SEC-008 (audit records stored in D1 and queryable via API)
-- Design: Section 5.13 — audit_event table
--
-- The audit_event table was created in 0001_create_core_tables.sql.
-- This migration adds a composite index on (user_id, created_at) for
-- efficient querying of audit events by user and date range.

CREATE INDEX IF NOT EXISTS idx_audit_event_user_created
  ON audit_event(user_id, created_at);
