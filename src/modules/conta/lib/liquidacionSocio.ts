// src/modules/conta/lib/liquidacionSocio.ts
//
// C03 · La liquidación del socio de marca (cesión de marca), POR LOCAL Y POR
// PERIODO (dato de Julio, 06/10):
//
//   compras del local − aportaciones del socio en ese local + comisión sobre
//   las ventas de sus marcas en ese local = importe
//
// Positivo: a favor del socio (se le paga). Negativo: a tu favor. La calcula
// la base (brand_partner_settlement_compute) con las tres fuentes reales
// (albaranes, aportaciones, ventas por marca); aquí se rehace la cuenta para
// enseñarla línea a línea y sumar el mes, y se comprueba que cuadra con lo que
// dice la base (si no cuadra, la pantalla no deja confirmar).
//
// Regla 4: si falta una fuente del periodo, se dice y no se cierra.

import { eurosExactos } from './formato'

export interface MarcaDelSocio { marca: string; pct: number; base: number }

export interface CalculoLocal {
  localId: string
  local: string
  compras: number
  aportaciones: number
  marcas: MarcaDelSocio[]
  /** Lo que impide cerrarla, con su texto («1 línea de albarán sin precio…»). */
  faltan: string[]
  /** El importe que dice la base, para comprobar. */
  importeBase?: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export interface LineaLiquidacion { texto: string; importe: number }

export interface Liquidacion {
  compras: number
  aportaciones: number
  baseVentas: number
  comision: number
  /** Si todas las marcas van al mismo %, ese; si no, null (se dice por marca). */
  pct: number | null
  importe: number
  sentido: 'a su favor' | 'a tu favor' | 'a cero'
  lineas: LineaLiquidacion[]
  cerrable: boolean
  faltan: string[]
  /** La base y Folvy no dicen lo mismo (no debería pasar): no se confirma. */
  descuadreConBase: number | null
}

/** La comisión de cada marca, redondeada por marca como la base. */
const comisionDe = (m: MarcaDelSocio) => r2(m.base * m.pct / 100)

/** Un local: las tres líneas y el resultado. */
export function liquidarLocal(c: CalculoLocal): Liquidacion {
  const baseVentas = r2(c.marcas.reduce((s, m) => s + m.base, 0))
  const comision = r2(c.marcas.reduce((s, m) => s + comisionDe(m), 0))
  const pcts = [...new Set(c.marcas.map((m) => m.pct))]
  const pct = pcts.length === 1 ? pcts[0] : null
  const importe = r2(c.compras - c.aportaciones + comision)
  const lineas: LineaLiquidacion[] = [
    { texto: 'Compras de mercancía del mes', importe: r2(c.compras) },
    { texto: '− Aportaciones del socio', importe: -r2(c.aportaciones) },
    { texto: pct != null ? `+ Comisión sobre ventas de sus marcas (${String(pct).replace('.', ',')} %)` : '+ Comisión sobre ventas de sus marcas', importe: comision },
  ]
  const descuadreConBase = c.importeBase == null ? null : r2(c.importeBase - importe)
  return {
    compras: r2(c.compras), aportaciones: r2(c.aportaciones), baseVentas, comision, pct, importe,
    sentido: importe > 0 ? 'a su favor' : importe < 0 ? 'a tu favor' : 'a cero',
    lineas, faltan: c.faltan,
    cerrable: c.faltan.length === 0 && (descuadreConBase == null || descuadreConBase === 0),
    descuadreConBase: descuadreConBase === 0 ? null : descuadreConBase,
  }
}

export interface LiquidacionMes extends Liquidacion {
  porLocal: (Liquidacion & { localId: string; local: string })[]
}

/** El mes entero: la suma de los locales (la ficha enseña el total y el desglose). */
export function liquidarMes(locales: readonly CalculoLocal[]): LiquidacionMes {
  const porLocal = locales.map((c) => ({ ...liquidarLocal(c), localId: c.localId, local: c.local }))
  const suma = (k: 'compras' | 'aportaciones' | 'baseVentas' | 'comision' | 'importe') => r2(porLocal.reduce((s, l) => s + l[k], 0))
  const importe = suma('importe')
  const pcts = [...new Set(porLocal.map((l) => l.pct))]
  const pct = pcts.length === 1 ? pcts[0] : null
  const faltan = porLocal.flatMap((l) => l.faltan.map((f) => `${l.local}: ${f}`))
  return {
    compras: suma('compras'), aportaciones: suma('aportaciones'), baseVentas: suma('baseVentas'), comision: suma('comision'), pct, importe,
    sentido: importe > 0 ? 'a su favor' : importe < 0 ? 'a tu favor' : 'a cero',
    lineas: [
      { texto: 'Compras de mercancía del mes', importe: suma('compras') },
      { texto: '− Aportaciones del socio', importe: -suma('aportaciones') },
      { texto: pct != null ? `+ Comisión sobre ventas de sus marcas (${String(pct).replace('.', ',')} %)` : '+ Comisión sobre ventas de sus marcas', importe: suma('comision') },
    ],
    cerrable: porLocal.every((l) => l.cerrable),
    faltan,
    descuadreConBase: null,
    porLocal,
  }
}

/** «6.887,00 € a su favor» / «212,00 € a tu favor» / «0,00 €». */
export function textoImporte(l: Pick<Liquidacion, 'importe' | 'sentido'>): string {
  return l.sentido === 'a cero' ? eurosExactos(0) : `${eurosExactos(Math.abs(l.importe))} ${l.sentido}`
}

const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** El mes natural de una fecha: 'YYYY-MM-DD' → { desde, hasta, nombre }. */
export function mesDe(iso: string): { desde: string; hasta: string; nombre: string } {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7))
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { desde: `${y}-${mm}-01`, hasta: `${y}-${mm}-${String(ultimo).padStart(2, '0')}`, nombre: MESES_LARGOS[m - 1] }
}
