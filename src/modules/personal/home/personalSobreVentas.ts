// src/modules/personal/home/personalSobreVentas.ts
//
// % PERSONAL SOBRE VENTAS. Frente 9, decidido por Julio el 02/09:
// **coste de EMPRESA** (`salary` + `employer_ss_annual`), no el salario bruto.
// Sus palabras: «el bruto es engañar en silencio».
//
// ── LO QUE SE MIDIÓ ANTES DE ESCRIBIR ESTO (02/09) ─────────────────────────
// De los SEIS empleados activos de Foodint, **CERO tienen
// `employer_ss_annual`**. Está a null en toda la plantilla. Y uno —Keilymar—
// tiene `salary` a 0.
//
// Así que hoy el coste de empresa NO SE PUEDE CALCULAR. Y las tres salidas
// posibles eran:
//
//   1. Usar el bruto y ya. Es exactamente lo que Julio prohibió, y encima
//      saldría un porcentaje ~30 % más bajo del real: diría que el negocio va
//      mejor de lo que va, con ese número se decide si se contrata.
//   2. Estimar la seguridad social con un porcentaje típico. Inventar un dato
//      y darle cara de medido.
//   3. NO DAR NÚMERO y decir qué falta.
//
// Esta es la 3. La tarjeta existe, lee la plantilla de verdad, y en cuanto
// alguien rellene la seguridad social empieza a funcionar sola. Mientras tanto
// dice a cuántas personas les falta el dato — que es accionable— en vez de un
// porcentaje que nadie podría auditar.

import { rpcSinTipar } from '@/lib/rpcSinTipar'
import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { diaDelNegocio, lunesDeLaSemana } from '@/lib/fechas'

/** Semanas del año, para pasar de coste anual a coste por hora. */
const SEMANAS_AL_ANO = 52

export interface CosteDePersonal {
  /** null = no se puede calcular. NUNCA un 0 que parezca un dato. */
  porcentaje: number | null
  costeEur: number
  ventasEur: number
  horas: number
  periodo: string
  /** A cuántos les falta salario o seguridad social. */
  sinDato: number
  totalEmpleados: number
  /** Qué falta exactamente, para poder ir a arreglarlo. */
  queFalta: string[]
}

interface FilaTurno { employee_id: string; minutes: number | string }

function sb() {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

/**
 * Coste por hora de una persona, en euros.
 *
 * `salary` y `employer_ss_annual` son ANUALES —22.589,76 € para 40 h/semana es
 * un salario de convenio al año, no al mes—. Se divide entre las horas de
 * contrato del año.
 *
 * Devuelve null si falta cualquiera de los dos: media persona costeada no es
 * media verdad, es un número más bajo que el real.
 */
export function costePorHora(
  salaryAnual: number | null, ssAnual: number | null, horasSemana: number | null,
): number | null {
  if (salaryAnual == null || salaryAnual <= 0) return null
  if (ssAnual == null) return null
  const h = horasSemana && horasSemana > 0 ? horasSemana : null
  if (h == null) return null
  return (salaryAnual + ssAnual) / (h * SEMANAS_AL_ANO)
}

export async function leePersonalSobreVentas(
  accountId: string, locationId: string | null,
): Promise<CosteDePersonal> {
  const ahora = new Date()
  const lunesYmd = lunesDeLaSemana(ahora)
  const [y, m, d] = lunesYmd.split('-').map(Number)
  const lunes = diaDelNegocio(new Date(Date.UTC(y, m - 1, d, 12)))
  const hoy = diaDelNegocio(ahora)

  let qEmp = sb().from('employees')
    .select('id, name, salary, employer_ss_annual, contracted_hours_week, weekly_hours')
    .eq('account_id', accountId).eq('active', true)
  if (locationId) qEmp = qEmp.eq('location_id', locationId)

  let qVentas = sb().from('sale').select('total')
    .eq('account_id', accountId)
    .gte('sold_at', lunes.desde.toISOString()).lt('sold_at', hoy.hasta.toISOString())
  if (locationId) qVentas = qVentas.eq('location_id', locationId)

  const [emp, ventas, turnos] = await Promise.all([
    qEmp,
    qVentas,
    // Las horas trabajadas salen de `team_worked_shifts`, que es la fuente
    // canónica: usarla evita dar dos cifras distintas de las mismas horas.
    rpcSinTipar<FilaTurno[]>('team_worked_shifts', {
      p_account: accountId,
      p_from: lunes.desde.toISOString(),
      p_to: hoy.hasta.toISOString(),
    }),
  ])
  if (emp.error) throw new Error(`No se ha podido leer la plantilla: ${emp.error.message}`)
  if (ventas.error) throw new Error(`No se han podido leer las ventas: ${ventas.error.message}`)

  const plantilla = (emp.data ?? []) as Record<string, unknown>[]
  const ventasEur = ((ventas.data ?? []) as { total: number | null }[])
    .reduce((s, r) => s + (Number(r.total) || 0), 0)

  const minutosPorEmpleado = new Map<string, number>()
  for (const t of turnos ?? []) {
    minutosPorEmpleado.set(t.employee_id,
      (minutosPorEmpleado.get(t.employee_id) ?? 0) + (Number(t.minutes) || 0))
  }

  let coste = 0
  let horas = 0
  const faltan: string[] = []
  for (const e of plantilla) {
    const id = String(e.id)
    const h = (minutosPorEmpleado.get(id) ?? 0) / 60
    horas += h
    const ch = costePorHora(
      e.salary == null ? null : Number(e.salary),
      e.employer_ss_annual == null ? null : Number(e.employer_ss_annual),
      Number(e.contracted_hours_week ?? e.weekly_hours ?? 0),
    )
    if (ch == null) {
      const nombre = String(e.name ?? '').trim().split(/\s+/)[0]
      const que = (e.employer_ss_annual == null) ? 'seguridad social'
        : (Number(e.salary ?? 0) <= 0) ? 'salario' : 'horas de contrato'
      faltan.push(`${nombre} (${que})`)
      continue
    }
    coste += ch * h
  }

  // UNO SOLO SIN DATO INVALIDA EL PORCENTAJE. Sumar el coste de cinco personas
  // y dividirlo entre las ventas de seis da un número más bajo que el real, y
  // más bajo es justo la dirección que engaña.
  const calculable = faltan.length === 0 && ventasEur > 0
  return {
    porcentaje: calculable ? (coste / ventasEur) * 100 : null,
    costeEur: coste,
    ventasEur,
    horas,
    periodo: 'esta semana',
    sinDato: faltan.length,
    totalEmpleados: plantilla.length,
    queFalta: faltan,
  }
}
