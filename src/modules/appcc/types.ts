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

export interface AppccScheduleResponsible {
  id: string
  schedule_id: string
  user_id: string
  role: 'primary' | 'backup'
  created_at: string
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

// ============================================================
// ONBOARDING (wizard de configuración inicial)
// ============================================================

/**
 * Borrador del wizard de onboarding APPCC para un local.
 * Vive solo en el state del componente OnboardingPage, no se persiste
 * hasta que el admin pulsa "Guardar configuración".
 */
export interface AppccOnboardingDraft {
  locationId: string
  /** Horario habitual del local en formato 'HH:MM' (24h) */
  openingTime: string
  closingTime: string
  /** Plantillas seleccionadas para activar como schedules diarios */
  selectedTemplateIds: Set<string>
  /**
   * Hora deseada por plantilla seleccionada.
   * - Si un valor es null o no está, no se programa hora específica.
   * - Por defecto se rellena a partir de openingTime/closingTime según el momento sugerido.
   */
  scheduleTimes: Map<string, string | null>
}

/** Momento sugerido del día para una plantilla, usado por el wizard
 *  para sugerir una hora por defecto a partir de apertura/cierre. */
export type AppccDayPeriod = 'opening' | 'service' | 'closing' | 'anytime'

/**
 * Configuración por defecto de las 8 plantillas esenciales que la factory
 * usa para preseleccionar y sugerir horas en el wizard.
 * `templateCode` debe coincidir con AppccTemplate.code de la BBDD.
 */
export interface AppccEssentialPreset {
  templateCode: string
  dayPeriod: AppccDayPeriod
  /** Offset en minutos respecto a apertura (positivo) o cierre (negativo).
   *  Solo se usa cuando dayPeriod != 'anytime' para sugerir hora inicial. */
  timeOffsetMinutes: number | null
}