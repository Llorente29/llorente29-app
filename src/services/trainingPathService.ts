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
