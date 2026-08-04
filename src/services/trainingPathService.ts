// src/services/trainingPathService.ts
// Formación — Onboarding formativo: semáforo del empleado.
// docs/folvy_formacion_onboarding_diseno.md §3.2.
//
// El semáforo NO recalcula si un curso está "vigente" — eso ya lo calcula
// training_compliance_matrix (C2/C4), con el mismo criterio server-side que
// gobierna el PDF de inspección. Reescribirlo aquí sería una tercera
// implementación del mismo hecho ("¿está esto realmente hecho?") con riesgo
// real de divergencia si una se corrige y la otra no. Este servicio solo
// cruza esa matriz con qué cursos son de un itinerario de incorporación
// (training_path_item) y cuáles de esos son bloqueantes.

import { supabase } from '../lib/supabase'
import { getTrainingComplianceMatrix } from './trainingComplianceService'

export interface OnboardingCourseFlag {
  code: string
  title: string
  isBlocking: boolean
}

/** IDs de curso (course_id, no code) que son bloqueantes en algún itinerario
 * de incorporación — para cruzar directo con TrainingGap.courseId (pieza 4). */
export async function listBlockingCourseIds(): Promise<Set<string>> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('training_path_item')
    .select('course_id')
    .eq('is_blocking', true)
  if (error) { console.error('[trainingPathService] listBlockingCourseIds', error); throw error }
  return new Set((data ?? []).map(r => r.course_id))
}

/** Cursos que forman parte de CUALQUIER itinerario de incorporación, con si
 * son bloqueantes (OR entre todos los training_path_item que referencian ese
 * curso — en la práctica cada curso solo aparece en un itinerario). */
export async function listOnboardingCourseFlags(): Promise<OnboardingCourseFlag[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('training_path_item')
    .select('is_blocking, course:course_id(code, title)')
  if (error) { console.error('[trainingPathService] listOnboardingCourseFlags', error); throw error }

  const byCode = new Map<string, OnboardingCourseFlag>()
  for (const row of (data ?? []) as unknown as { is_blocking: boolean; course: { code: string; title: string } | null }[]) {
    if (!row.course) continue
    const existing = byCode.get(row.course.code)
    byCode.set(row.course.code, {
      code: row.course.code,
      title: row.course.title,
      isBlocking: (existing?.isBlocking ?? false) || row.is_blocking,
    })
  }
  return [...byCode.values()]
}

export type EmployeeTrainingStatusColor = 'rojo' | 'amarillo' | 'verde'

export interface EmployeeTrainingStatus {
  status: EmployeeTrainingStatusColor
  /** Títulos de cursos bloqueantes pendientes — si hay alguno, status es 'rojo'. */
  blockingPending: string[]
  /** Títulos de cursos de itinerario (no bloqueantes) pendientes. */
  otherPending: string[]
}

/**
 * Semáforo de un empleado: 🔴 falta un bloqueante (no debería manipular
 * alimentos) · 🟡 bloqueantes ok, quedan cursos de itinerario · 🟢 al día.
 *
 * "Pendiente" = el estado de training_compliance_matrix para ese curso no es
 * 'vigente' (ni 'no_aplica' — un curso que no aplica al empleado no cuenta
 * como pendiente). Nota declarada: si un curso del itinerario todavía está
 * en status='draft' (p.ej. un curso recién sembrado sin publicar), la matriz
 * no lo incluye y este semáforo no lo puede ver — igual que el resto del
 * módulo, que ya exige status='published' para contar.
 */
export async function getEmployeeTrainingStatus(accountId: string, employeeId: string): Promise<EmployeeTrainingStatus> {
  const [matrix, flags] = await Promise.all([
    getTrainingComplianceMatrix(accountId),
    listOnboardingCourseFlags(),
  ])
  const flagByCode = new Map(flags.map(f => [f.code, f]))
  const row = matrix.find(r => r.employeeId === employeeId)

  const blockingPending: string[] = []
  const otherPending: string[] = []

  if (row) {
    for (const [code, cell] of Object.entries(row.courses)) {
      const flag = flagByCode.get(code)
      if (!flag) continue // no es un curso de ningún itinerario de incorporación
      if (cell.state === 'vigente' || cell.state === 'no_aplica') continue
      if (flag.isBlocking) blockingPending.push(flag.title)
      else otherPending.push(flag.title)
    }
  }

  const status: EmployeeTrainingStatusColor =
    blockingPending.length > 0 ? 'rojo' : otherPending.length > 0 ? 'amarillo' : 'verde'

  return { status, blockingPending, otherPending }
}

// ============================================================
// Itinerario por fases — liberación manual (individual y por grupo).
// docs/folvy_formacion_itinerario_fases_rediseno.md §2.3.
// La liberación automática al completar fase + el cron de desfase temporal
// NO están construidos en esta entrega (declarado) -- solo la vía manual.
// ============================================================

export type TrainingPhaseName = 'dia_1' | 'dias_30' | 'dias_90'
export type TrainingPhaseState = 'pendiente' | 'liberada' | 'completada'

export interface EmployeePhaseProgress {
  id: string
  pathId: string
  pathName: string
  phase: TrainingPhaseName
  state: TrainingPhaseState
  releasedAt: string | null
  dueAt: string | null
}

const PHASE_ORDER: Record<TrainingPhaseName, number> = { dia_1: 0, dias_30: 1, dias_90: 2 }

/** Progreso por fase de un empleado, en todos los itinerarios que le apliquen. Requiere ser admin/manager de su cuenta (RLS). */
export async function listEmployeePhaseProgress(employeeId: string): Promise<EmployeePhaseProgress[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('training_path_progress')
    .select('id, path_id, phase, state, released_at, due_at, path:path_id(name)')
    .eq('employee_id', employeeId)
  if (error) { console.error('[trainingPathService] listEmployeePhaseProgress', error); throw error }
  return ((data ?? []) as unknown as { id: string; path_id: string; phase: TrainingPhaseName; state: TrainingPhaseState; released_at: string | null; due_at: string | null; path: { name: string } | null }[])
    .map(r => ({
      id: r.id,
      pathId: r.path_id,
      pathName: r.path?.name ?? '—',
      phase: r.phase,
      state: r.state,
      releasedAt: r.released_at,
      dueAt: r.due_at,
    }))
    .sort((a, b) => a.pathName.localeCompare(b.pathName) || PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase])
}

export interface ReleaseNextPhaseResult { phase: TrainingPhaseName; assignmentsCreated: number }

/** Libera la siguiente fase 'pendiente' de un empleado en un itinerario concreto. Falla si no queda ninguna. */
export async function releaseNextPhase(employeeId: string, pathId: string): Promise<ReleaseNextPhaseResult> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase.rpc('release_next_phase', { p_employee_id: employeeId, p_path_id: pathId })
  if (error) { console.error('[trainingPathService] releaseNextPhase', error); throw error }
  return data as unknown as ReleaseNextPhaseResult
}

export interface ReleaseNextPhaseForGroupResult { released: number; skipped: number }

/** La "campaña": libera la siguiente fase pendiente a todo un local y/o puesto. Exige al menos uno de los dos filtros. */
export async function releaseNextPhaseForGroup(
  pathId: string,
  filters: { locationId?: string; role?: string },
): Promise<ReleaseNextPhaseForGroupResult> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase.rpc('release_next_phase_for_group', {
    p_path_id: pathId,
    p_location_id: filters.locationId ?? null,
    p_role: filters.role ?? null,
  })
  if (error) { console.error('[trainingPathService] releaseNextPhaseForGroup', error); throw error }
  return data as unknown as ReleaseNextPhaseForGroupResult
}
