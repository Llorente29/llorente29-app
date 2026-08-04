// src/services/trainingComplianceService.ts
// Formación C2 — Wrappers TS de las 4 RPCs de informes de cumplimiento
// (supabase/migrations/20260807T1400_formacion_c2_informes.sql). Mismo
// patrón que allergenComplianceService.ts. Consumidas por
// src/modules/appcc/pages/TrainingCompliancePage.tsx y por el KPI de
// prerrequisito del dashboard de Safety.
//
// Si una llamada falla, se lanza el error (nunca `catch(() => [])`): un
// informe de cumplimiento que se calla un fallo de red y pinta "todo
// vigente" no vale ante un inspector.

import { supabase, isSupabaseEnabled } from '../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export type TrainingCellState = 'vigente' | 'caducado' | 'pendiente' | 'en_curso' | 'pendiente_practica' | 'no_aplica'

export interface TrainingCourseCell {
  state: TrainingCellState
  completedAt: string | null
  expiresAt: string | null
  scorePct: number | null
  signed: boolean
}

export interface TrainingComplianceRow {
  employeeId: string
  employeeName: string
  docId: string | null
  role: string | null
  locationName: string
  courses: Record<string, TrainingCourseCell>
}

interface TrainingComplianceMatrixRawRow {
  employee_id: string
  employee_name: string
  doc_id: string | null
  role: string | null
  location_name: string
  courses: Record<string, {
    state: TrainingCellState
    completed_at: string | null
    expires_at: string | null
    score_pct: number | null
    signed: boolean
  }>
}

export async function getTrainingComplianceMatrix(
  accountId: string,
  locationId?: string | null,
  onlyMandatory = false,
): Promise<TrainingComplianceRow[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('training_compliance_matrix', {
    p_account_id: accountId,
    p_location_id: locationId ?? null,
    p_only_mandatory: onlyMandatory,
  })
  if (error) throw new Error(`Error leyendo la matriz de formación: ${error.message}`)
  return ((data ?? []) as unknown as TrainingComplianceMatrixRawRow[]).map((row) => ({
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    docId: row.doc_id,
    role: row.role,
    locationName: row.location_name,
    courses: Object.fromEntries(
      Object.entries(row.courses ?? {}).map(([code, cell]) => [code, {
        state: cell.state,
        completedAt: cell.completed_at,
        expiresAt: cell.expires_at,
        scorePct: cell.score_pct,
        signed: cell.signed,
      }]),
    ),
  }))
}

/**
 * % de plantilla con las obligatorias vigentes — el número que mira el
 * inspector. Función PURA (sin red) para que el KPI de portada del PDF, el
 * de la pantalla y el del dashboard de Safety usen exactamente el mismo
 * cálculo y nunca puedan divergir.
 *
 * Auditoría externa (Pieza B): esto contaba CELDAS empleado×curso, no
 * personas — con 20 empleados y 5 obligatorias podía imprimir "83 de 100
 * trabajadores" en la portada del PDF de inspección, un dato falso en un
 * documento legal. Ahora cuenta personas de verdad: "vigente" = un
 * trabajador con TODAS sus obligatorias aplicables vigentes (ni una
 * pendiente, caducada, en curso o sin verificar la práctica). "applicable"
 * = trabajadores con al menos una obligatoria que les aplique — quien no
 * tiene ninguna (no_aplica en todas) no cuenta ni en el numerador ni en el
 * denominador, igual que antes a nivel de celda.
 *
 * applicable=0 (cuenta sin datos aún) ya no cae en 100%: pct queda en null
 * para que quien lo consuma pinte un estado neutro ("sin datos"), no un
 * 100% verde engañoso (Pieza E.4).
 */
export function computeMandatoryCompliancePct(
  rows: TrainingComplianceRow[],
): { pct: number | null; vigente: number; applicable: number } {
  let vigente = 0
  let applicable = 0
  for (const row of rows) {
    const cells = Object.values(row.courses).filter(c => c.state !== 'no_aplica')
    if (cells.length === 0) continue
    applicable++
    if (cells.every(c => c.state === 'vigente')) vigente++
  }
  const pct = applicable > 0 ? Math.round((vigente / applicable) * 100) : null
  return { pct, vigente, applicable }
}

export type TrainingGapKind = 'nunca_hecho' | 'caducado' | 'caduca_pronto' | 'sin_firmar' | 'en_curso' | 'falta_practica'

export interface TrainingGap {
  employeeId: string
  employeeName: string
  courseId: string
  courseTitle: string
  gapKind: TrainingGapKind
  dueAt: string | null
  daysLeft: number | null
}

export async function getTrainingGaps(accountId: string, daysAhead = 30): Promise<TrainingGap[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('training_gaps', {
    p_account_id: accountId,
    p_days_ahead: daysAhead,
  })
  if (error) throw new Error(`Error leyendo huecos de formación: ${error.message}`)
  return (data ?? []).map((row) => ({
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    courseId: row.course_id,
    courseTitle: row.course_title,
    gapKind: row.gap_kind as TrainingGapKind,
    dueAt: row.due_at,
    daysLeft: row.days_left,
  }))
}

export type TrainingDataHealthKind = 'sin_dni' | 'sin_acceso' | 'curso_sin_asignar' | 'asignacion_sin_fecha'

export interface TrainingDataHealthRow {
  checkKind: TrainingDataHealthKind
  itemCount: number
  sampleNames: string[]
}

export async function getTrainingDataHealth(accountId: string): Promise<TrainingDataHealthRow[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('training_data_health', { p_account_id: accountId })
  if (error) throw new Error(`Error leyendo salud del dato de formación: ${error.message}`)
  return (data ?? []).map((row) => ({
    checkKind: row.check_kind as TrainingDataHealthKind,
    itemCount: row.item_count,
    sampleNames: row.sample_names ?? [],
  }))
}

export interface TrainingCourseSummary {
  courseId: string
  courseCode: string
  courseTitle: string
  legalBasis: string | null
  estimatedMinutes: number | null
  sectionTitles: string[]
  assignedCount: number
  trainedCount: number
  signedCount: number
  compliancePct: number
}

export async function getTrainingCourseSummary(accountId: string): Promise<TrainingCourseSummary[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('training_course_summary', { p_account_id: accountId })
  if (error) throw new Error(`Error leyendo el resumen de cursos: ${error.message}`)
  return (data ?? []).map((row) => ({
    courseId: row.course_id,
    courseCode: row.course_code,
    courseTitle: row.course_title,
    legalBasis: row.legal_basis,
    estimatedMinutes: row.estimated_minutes,
    sectionTitles: row.section_titles ?? [],
    assignedCount: row.assigned_count,
    trainedCount: row.trained_count,
    signedCount: row.signed_count,
    compliancePct: row.compliance_pct,
  }))
}
