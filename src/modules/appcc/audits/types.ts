// src/modules/appcc/audits/types.ts
// Tipos del subsistema de auditorías APPCC.

export type AuditRecurrence = 'monthly' | 'quarterly' | 'yearly' | 'on_demand'

export type AuditStatus =
  | 'scheduled'    // programada, aún no empezada
  | 'in_progress'  // en curso
  | 'completed'    // finalizada (con scoring)
  | 'overdue'      // vencida sin completar
  | 'cancelled'    // cancelada

export type AuditScoringType = 'binary' | 'scale_0_5' | 'na_allowed'

export type AuditItemSeverity = 'low' | 'medium' | 'high' | 'critical'

// ============================================================
// PLANTILLAS
// ============================================================

export interface AuditTemplate {
  id: string
  account_id: string
  code: string
  name: string
  description: string | null
  is_seed: boolean
  is_active: boolean
  recurrence: AuditRecurrence
  pass_score: number  // 0-100
  created_at: string
  updated_at: string
}

export interface AuditSection {
  id: string
  template_id: string
  code: string
  name: string
  description: string | null
  display_order: number
  weight: number  // 1-10
}

export interface AuditItem {
  id: string
  section_id: string
  code: string
  question: string
  help_text: string | null
  display_order: number
  scoring_type: AuditScoringType
  weight: number  // 1-10
  creates_incident_on_fail: boolean
  incident_severity: AuditItemSeverity | null
}

// Estructura agregada para la UI
export interface AuditTemplateWithItems extends AuditTemplate {
  sections: (AuditSection & {
    items: AuditItem[]
  })[]
}

// ============================================================
// EJECUCIÓN
// ============================================================

export interface Audit {
  id: string
  account_id: string
  location_id: string
  template_id: string
  scheduled_date: string  // YYYY-MM-DD
  status: AuditStatus
  started_at: string | null
  started_by: string | null
  completed_at: string | null
  completed_by: string | null
  /** Auditor responsable (puede asignarse al crear o setearse al ejecutar) */
  auditor_id: string | null
  /** Snapshot del nombre del auditor (por si el empleado se borra) */
  auditor_name: string | null
  final_score: number | null
  passed: boolean | null
  notes: string | null
  signature: string | null
  created_at: string
  updated_at: string
}

export interface AuditResponse {
  id: string
  audit_id: string
  item_id: string
  /** Valor según scoring_type:
   *   binary    : 'yes' | 'no' | 'na'
   *   scale_0_5 : '0' | '1' | '2' | '3' | '4' | '5' | 'na'
   *   na_allowed: 'yes' | 'no' | 'na'
   */
  value: string | null
  notes: string | null
  incident_id: string | null
  answered_at: string
  answered_by: string | null
}

export interface AuditResponsePhoto {
  id: string
  response_id: string
  storage_path: string
  caption: string | null
  taken_at: string
  taken_by: string | null
}

// ============================================================
// SCORING HELPERS
// ============================================================

/** Convierte un value y scoring_type a una puntuación 0-1 normalizada.
 *  Devuelve null si la respuesta es 'na' (no aplica → no cuenta) */
export function valueToScore(value: string | null, type: AuditScoringType): number | null {
  if (!value || value === 'na') return null
  if (type === 'binary' || type === 'na_allowed') {
    return value === 'yes' ? 1 : 0
  }
  // scale_0_5
  const n = parseInt(value, 10)
  if (isNaN(n)) return null
  return Math.max(0, Math.min(5, n)) / 5
}

/** ¿La respuesta cuenta como "fallo" para generar incidencia? */
export function isFailureResponse(value: string | null, type: AuditScoringType): boolean {
  if (!value || value === 'na') return false
  if (type === 'binary' || type === 'na_allowed') return value === 'no'
  // scale_0_5 considera fallo si <= 2
  const n = parseInt(value, 10)
  return !isNaN(n) && n <= 2
}

// ============================================================
// CONSTANTES UI
// ============================================================

export const RECURRENCE_LABEL: Record<AuditRecurrence, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  yearly: 'Anual',
  on_demand: 'Bajo demanda',
}

export const STATUS_LABEL: Record<AuditStatus, string> = {
  scheduled: 'Programada',
  in_progress: 'En curso',
  completed: 'Completada',
  overdue: 'Vencida',
  cancelled: 'Cancelada',
}
