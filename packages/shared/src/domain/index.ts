/**
 * Domain types for the Symptom Tracker.
 *
 * These types mirror the D1 schema defined in the design document (sections 5.1–5.13).
 * All timestamps are ISO 8601 UTC strings. Local dates are YYYY-MM-DD in the user's timezone.
 */

// --- Core entities ---

export interface User {
  id: string;
  display_name: string;
  timezone: string; // IANA, e.g. "America/New_York"
  created_at: string;
  updated_at: string;
}

export interface WhatsAppBinding {
  id: string;
  user_id: string;
  phone_number: string;
  verified_at: string;
  active: number; // 0 | 1
}

export type CheckinStatus = 'complete' | 'partial' | 'abandoned';

export interface DailyCheckin {
  id: string;
  user_id: string;
  checkin_date: string; // YYYY-MM-DD local
  status: CheckinStatus;
  source: string;
  is_retroactive: number; // 0 | 1
  created_at: string;
  updated_at: string;
}

export interface SymptomObservation {
  id: string;
  daily_checkin_id: string;
  variable_code: string; // e.g. "DAT-001"
  value_numeric: number | null;
  value_text: string | null;
  scale_min: number | null;
  scale_max: number | null;
  skipped: number; // 0 | 1
  entered_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  daily_checkin_id: string | null;
  body: string;
  tags: string; // JSON array string, e.g. '["meds","conflict"]'
  source: string;
  created_at: string;
}

// --- Medication ---

export type MedicationRoute = 'oral' | 'injection';

export interface MedicationDefinition {
  id: string;
  code: string;
  display_name: string;
  route: MedicationRoute;
  default_dose_value: number | null;
  default_dose_unit: string | null;
  active: number; // 0 | 1
  created_at: string;
}

export type MedicationEventType = 'taken' | 'missed' | 'injected' | 'skipped';

export interface MedicationEvent {
  id: string;
  user_id: string;
  medication_definition_id: string;
  event_type: MedicationEventType;
  dose_value: number | null;
  dose_unit: string | null;
  injection_site: string | null;
  event_at: string;
  event_date: string; // YYYY-MM-DD local
  note_id: string | null;
  created_at: string;
}

export interface SideEffectObservation {
  id: string;
  user_id: string;
  linked_medication_event_id: string | null;
  variable_code: string; // e.g. "DAT-024"
  severity: number; // 0–5
  observed_date: string; // YYYY-MM-DD local
  observed_at: string;
  note_id: string | null;
}

// --- Behavioral & instruments ---

export interface BehavioralEvent {
  id: string;
  user_id: string;
  event_date: string;
  tag: string;
  severity: number | null;
  description: string | null;
  related_checkin_id: string | null;
  created_at: string;
}

export interface InstrumentResponse {
  id: string;
  user_id: string;
  instrument_name: string;
  instrument_version: string;
  response_date: string;
  raw_responses: string; // JSON
  calculated_score: number | null;
  created_at: string;
}

// --- Analytics & reporting ---

export type FlagSeverity = 'weak' | 'moderate' | 'strong';

export interface AnalyticFlag {
  id: string;
  user_id: string;
  flag_code: string; // e.g. "FLG-HYPO-001"
  started_on: string;
  ended_on: string | null;
  severity: FlagSeverity;
  explanation: string; // JSON
  dismissed_at: string | null;
  created_at: string;
}

export type ReportType = 'weekly' | 'monthly' | 'custom';
export type ReportGenerator = 'deterministic' | 'llm';

export interface SummaryReport {
  id: string;
  user_id: string;
  report_type: ReportType;
  period_start: string;
  period_end: string;
  r2_pdf_key: string | null;
  r2_csv_key: string | null;
  generated_at: string;
  generator: ReportGenerator;
}

// --- Audit ---

export type AuditAction =
  | 'login'
  | 'export'
  | 'config_change'
  | 'delete'
  | 'summary_generate'
  | 'flag_dismiss';

export interface AuditEvent {
  id: string;
  user_id: string | null;
  action: AuditAction;
  detail: string | null; // JSON, no PHI
  ip_address: string | null;
  created_at: string;
}
