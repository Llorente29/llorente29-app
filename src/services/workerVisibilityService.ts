// src/services/workerVisibilityService.ts
// F8 — Portal del trabajador: visibilidad de datos sensibles. Regla dura: el
// portal NO muestra bolsa de horas / horas nocturnas / coste laboral / avisos
// de convenio sin su flag. UNA sola llamada al cargar (worker_portal_visibility),
// respetada en todo el portal — no repartir la comprobación por pantallas.

import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

export interface WorkerPortalVisibility {
  showHourBank: boolean
  showNightHours: boolean
  showLaborCost: boolean
  showCompliance: boolean
}

// Todo invisible por defecto si algo falla — fail-closed, coherente con la
// regla dura (nunca enseñar de más).
const HIDDEN_ALL: WorkerPortalVisibility = {
  showHourBank: false, showNightHours: false, showLaborCost: false, showCompliance: false,
}

export async function fetchWorkerPortalVisibility(employeeId: string): Promise<WorkerPortalVisibility> {
  if (!supabase) return HIDDEN_ALL
  const { data, error } = await db().rpc('worker_portal_visibility', { p_employee_id: employeeId })
  if (error || !data || data.length === 0) {
    if (error) console.error('[workerVisibility] worker_portal_visibility:', error)
    return HIDDEN_ALL
  }
  const r = data[0]
  return {
    showHourBank: !!r.show_hour_bank,
    showNightHours: !!r.show_night_hours,
    showLaborCost: !!r.show_labor_cost,
    showCompliance: !!r.show_compliance,
  }
}
