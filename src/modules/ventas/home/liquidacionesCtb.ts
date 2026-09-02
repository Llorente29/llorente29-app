// src/modules/ventas/home/liquidacionesCtb.ts
//
// LAS LIQUIDACIONES DE CTB por las marcas cedidas.
//
// ── QUÉ TABLA MANDA, QUE ERA LA DECISIÓN PENDIENTE ─────────────────────────
// Hay TRES tablas de settlement y el fichero de informes dejó escrito que no
// estaba decidido cuál. Para ESTA tarjeta sí lo está, y por una razón que se
// puede comprobar:
//
//   · `licensed_settlement` — UNA FILA POR DOCUMENTO DE LIQUIDACIÓN: referencia
//     (AF-02772), local, periodo y neto. Es literalmente «las liquidaciones».
//   · `channel_settlement` (flow_type='licensed') — el DETALLE por marca y canal
//     que CTB manda como base del documento. Es el porqué, no el documento.
//   · `channel_settlement_order` — el detalle por pedido, un piso más abajo.
//
// La tarjeta se llama «Liquidaciones CTB», así que lee las liquidaciones. El
// detalle vive en Ventas · Cedidas, que es a donde lleva el pie, y lee la otra.
// La decisión del INFORME descargable sigue abierta: no es la misma pregunta.
//
// ── LO QUE SE MIDIÓ ANTES DE ESCRIBIR ESTO (02/09) ─────────────────────────
// TRES filas en Foodint, las tres de junio, importadas el 12/07 y NUNCA
// enseñadas: `licensed_settlement` no se lee desde ninguna pantalla de la
// aplicación. Esta tarjeta es la primera. Y lo que enseña de entrada es que la
// última liquidación es de hace dos meses.
//
// Por eso la consecuencia de esta tarjeta no es el importe: es la antigüedad.
// Un importe de junio en septiembre no es una noticia; que julio y agosto sigan
// sin liquidar, sí.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'

export interface LiquidacionPorLocal {
  local: string
  referencia: string | null
  netoEur: number
}

export interface LiquidacionesCtb {
  /** Periodo de la última liquidación, o null si no hay ninguna. */
  periodoDesde: string | null
  periodoHasta: string | null
  /** «junio de 2026». */
  periodo: string | null
  netoEur: number
  porLocal: LiquidacionPorLocal[]
  /** Meses CERRADOS posteriores al periodo liquidado y todavía sin liquidar. */
  mesesSinLiquidar: number
  /** Cuántos documentos hay en total, de todos los periodos. */
  documentos: number
}

interface Fila {
  location_id: string | null
  settlement_ref: string | null
  period_from: string
  period_to: string
  net_settlement: number | string | null
}

function sb() {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

/**
 * MESES YA CERRADOS QUE SIGUEN SIN LIQUIDAR.
 *
 * Se cuenta por número de mes, no por días/30: el 2 de septiembre, con la
 * última liquidación de junio, lo que falta son JULIO y AGOSTO —dos meses—, y
 * «64 días de retraso» no es lo que nadie quiere leer ahí.
 *
 * El mes en curso NO cuenta: en septiembre nadie debe todavía septiembre. Por
 * eso se resta uno, y por eso en julio con junio liquidado la respuesta es 0 y
 * la tarjeta no inventa un retraso que no existe.
 */
export function mesesSinLiquidar(periodoHastaYmd: string, ahora: Date): number {
  const [y, m] = periodoHastaYmd.split('-').map(Number)
  const meses = (ahora.getFullYear() - y) * 12 + (ahora.getMonth() + 1 - m)
  return Math.max(0, meses - 1)
}

export async function leeLiquidacionesCtb(
  accountId: string, locationId: string | null, ahora: Date = new Date(),
): Promise<LiquidacionesCtb> {
  // REGLA 9: filtra por cuenta. `licensed_settlement` es multi-cuenta y anclar
  // por nombre de local sin cuenta daría la ficha de otro.
  let q = sb().from('licensed_settlement')
    .select('location_id, settlement_ref, period_from, period_to, net_settlement')
    .eq('account_id', accountId)
    .order('period_to', { ascending: false })
  if (locationId) q = q.eq('location_id', locationId)

  const { data, error } = await q
  if (error) throw new Error(`No se han podido leer las liquidaciones: ${error.message}`)
  const filas = (data ?? []) as unknown as Fila[]

  if (filas.length === 0) {
    return {
      periodoDesde: null, periodoHasta: null, periodo: null,
      netoEur: 0, porLocal: [], mesesSinLiquidar: 0, documentos: 0,
    }
  }

  // El periodo más reciente, y TODAS las filas de ese periodo (una por local).
  const ultimo = filas[0].period_to
  const delUltimo = filas.filter(f => f.period_to === ultimo)

  const nombres = await nombresDeLocal(accountId)
  const porLocal = delUltimo.map(f => ({
    local: (f.location_id ? nombres.get(f.location_id) : null) ?? 'Sin local',
    referencia: f.settlement_ref,
    netoEur: Number(f.net_settlement ?? 0),
  })).sort((a, b) => b.netoEur - a.netoEur)

  const desde = delUltimo.reduce<string>((min, f) => (f.period_from < min ? f.period_from : min),
    delUltimo[0].period_from)

  return {
    periodoDesde: desde,
    periodoHasta: ultimo,
    periodo: nombreDePeriodo(desde, ultimo),
    netoEur: porLocal.reduce((s, l) => s + l.netoEur, 0),
    porLocal,
    mesesSinLiquidar: mesesSinLiquidar(ultimo, ahora),
    documentos: filas.length,
  }
}

/** «junio de 2026» si el periodo es un mes natural; si no, «01/06 – 15/06». */
export function nombreDePeriodo(desdeYmd: string, hastaYmd: string): string {
  const [y1, m1, d1] = desdeYmd.split('-').map(Number)
  const [y2, m2, d2] = hastaYmd.split('-').map(Number)
  const finDeMes = new Date(Date.UTC(y2, m2, 0)).getUTCDate()
  if (y1 === y2 && m1 === m2 && d1 === 1 && d2 === finDeMes) {
    return new Date(Date.UTC(y1, m1 - 1, 15))
      .toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }
  return `${desdeYmd} – ${hastaYmd}`
}

async function nombresDeLocal(accountId: string): Promise<Map<string, string>> {
  const { data, error } = await sb().from('locations').select('id, name').eq('account_id', accountId)
  if (error) throw new Error(`No se han podido leer los locales: ${error.message}`)
  return new Map(((data ?? []) as { id: string; name: string }[]).map(l => [l.id, l.name]))
}
