// src/services/breakPolicyService.ts
// F1.5/F4.4 — política de descansos por cuenta, anulable por local
// (break_policy). Se usa aquí solo para leer min_rest_between_shifts_minutes
// ("Ahora mismo" avisa si alguien entra sin haber descansado lo mínimo).

import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

const DEFAULT_MIN_REST_MINUTES = 720 // 12h, mismo default que la columna en BBDD

/**
 * Minutos mínimos de descanso entre jornadas, efectivos para un local:
 * fila del local si existe (anula), si no la fila general de la cuenta
 * (location_id null), si no hay ninguna el default legal (12h).
 */
export async function fetchMinRestMinutes(accountId: string, locationId: string): Promise<number> {
  const { data, error } = await db()
    .from('break_policy')
    .select('location_id, min_rest_between_shifts_minutes')
    .eq('account_id', accountId)
    .or(`location_id.eq.${locationId},location_id.is.null`)
  if (error || !data || data.length === 0) return DEFAULT_MIN_REST_MINUTES
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = data as any[]
  const specific = rows.find(r => r.location_id === locationId)
  const general = rows.find(r => r.location_id === null)
  const row = specific || general
  return row?.min_rest_between_shifts_minutes ?? DEFAULT_MIN_REST_MINUTES
}
