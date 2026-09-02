// El saldo de horas del periodo en curso, para la tarjeta del Inicio.
//
// Cuelga de `getAllEmployeesBalanceStates`, el servicio que ya usa la pantalla
// de Bolsa de horas: un solo cálculo del saldo, con su día de cierre efectivo.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import {
  getAllEmployeesBalanceStates, getEffectiveCloseDay,
} from '@/services/hoursBalanceService'
import type { Employee } from '@/types'
import type { LocationBalanceConfig } from '@/services/hoursBalanceService'

/**
 * El día de cierre del local. Mismos defectos que `BolsaHorasPage`: 25, y
 * sincronizado con la gestoría.
 *
 * OJO CON `gestoriaDay`: **`gestoria_send_day` NO EXISTE en `locations`**
 * —comprobado el 02/09 en `information_schema`; solo están
 * `hours_balance_close_day` y `hours_balance_sync_with_gestoria`—. Pedirla en
 * el select haría fallar la consulta ENTERA y caer al defecto sin avisar, que
 * es como se acaba con dos pantallas dando saldos distintos de las mismas
 * horas. Así que no se pide, y `gestoriaDay` toma el propio día de cierre:
 * mientras no exista esa columna, «sincronizar con la gestoría» no puede
 * significar otro día.
 *
 * (La pantalla lee `(location as any).gestoriaSendDay`, que por lo mismo es
 * siempre `undefined` y cae a 25. Mismo agujero, y de ahí sale el aviso.)
 */
async function configDeCierre(locationId: string | null): Promise<LocationBalanceConfig> {
  const defecto: LocationBalanceConfig = { closeDay: 25, syncWithGestoria: true, gestoriaDay: 25 }
  if (!locationId || !isSupabaseEnabled || !supabase) return defecto
  const { data, error } = await supabase.from('locations')
    .select('hours_balance_close_day, hours_balance_sync_with_gestoria')
    .eq('id', locationId).maybeSingle()
  if (error) {
    console.error('[bolsaHoras] configDeCierre', error)
    return defecto
  }
  const r = data as Record<string, unknown> | null
  if (!r) return defecto
  const dia = Number(r.hours_balance_close_day ?? 25)
  return {
    closeDay: dia,
    syncWithGestoria: r.hours_balance_sync_with_gestoria !== false,
    gestoriaDay: dia,
  }
}

export interface ResumenBolsa {
  saldoTotal: number
  etiquetaPeriodo: string
  empleados: number
  /** Semanas del periodo sin cuadrante publicado, sumadas sin repetir. */
  semanasSinPublicar: number
  masDesviados: { nombre: string; delta: number }[]
}

export async function leeBolsaDeHoras(
  accountId: string, locationId: string | null,
): Promise<ResumenBolsa> {
  if (!isSupabaseEnabled || !supabase) {
    return { saldoTotal: 0, etiquetaPeriodo: '', empleados: 0, semanasSinPublicar: 0, masDesviados: [] }
  }
  let q = supabase.from('employees').select('*').eq('account_id', accountId).eq('active', true)
  if (locationId) q = q.eq('location_id', locationId)
  const { data, error } = await q
  if (error) throw new Error(`No se ha podido leer la plantilla: ${error.message}`)

  const empleados = (data ?? []) as unknown as Employee[]
  if (empleados.length === 0) {
    return { saldoTotal: 0, etiquetaPeriodo: '', empleados: 0, semanasSinPublicar: 0, masDesviados: [] }
  }

  // El día de cierre sale de la config del LOCAL, igual que en la pantalla de
  // Bolsa de horas: si se sincroniza con la gestoría manda el día de la
  // gestoría. Un día de cierre distinto entre las dos pantallas daría dos
  // saldos distintos de las mismas horas.
  const closeDay = getEffectiveCloseDay(await configDeCierre(locationId ?? empleados[0].locationId ?? null))
  const estados = await getAllEmployeesBalanceStates(empleados, closeDay)

  // Las semanas sin publicar se cuentan SIN REPETIR: la misma semana sin
  // cuadrante aparece en el estado de cada empleado del local, y sumarlas daría
  // «12 semanas sin publicar» cuando son tres semanas y cuatro personas.
  const semanas = new Set<string>()
  for (const e of estados) for (const w of e.currentPeriod.weeksWithoutSchedule) semanas.add(w)

  const conDelta = estados.map(e => ({ nombre: e.employeeName, delta: e.currentPeriod.delta }))
  return {
    saldoTotal: conDelta.reduce((s, e) => s + e.delta, 0),
    etiquetaPeriodo: estados[0]?.currentPeriod.periodLabel ?? '',
    empleados: estados.length,
    semanasSinPublicar: semanas.size,
    // Los que más se desvían, en cualquier dirección: deber horas y que te las
    // deban son dos problemas y los dos se arreglan igual de tarde.
    masDesviados: conDelta
      .filter(e => Math.abs(e.delta) >= 1)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
  }
}
