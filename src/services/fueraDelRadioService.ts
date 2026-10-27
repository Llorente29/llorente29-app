// src/services/fueraDelRadioService.ts
//
// L1a · PR 1 (27/10/2026). Fuera del radio no se bloquea por defecto: el
// fichaje se guarda, queda marcado y se avisa al encargado. Esto lee los
// fichajes de los últimos días que cayeron fuera del radio de su local. Los ve
// quien ve a esas personas: el administrador, o el encargado de sus locales
// (la RLS de clock_entries).
//
// Con la base de antes de la 1905 la columna within_radius no existe: se dice
// («disponible: false») en vez de enseñar un cero que no sería verdad.
import { supabase, isSupabaseEnabled } from '../lib/supabase'

export const DIAS_FUERA_DEL_RADIO = 7

export interface FichajeFueraDelRadio {
  id: string
  employeeId: string
  locationId: string | null
  tipo: 'entrada' | 'salida' | 'pausa_inicio' | 'pausa_fin'
  /** ISO: la hora del fichaje. */
  hora: string
  distanciaM: number
}

export interface FueraDelRadio {
  /** false: la base todavía no guarda la distancia (antes de la 1905). */
  disponible: boolean
  fichajes: FichajeFueraDelRadio[]
}

export async function leerFueraDelRadio(employeeIds: string[]): Promise<FueraDelRadio> {
  if (!isSupabaseEnabled || !supabase) return { disponible: false, fichajes: [] }
  if (employeeIds.length === 0) return { disponible: true, fichajes: [] }
  const desde = new Date(Date.now() - DIAS_FUERA_DEL_RADIO * 86_400_000).toISOString()
  // within_radius y distance_m son de la 1905 y aún no están en database.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('clock_entries') as any)
    .select('id, employee_id, type, datetime, distance_m, location_id_at_clock')
    .in('employee_id', employeeIds)
    .eq('within_radius', false)
    .eq('voided', false)
    .gte('created_at', desde)
    .order('datetime', { ascending: false })
  if (error) {
    if (error.code === '42703' || /within_radius|distance_m/.test(error.message ?? '')) return { disponible: false, fichajes: [] }
    throw new Error(`No se han podido leer los fichajes fuera del radio: ${error.message}`)
  }
  type Fila = { id: string; employee_id: string; type: FichajeFueraDelRadio['tipo']; datetime: string; distance_m: number | null; location_id_at_clock: string | null }
  return {
    disponible: true,
    fichajes: ((data ?? []) as Fila[]).map(f => ({
      id: f.id,
      employeeId: f.employee_id,
      locationId: f.location_id_at_clock,
      tipo: f.type,
      hora: f.datetime,
      distanciaM: Number(f.distance_m ?? 0),
    })),
  }
}

/** «a 40 m», «a 1,2 km». */
export function metros(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km` : `${m} m`
}
