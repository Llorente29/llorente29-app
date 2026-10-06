// src/modules/conta/lib/lectorLiquidaciones.ts
//
// C03 · «Subir liquidación» (respuesta 1, decisión 1): es la importación CSV que
// ya existe (scripts/import-channel-settlements.mjs, Capa B de Ventas), traída
// al núcleo para poder usarla desde la ficha de la plataforma. Lee lo MISMO y
// con las mismas claves de importación (import_key), así que subir un fichero
// que ya entró por el script no duplica nada: lo actualiza.
//
// Formato de los tres ficheros (los que ya importa Folvy): delimitador «;»,
// comillas opcionales, decimales con coma (1.234,56) o con punto (1,234.56),
// fechas dd/mm/aaaa. Cada plataforma trae columnas distintas:
//   · Glovo: la liquidación entera (ventas, comisión, cargos, neto, deuda).
//   · Just Eat: solo ventas (venta_neta, base_10, iva_10): sin comisión ni neto.
//   · Uber Eats: un mes por local (pedidos, venta_con_iva, base_10, iva_10):
//     sin comisión ni neto.
// Lo que el fichero no trae no se inventa: la ficha lo dice («el fichero no
// trae el neto»). Y las columnas que nadie lee se cuentan (B59 §2).

export type Plataforma = 'glovo' | 'je' | 'uber'

export const SOURCE: Record<Plataforma, string> = { glovo: 'import_csv_glovo', je: 'import_csv_je', uber: 'import_csv_uber' }

/** Las columnas que se leen de cada fichero (las mismas que el script). */
export const LEIDAS: Record<Plataforma, string[]> = {
  glovo: ['numero', 'local', 'fecha', 'venta_neta', 'base_10', 'iva_10', 'comision_base', 'entrega',
    'promo_producto', 'promo_flash', 'oferta_flash', 'tasa_acceso', 'glovo_prime',
    'tarifa_recurrente', 'coste_incidencias', 'devol_incidencias', 'liquidacion', 'deuda_acumulada'],
  je: ['numero', 'local', 'fecha', 'venta_neta', 'base_10', 'iva_10'],
  uber: ['mes', 'local', 'pedidos', 'venta_con_iva', 'base_10', 'iva_10'],
}

/** CSV mínimo: «;», comillas opcionales con «""» dentro, sin la marca BOM. */
export function partirCsvPuntoYComa(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = [], field = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++ } else q = false } else field += c
    } else if (c === '"') q = true
    else if (c === ';') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''))
}

/** Filas como objetos por su cabecera (recortadas). */
export function filasCsv(text: string): Record<string, string>[] {
  const rows = partirCsvPuntoYComa(text)
  if (!rows.length) return []
  const head = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}

/**
 * Un importe. B59 (04/09/2026): parseFloat a secas se comía los céntimos con
 * la coma decimal. Se aceptan los dos formatos: 1.234,56 y 1,234.56.
 */
export function importe(x: string | null | undefined): number | null {
  if (x == null || x === '') return null
  let s = String(x).trim()
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.')
  if (coma > punto) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const v = parseFloat(s)
  return Number.isNaN(v) ? null : v
}

/** dd/mm/aaaa → aaaa-mm-dd. */
export function fechaDmy(s: string | null | undefined): string | null {
  if (!s) return null
  const m = s.split('/')
  return m.length === 3 ? `${m[2]}-${m[1].padStart(2, '0')}-${m[0].padStart(2, '0')}` : null
}

/** 'aaaa-mm' → [primer día, último día]. */
export function rangoMes(ym: string): [string, string] {
  const [y, m] = ym.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${ym}-01`, `${ym}-${String(ultimo).padStart(2, '0')}`]
}

/** Una fila para channel_settlement (las columnas que escribe el script). */
export interface FilaLiquidacion {
  source: string
  import_key: string
  external_brand_text: string | null
  settlement_ref: string | null
  settlement_date: string | null
  period_from?: string
  period_to?: string
  period_grain: string
  orders_count?: number | null
  gross_sales: number | null
  base_amount: number | null
  vat_amount: number | null
  commission?: number
  delivery_transport?: number
  promo_product?: number
  promo_flash?: number
  offer_flash_credit?: number
  access_fee?: number
  prime_fee?: number
  recurring_fee?: number
  incidents_cost?: number
  incidents_refund?: number
  net_payout?: number | null
  accumulated_debt?: number | null
  raw: Record<string, string>
}

export interface LecturaLiquidaciones {
  plataforma: Plataforma
  filas: FilaLiquidacion[]
  /** Columnas del fichero que no se leen (B59 §2): se enseñan, no se tiran. */
  sinLeer: string[]
  /** Lo que el fichero no trae y la ficha tiene que decir. */
  noTrae: string[]
}

/** ¿De qué plataforma es este fichero? Por sus columnas. */
export function queFichero(cabecera: readonly string[]): Plataforma | null {
  const c = new Set(cabecera)
  if (c.has('liquidacion') && c.has('comision_base') && c.has('numero')) return 'glovo'
  if (c.has('mes') && c.has('venta_con_iva')) return 'uber'
  if (c.has('numero') && c.has('venta_neta') && c.has('fecha')) return 'je'
  return null
}

export class FicheroNoReconocido extends Error {}

/** Lee el CSV de una plataforma. Si no se dice cuál, se reconoce por sus columnas. */
export function leerLiquidaciones(text: string, plataforma?: Plataforma): LecturaLiquidaciones {
  const filas = filasCsv(text)
  const cabecera = filas.length ? Object.keys(filas[0]) : []
  const p = plataforma ?? queFichero(cabecera)
  if (!p) throw new FicheroNoReconocido('No es un fichero de liquidaciones de Glovo, Just Eat ni Uber Eats: no tiene sus columnas.')
  const out: FilaLiquidacion[] = []
  for (const r of filas) {
    if (p === 'glovo') {
      const num = (r.numero || '').trim(); if (!num) continue
      out.push({
        source: SOURCE.glovo, import_key: `glovo:${num}`, external_brand_text: r.local || null, settlement_ref: num,
        settlement_date: fechaDmy(r.fecha), period_grain: 'quincena',
        gross_sales: importe(r.venta_neta), base_amount: importe(r.base_10), vat_amount: importe(r.iva_10),
        commission: importe(r.comision_base) ?? 0, delivery_transport: importe(r.entrega) ?? 0,
        promo_product: importe(r.promo_producto) ?? 0, promo_flash: importe(r.promo_flash) ?? 0,
        offer_flash_credit: importe(r.oferta_flash) ?? 0, access_fee: importe(r.tasa_acceso) ?? 0,
        prime_fee: importe(r.glovo_prime) ?? 0, recurring_fee: importe(r.tarifa_recurrente) ?? 0,
        incidents_cost: importe(r.coste_incidencias) ?? 0, incidents_refund: importe(r.devol_incidencias) ?? 0,
        net_payout: importe(r.liquidacion), accumulated_debt: importe(r.deuda_acumulada), raw: r,
      })
    } else if (p === 'je') {
      const num = (r.numero || '').trim(); if (!num) continue
      out.push({
        source: SOURCE.je, import_key: `je:${num}`, external_brand_text: r.local || null, settlement_ref: num,
        settlement_date: fechaDmy(r.fecha), period_grain: 'quincena',
        gross_sales: importe(r.venta_neta), base_amount: importe(r.base_10), vat_amount: importe(r.iva_10), raw: r,
      })
    } else {
      const ym = (r.mes || '').trim(); if (!ym) continue
      const [desde, hasta] = rangoMes(ym)
      out.push({
        source: SOURCE.uber, import_key: `uber:${r.local}:${ym}`, external_brand_text: r.local || null, settlement_ref: null,
        settlement_date: hasta, period_from: desde, period_to: hasta, period_grain: 'mes',
        orders_count: importe(r.pedidos), gross_sales: importe(r.venta_con_iva), base_amount: importe(r.base_10), vat_amount: importe(r.iva_10), raw: r,
      })
    }
  }
  // La misma clave dos veces en el fichero: se queda la última (como el script).
  const porClave = new Map(out.map((f) => [f.import_key, f]))
  return {
    plataforma: p,
    filas: [...porClave.values()],
    sinLeer: cabecera.filter((c) => !LEIDAS[p].includes(c)),
    noTrae: p === 'glovo' ? [] : p === 'je' ? ['la comisión', 'el neto', 'el periodo'] : ['la comisión', 'el neto'],
  }
}
