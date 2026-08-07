// src/services/scheduleProposalService.ts
// F10 — Generador de cuadrantes por solver determinista (propose_schedule).
// Motor verificado en BBDD 07/08 — ver ENCARGO_CODE_F10_generador_cuadrantes.md.
// Convive con el generador heurístico existente (scheduleGenerator.ts): el
// encargado elige, nada se sustituye. No escribe nada — el caller decide si
// vuelca el resultado en schedules.cells (y solo lo hace al guardar).

import { supabase } from '../lib/supabase'
import type { DayOfWeek } from '../types/scheduler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

export interface ScheduleProposalRow {
  dia: string
  dayOfWeek: DayOfWeek
  shiftTemplateId: string
  shiftLabel: string
  employeeId: string
  employeeName: string
  motivo: string
  /** true = el solver tuvo que saltarse la preferencia inferida para cubrir el turno (pintar en ámbar, no en rojo). */
  rompePreferencia: boolean
}

export async function fetchScheduleProposal(
  accountId: string,
  locationId: string,
  weekStart: string
): Promise<ScheduleProposalRow[]> {
  const { data, error } = await db().rpc('propose_schedule', {
    p_account: accountId,
    p_location: locationId,
    p_week_start: weekStart,
  })
  if (error) {
    console.error('[scheduleProposal] propose_schedule:', error)
    throw new Error(error.message || 'No se pudo proponer el cuadrante.')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    dia: r.dia,
    dayOfWeek: Number(r.day_of_week) as DayOfWeek,
    shiftTemplateId: r.shift_template_id,
    shiftLabel: r.shift_label,
    employeeId: r.employee_id,
    employeeName: (r.employee_name || '').trim(),
    motivo: r.motivo || '',
    rompePreferencia: !!r.rompe_preferencia,
  }))
}
