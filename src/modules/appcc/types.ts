// src/modules/appcc/types.ts
// Tipos TypeScript del módulo APPCC.
// Reflejan el esquema SQL de Supabase (Sprint 2 SQL).

// ============================================================
// CATÁLOGO
// ============================================================

export type AppccFieldType =
  | 'numeric'
  | 'boolean'
  | 'select'
  | 'text'
  | 'date'
  | 'photo'
  | 'signature'

export type AppccSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface AppccPlan {
  id: string
  code: string
  name: string
  description: string | null
  icon: string | null
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AppccTemplate {
  id: string
  plan_id: string
  account_id: string | null
  code: string
  name: string
  description: string | null
  is_seed: boolean
  is_active: boolean
  requires_feature: string | null
  estimated_minutes: number | null
  created_at: string
  updated_at: string
}

export interface AppccTemplateItem {
  id: string
  template_id: string
  code: string
  label: string
  help_text: string | null
  field_type: AppccFieldType
  is_required: boolean
  display_order: number
  numeric_min: number | null
  numeric_max: number | null
  numeric_unit: string | null
  expected_boolean: boolean | null
  creates_incident_on_fail: boolean
  incident_severity: AppccSeverity | null
}

export interface AppccTemplateItemOption {
  id: string
  item_id: string
  code: string
  label: string
  is_failure: boolean
  display_order: number
}

// Estructura agregada cómoda para el frontend
export interface AppccTemplateWithItems extends AppccTemplate {
  plan: AppccPlan
  items: (AppccTemplateItem & { options?: AppccTemplateItemOption[] })[]
}

// ============================================================
// PROGRAMACIÓN
// ============================================================

export type AppccRecurrenceType =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'on_event'
  | 'manual'

export interface AppccSchedule {
  id: string
  account_id: string
  location_id: string
  template_id: string
  recurrence_type: AppccRecurrenceType
  recurrence_config: Record<string, unknown>
  scheduled_time: string | null
  valid_from: string
  valid_until: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
}

// ============================================================
// EJECUCIÓN
// ============================================================

export type AppccExecutionStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'overdue'
  | 'skipped'

export interface AppccExecution {
  id: string
  account_id: string
  location_id: string
  template_id: string
  schedule_id: string | null
  scheduled_date: string
  scheduled_time: string | null
  status: AppccExecutionStatus
  assigned_to: string | null
  started_at: string | null
  started_by: string | null
  completed_at: string | null
  completed_by: string | null
  has_failures: boolean
  failure_count: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface AppccExecutionResponse {
  id: string
  execution_id: string
  item_id: string
  numeric_value: number | null
  boolean_value: boolean | null
  text_value: string | null
  date_value: string | null
  selected_option_id: string | null
  is_out_of_range: boolean
  answered_at: string
  answered_by: string | null
}

// ============================================================
// INCIDENCIAS
// ============================================================

export type AppccIncidentStatus =
  | 'open'
  | 'in_progress'
  | 'resolved'
  | 'closed'
  | 'cancelled'

export interface AppccIncident {
  id: string
  account_id: string
  location_id: string
  execution_id: string | null
  response_id: string | null
  title: string
  description: string | null
  severity: AppccSeverity
  status: AppccIncidentStatus
  source: 'auto' | 'manual'
  assigned_to: string | null
  sla_due_at: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}