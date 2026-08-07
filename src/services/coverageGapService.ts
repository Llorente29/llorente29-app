// src/services/coverageGapService.ts
// F7 — Cobertura: huecos y excesos con coste real (schedule_coverage_gap).
// Motor verificado 07/08 (ver ENCARGO_CODE_F7_cobertura_coste.md): coste real
// de nómina (última nómina cargada del empleado / horas trabajadas ese mes),
// no coste estimado del contrato — la ventaja de Folvy sobre 7shifts.

import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

/**
 * Una fila por (fecha, hora) de la semana. gap = assigned_total - required_total:
 * NEGATIVO = falta gente, POSITIVO = sobra, 0 = ajustado.
 */
export interface CoverageGapHour {
  fecha: string
  hora: number
  required: number
  assigned: number
  gap: number
  costHour: number   // € que cuesta esa hora con la gente asignada (nómina real)
  costIsPartial: boolean  // algún asignado sin nómina cargada -> coste infravalorado, no ocultar
}

export async function fetchScheduleCoverageGap(
  accountId: string,
  locationId: string,
  weekStart: string
): Promise<CoverageGapHour[]> {
  const { data, error } = await db().rpc('schedule_coverage_gap', {
    p_account: accountId,
    p_location: locationId,
    p_week_start: weekStart,
  })
  if (error) {
    console.error('[coverageGap] schedule_coverage_gap:', error)
    return []
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    fecha: r.fecha,
    hora: Number(r.hora),
    required: Number(r.required_total) || 0,
    assigned: Number(r.assigned_total) || 0,
    gap: Number(r.gap) || 0,
    costHour: Number(r.assigned_cost_hour) || 0,
    costIsPartial: !!r.cost_is_partial,
  }))
}
