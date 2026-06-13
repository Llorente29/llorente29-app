// src/modules/appcc/types.ts
// Tipos TypeScript del módulo APPCC.
// Reflejan el esquema SQL de Supabase.

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
  // Momento de asignación del control (motor de asignación v2):
  //   opening | closing | fixed_time | any
  assignment_moment: 'opening' | 'closing' | 'fixed_time' | 'any'
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
// INCIDENCIAS — WORKFLOW CAPA COMPLETO
// ============================================================

/**
 * Estados del workflow CAPA (Corrective and Preventive Action).
 * Inspirado en SafetyCulture / Intelex / EHS Insight.
 *
 * Flujo típico:
 *   open → assigned → investigating → corrected → verified → closed
 *
 * Atajos:
 *   - Cualquier estado → rejected (si se considera no aplicable / duplicada)
 *
 * Compatibilidad: 'in_progress' y 'resolved' (legacy) se mapean a
 * 'investigating' y 'corrected' respectivamente en el frontend.
 */
export type AppccIncidentStatus =
  | 'open'           // recién detectada, sin asignar
  | 'assigned'       // asignada a un responsable
  | 'investigating'  // en investigación (root cause)
  | 'corrected'      // acción correctiva aplicada, pendiente verificación
  | 'verified'       // supervisor verificó efectividad
  | 'closed'         // cerrada formalmente (firma)
  | 'rejected'       // descartada (no aplicable, duplicada, falso positivo)

export type AppccRootCauseMethod = '5whys' | 'fishbone' | 'direct' | 'other'

export interface AppccIncident {
  id: string
  account_id: string
  location_id: string
  execution_id: string | null
  response_id: string | null

  title: string
  description: string | null
  severity: AppccSeverity
  category: string | null
  status: AppccIncidentStatus
  source: 'auto' | 'manual'

  // Asignación + SLA
  assigned_to: string | null
  assigned_at: string | null
  due_at: string | null            // fecha límite calculada según severidad
  sla_hours: number | null
  sla_due_at: string | null        // legacy, equivale a due_at

  // Escalado
  escalated: boolean
  escalated_at: string | null
  escalated_to: string | null

  // Investigación (root cause)
  root_cause: string | null
  root_cause_method: AppccRootCauseMethod | null
  root_cause_data: Record<string, unknown> | null  // p.ej. {whys: [...]}

  // Acción correctiva
  corrective_action: string | null
  corrective_action_at: string | null
  corrective_action_by: string | null

  // Acción preventiva (opcional)
  preventive_action: string | null
  preventive_action_at: string | null
  preventive_action_by: string | null

  // Verificación
  verified_at: string | null
  verified_by: string | null
  verification_notes: string | null
  verification_effective: boolean | null

  // Cierre
  closed_at: string | null
  closed_by: string | null
  closure_signature: string | null

  // Legacy (resolved_at == corrected_at)
  resolved_at: string | null
  resolved_by: string | null

  created_at: string
  updated_at: string
  created_by: string | null
}

/**
 * Evento del timeline visual de una incidencia.
 * Cada cambio de estado, acción registrada o foto añadida deja huella aquí.
 */
export type AppccIncidentEventType =
  | 'created'
  | 'assigned'
  | 'status_changed'
  | 'note_added'
  | 'photo_added'
  | 'root_cause_set'
  | 'corrective_applied'
  | 'preventive_applied'
  | 'verified'
  | 'closed'
  | 'reopened'
  | 'rejected'
  | 'escalated'
  | 'sla_extended'

export interface AppccIncidentEvent {
  id: string
  incident_id: string
  event_type: AppccIncidentEventType
  event_data: Record<string, unknown> | null
  description: string | null
  actor_id: string | null
  actor_name: string | null
  created_at: string
}

/**
 * Foto adjunta a una incidencia.
 *
 * ⚠️ ALINEADO CON BBDD (mayo 2026 — refactor schema vs código):
 * - photo_kind   (antes evidence_type)
 * - uploaded_at  (antes taken_at)
 * - uploaded_by  (antes taken_by)
 *
 * Las propiedades file_name, file_size_bytes, mime_type, action_id existen
 * en BBDD pero pueden ser null si la foto se subió sin esos metadatos.
 */
export interface AppccIncidentPhoto {
  id: string
  incident_id: string
  storage_path: string
  caption: string | null
  /** Cuándo se subió la foto */
  uploaded_at: string
  /** Quién la subió (employee_id), null si fue un admin */
  uploaded_by: string | null
  /** Tipo de evidencia: del problema, de la acción correctiva o de verificación */
  photo_kind: 'problem' | 'corrective' | 'verification' | null
  /** Acción legacy vinculada (si la foto se adjuntó a una acción legacy) */
  action_id: string | null
  /** Metadatos del archivo (pueden ser null si no se capturaron al subir) */
  file_name: string | null
  file_size_bytes: number | null
  mime_type: string | null
}

// ============================================================
// NOTIFICACIONES IN-APP
// ============================================================

export type AppccNotificationSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface AppccNotification {
  id: string
  account_id: string
  user_id: string
  type: string
  title: string
  body: string | null
  link_type: string | null
  link_id: string | null
  severity: AppccNotificationSeverity
  read_at: string | null
  email_sent: boolean
  email_sent_at: string | null
  created_at: string
}

// ============================================================
// ONBOARDING
// ============================================================

export interface AppccOnboardingDraft {
  locationId: string
  openingTime: string
  closingTime: string
  selectedTemplateIds: Set<string>
  scheduleTimes: Map<string, string | null>
}

export type AppccDayPeriod = 'opening' | 'service' | 'closing' | 'anytime'

export interface AppccEssentialPreset {
  templateCode: string
  dayPeriod: AppccDayPeriod
  timeOffsetMinutes: number | null
}

// ============================================================
// HELPERS UI (severidad → SLA por defecto, colores, etc.)
// ============================================================

/** Horas de SLA por severidad (estándar SafetyCulture/HACCP) */
export const SLA_HOURS_BY_SEVERITY: Record<AppccSeverity, number> = {
  critical: 2,
  high: 8,
  medium: 24,
  low: 72,
}

/** Etiqueta legible de severidad */
export const SEVERITY_LABEL: Record<AppccSeverity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
}

/** Etiqueta legible de status workflow CAPA */
export const STATUS_LABEL: Record<AppccIncidentStatus, string> = {
  open: 'Abierta',
  assigned: 'Asignada',
  investigating: 'Investigando',
  corrected: 'Corregida',
  verified: 'Verificada',
  closed: 'Cerrada',
  rejected: 'Descartada',
}

/** Estados considerados "abiertos" (requieren acción) */
export const OPEN_STATUSES: AppccIncidentStatus[] = [
  'open',
  'assigned',
  'investigating',
  'corrected', // pendiente verificación
]

/** Estados considerados "cerrados" (no requieren acción) */
export const CLOSED_STATUSES: AppccIncidentStatus[] = [
  'verified',
  'closed',
  'rejected',
]
