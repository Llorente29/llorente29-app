// src/services/availabilityInferenceService.ts
// F10 — Disponibilidad inferida del historial real (infer_employee_availability,
// apply_inferred_availability). Motores verificados en BBDD 07/08 — ver
// ENCARGO_CODE_F10_generador_cuadrantes.md. No escribe nada por sí sola:
// infer_employee_availability PROPONE, apply_inferred_availability es la
// única que escribe (y solo lo de confianza alta, sin pisar lo manual salvo
// overwrite explícito — lo hace la propia RPC, no este servicio).

import { supabase } from '../lib/supabase'
import type { DayOfWeek, ShiftPeriod } from '../types/scheduler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

export type Confianza = 'alta' | 'media' | 'baja'

export interface InferredAvailabilityRow {
  employeeId: string
  employeeName: string
  dayOfWeek: DayOfWeek
  shiftPeriod: ShiftPeriod
  vecesAsignado: number
  semanasObservadas: number
  ratio: number
  sugerencia: boolean
  confianza: Confianza
  motivo: string
}

export async function fetchInferredAvailability(
  accountId: string,
  locationId: string | null
): Promise<InferredAvailabilityRow[]> {
  const { data, error } = await db().rpc('infer_employee_availability', {
    p_account: accountId,
    p_location: locationId,
  })
  if (error) {
    console.error('[availabilityInference] infer_employee_availability:', error)
    return []
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    employeeId: r.employee_id,
    employeeName: (r.employee_name || '').trim(),
    dayOfWeek: Number(r.day_of_week) as DayOfWeek,
    shiftPeriod: r.shift_period as ShiftPeriod,
    vecesAsignado: Number(r.veces_asignado) || 0,
    semanasObservadas: Number(r.semanas_observadas) || 0,
    ratio: Number(r.ratio) || 0,
    sugerencia: !!r.sugerencia,
    confianza: r.confianza as Confianza,
    motivo: r.motivo || '',
  }))
}

/** Devuelve cuántas filas escribió (solo confianza alta; no pisa lo manual salvo overwrite). */
export async function applyInferredAvailability(
  accountId: string,
  locationId: string | null,
  overwrite: boolean
): Promise<number> {
  const { data, error } = await db().rpc('apply_inferred_availability', {
    p_account: accountId,
    p_location: locationId,
    p_overwrite: overwrite,
  })
  if (error) {
    console.error('[availabilityInference] apply_inferred_availability:', error)
    throw new Error(error.message || 'No se pudo aplicar la disponibilidad inferida.')
  }
  return Number(data) || 0
}
