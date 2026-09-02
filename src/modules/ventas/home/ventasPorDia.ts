// src/modules/ventas/home/ventasPorDia.ts
//
// La serie de 14 días de la gráfica del Inicio (§1.3 de la maqueta).
//
// Se trae las ventas del rango en UNA consulta y las agrupa por día DEL
// NEGOCIO en el cliente, con `diaNatural`. Agrupar en SQL obligaría a repetir
// ahí el corte de día en hora de Madrid, que ya está escrito y probado en
// `src/lib/fechas.ts`: dos definiciones del mismo día acaban discrepando la
// noche del cambio de hora, que es justo cuando nadie lo está mirando.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { diaNatural, diaDelNegocio } from '@/lib/fechas'

export interface DiaDeVentas {
  ymd: string
  total: number
  pedidos: number
  /** 0 = lunes … 6 = domingo. */
  diaSemana: number
  esFinde: boolean
  /** El día en curso: su cifra está a medias y no se compara con las demás. */
  enCurso: boolean
}

const LETRA_DIA = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

export function letraDe(diaSemana: number): string {
  return LETRA_DIA[diaSemana] ?? '?'
}

/** «Sáb 22», para el rótulo del hover. */
export function etiquetaCorta(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const nombre = new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('es-ES', { weekday: 'short', timeZone: 'UTC' })
  return `${nombre.charAt(0).toLocaleUpperCase('es')}${nombre.slice(1).replace('.', '')} ${d}`
}

/**
 * Agrupa las ventas por día del negocio y DEVUELVE LOS 14 DÍAS, incluidos los
 * que no tuvieron ninguna venta.
 *
 * Un día sin ventas es un dato —cerrado, o un día malo— y tiene que salir con
 * su barra a cero. Si se omitiera, la gráfica tendría 13 barras y el eje `L M X
 * J V S D` dejaría de cuadrar con ellas: se leería el lunes en la barra del
 * martes, y nadie se daría cuenta.
 */
export function agrupaPorDia(
  filas: { total: number | null; sold_at: string }[],
  ymdInicio: string,
  dias: number,
  hoyYmd: string,
): DiaDeVentas[] {
  const acc = new Map<string, { total: number; pedidos: number }>()
  for (const f of filas) {
    const ymd = diaNatural(new Date(f.sold_at))
    const a = acc.get(ymd) ?? { total: 0, pedidos: 0 }
    a.total += Number(f.total) || 0
    a.pedidos += 1
    acc.set(ymd, a)
  }

  const [y0, m0, d0] = ymdInicio.split('-').map(Number)
  const salida: DiaDeVentas[] = []
  for (let i = 0; i < dias; i++) {
    const t = new Date(Date.UTC(y0, m0 - 1, d0 + i))
    const ymd = t.toISOString().slice(0, 10)
    const dow = t.getUTCDay()                    // 0 = domingo
    const diaSemana = dow === 0 ? 6 : dow - 1    // 0 = lunes
    const v = acc.get(ymd) ?? { total: 0, pedidos: 0 }
    salida.push({
      ymd, total: v.total, pedidos: v.pedidos,
      diaSemana, esFinde: diaSemana >= 5, enCurso: ymd === hoyYmd,
    })
  }
  return salida
}

/**
 * Los dos días más altos, SIN contar el día en curso.
 *
 * El de hoy va a medias: a las nueve de la mañana su barra es un palito y a
 * medianoche sería el pico. Dejarlo entrar haría que la etiqueta saltara de
 * barra a lo largo del día sin que nadie hubiera vendido nada distinto.
 */
export function indicesDeLosPicos(dias: DiaDeVentas[], cuantos = 2): number[] {
  return dias
    .map((d, i) => ({ i, total: d.total, enCurso: d.enCurso }))
    .filter(d => !d.enCurso && d.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, cuantos)
    .map(d => d.i)
}

function sb() {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

export async function leeVentasPorDia(
  accountId: string,
  locationId: string | null,
  dias = 14,
): Promise<DiaDeVentas[]> {
  const hoy = diaDelNegocio(new Date())
  const inicio = new Date(hoy.desde.getTime() - (dias - 1) * 86_400_000)
  const desde = diaDelNegocio(inicio)

  let q = sb().from('sale').select('total, sold_at')
    .eq('account_id', accountId)
    .gte('sold_at', desde.desde.toISOString())
    .lt('sold_at', hoy.hasta.toISOString())
  if (locationId) q = q.eq('location_id', locationId)

  const { data, error } = await q
  if (error) throw new Error(`No se han podido leer las ventas: ${error.message}`)
  return agrupaPorDia(
    (data ?? []) as { total: number | null; sold_at: string }[],
    desde.ymd, dias, hoy.ymd,
  )
}
