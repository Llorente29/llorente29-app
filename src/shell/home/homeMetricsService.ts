// src/shell/home/homeMetricsService.ts
//
// Métricas REALES del Home general. Sustituye los valores MOCK de HomeGeneral
// por datos de la BBDD de la cuenta activa. Cada métrica trae su consulta; lo
// que aún no tiene fuente fiable se devuelve como null (la UI lo marca como
// "—", no inventa). Agnóstico de TPV: lee de `sale` canónica, no de Last.
//
// Verificado RECON 11/06 (Folvy Interno): sale tiene account_id/sold_at/total;
// employees se liga a la cuenta vía locations.account_id (employees.location_id);
// clock_entries es por EVENTOS (campo type/datetime), sin columna clock_out.

import { supabase } from '@/lib/supabase'

export interface HomeMetrics {
  // Ventas de hoy en € (suma de sale.total con sold_at = hoy). null si no se pudo.
  ventasHoy: number | null
  // Variación % vs ayer (mismo cálculo ayer). null si ayer no tiene datos.
  ventasVsAyerPct: number | null
  // Empleados trabajando ahora (último evento de fichaje = entrada). 0 real válido.
  trabajandoAhora: number | null
  // Nº de locales del cliente (para subtítulos).
  numLocales: number | null
  // ─ Resumen Sales ─
  ventas7d: number | null
  numPedidos7d: number | null
  ticketMedio7d: number | null
}

function requireSb() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

/** Suma de ventas (€) de un rango [desde, hasta) para la cuenta. */
async function sumVentas(accountId: string, desdeISO: string, hastaISO: string): Promise<{ total: number; n: number }> {
  const sb = requireSb()
  const { data, error } = await sb
    .from('sale')
    .select('total')
    .eq('account_id', accountId)
    .gte('sold_at', desdeISO)
    .lt('sold_at', hastaISO)
  if (error) throw new Error(error.message)
  const rows = (data as { total: number | null }[] | null) ?? []
  const total = rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0)
  return { total, n: rows.length }
}

/** Métricas completas del Home para la cuenta activa. Nunca lanza: ante fallo
 *  de una métrica, ese campo va a null y el resto se calcula igual. */
export async function getHomeMetrics(accountId: string): Promise<HomeMetrics> {
  const sb = requireSb()

  const now = new Date()
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0)
  const startTomorrow = new Date(startToday); startTomorrow.setDate(startTomorrow.getDate() + 1)
  const startYesterday = new Date(startToday); startYesterday.setDate(startYesterday.getDate() - 1)
  const start7d = new Date(startToday); start7d.setDate(start7d.getDate() - 7)

  const result: HomeMetrics = {
    ventasHoy: null, ventasVsAyerPct: null, trabajandoAhora: null,
    numLocales: null, ventas7d: null, numPedidos7d: null, ticketMedio7d: null,
  }

  // Ventas hoy + ayer (para la variación).
  try {
    const hoy = await sumVentas(accountId, startToday.toISOString(), startTomorrow.toISOString())
    result.ventasHoy = hoy.total
    const ayer = await sumVentas(accountId, startYesterday.toISOString(), startToday.toISOString())
    if (ayer.total > 0) {
      result.ventasVsAyerPct = Math.round(((hoy.total - ayer.total) / ayer.total) * 100)
    }
  } catch { /* ventasHoy queda null */ }

  // Ventas 7 días + pedidos + ticket medio (resumen Sales).
  try {
    const semana = await sumVentas(accountId, start7d.toISOString(), startTomorrow.toISOString())
    result.ventas7d = semana.total
    result.numPedidos7d = semana.n
    result.ticketMedio7d = semana.n > 0 ? semana.total / semana.n : 0
  } catch { /* quedan null */ }

  // Locales del cliente.
  try {
    const { count, error } = await sb
      .from('locations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (!error) result.numLocales = count ?? 0
  } catch { /* null */ }

  // Trabajando ahora: empleados cuyo ÚLTIMO evento de fichaje es una entrada.
  // clock_entries es por eventos (type 'in'/'out' u similar). Se liga a la cuenta
  // vía locations. Si la tabla está vacía → 0 real (nadie fichado).
  try {
    const { data: locs } = await sb.from('locations').select('id').eq('account_id', accountId)
    const locIds = ((locs as { id: string }[] | null) ?? []).map(l => l.id)
    if (locIds.length === 0) {
      result.trabajandoAhora = 0
    } else {
      const { data: ev, error } = await sb
        .from('clock_entries')
        .select('employee_id, type, datetime')
        .in('location_id_at_clock', locIds)
        .order('datetime', { ascending: false })
      if (error) throw error
      const eventos = (ev as { employee_id: string; type: string; datetime: string }[] | null) ?? []
      // Primer evento por empleado (ya viene ordenado desc = el más reciente).
      const visto = new Set<string>()
      let dentro = 0
      for (const e of eventos) {
        if (visto.has(e.employee_id)) continue
        visto.add(e.employee_id)
        const t = (e.type || '').toLowerCase()
        if (t === 'in' || t === 'entrada' || t === 'clock_in') dentro++
      }
      result.trabajandoAhora = dentro
    }
  } catch { /* trabajandoAhora queda null */ }

  return result
}
