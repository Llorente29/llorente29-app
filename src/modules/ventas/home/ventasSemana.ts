// src/modules/ventas/home/ventasSemana.ts
//
// La cifra de la semana en curso y su espejo, para §1.2 de la maqueta.
//
// ── EL ESPEJO NO INCLUYE EL DÍA EN CURSO, Y ES LA ENTRADA 6 DEL REGISTRO ───
// La cifra grande SÍ lleva el día de hoy: «esta semana» es lo vendido esta
// semana, hoy incluido. Pero la COMPARACIÓN excluye el día en curso de los dos
// lados, porque el miércoles a media mañana lleva tres horas de servicio y el
// miércoles pasado tuvo veinticuatro: compararlos daría una caída inventada
// todos los días, y el lunes por la mañana diría −90 % sin que pasara nada.
//
// Por eso el rótulo dice «vs los mismos días» y no «vs semana anterior»: el
// nombre tiene que decir lo que de verdad se ha comparado.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { diaDelNegocio, lunesDeLaSemana } from '@/lib/fechas'

export interface SemanaConEspejo {
  /** Lo vendido esta semana, con el día en curso incluido. */
  total: number
  /** Días CERRADOS de esta semana (sin hoy). */
  totalCerrado: number
  /** Los mismos días de la semana anterior. */
  espejo: number
  /** Cuántos días cerrados se han comparado. 0 = el lunes, sin nada que comparar. */
  diasComparados: number
  desde: Date
  hasta: Date
}

function sb() {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

async function suma(accountId: string, locationId: string | null, desde: Date, hasta: Date) {
  if (hasta <= desde) return 0
  let q = sb().from('sale').select('total')
    .eq('account_id', accountId)
    .gte('sold_at', desde.toISOString()).lt('sold_at', hasta.toISOString())
  if (locationId) q = q.eq('location_id', locationId)
  const { data, error } = await q
  if (error) throw new Error(`No se han podido leer las ventas: ${error.message}`)
  return ((data ?? []) as { total: number | null }[])
    .reduce((s, r) => s + (Number(r.total) || 0), 0)
}

export async function leeSemanaConEspejo(
  accountId: string,
  locationId: string | null,
): Promise<SemanaConEspejo> {
  const hoy = diaDelNegocio(new Date())
  const lunesYmd = lunesDeLaSemana(new Date())
  const [ly, lm, ld] = lunesYmd.split('-').map(Number)
  const lunes = diaDelNegocio(new Date(Date.UTC(ly, lm - 1, ld, 12)))

  // Semana anterior: mismo lunes menos siete días, normalizado por el día del
  // negocio para que el cambio de hora no desplace el corte.
  const lunesPrevio = diaDelNegocio(new Date(lunes.desde.getTime() - 7 * 86_400_000))
  const finCerradoPrevio = diaDelNegocio(new Date(hoy.desde.getTime() - 7 * 86_400_000))

  const diasComparados = Math.round((hoy.desde.getTime() - lunes.desde.getTime()) / 86_400_000)

  const [total, totalCerrado, espejo] = await Promise.all([
    suma(accountId, locationId, lunes.desde, hoy.hasta),
    suma(accountId, locationId, lunes.desde, hoy.desde),
    suma(accountId, locationId, lunesPrevio.desde, finCerradoPrevio.desde),
  ])

  return {
    total, totalCerrado, espejo, diasComparados,
    desde: lunes.desde, hasta: hoy.hasta,
  }
}
