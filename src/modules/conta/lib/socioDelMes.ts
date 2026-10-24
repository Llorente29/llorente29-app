// src/modules/conta/lib/socioDelMes.ts
//
// V01 · Entrega 3 · La liquidación mensual del socio de marca (CTB), como la
// pidió Julio el 24/10:
//
//   1. Los albaranes de los proveedores que facturan al socio NO se
//      contabilizan: se guardan como soporte, por mes y por local.
//   2. Su factura de compra del mes (FV) sí se apunta como compra (600), como
//      hoy: lo que llega del socio se usa en todas las marcas.
//   3. Sumied comprueba que la FV del mes coincide con la suma de esos
//      albaranes; si no, lo dice con la diferencia y los albaranes que faltan o
//      sobran.
//   4. Su factura de servicios (AF, 705), la compensación y el cobro por banco
//      o factoring, como hoy: Sumied los propone y casa el cobro.
//
// Aquí, lo del punto 3, sin React y con sus pruebas. Lo que «sobra» se busca
// de verdad: el albarán (o los dos o tres) cuya base es exactamente lo que
// sobra; si hay más de una forma de sumarlo, se dicen todas (hasta tres) y no
// se elige ninguna. Lo que «falta» no se puede señalar desde aquí (no está):
// se dice cuánto.

import { eurosExactos } from './formato'

export interface AlbaranDelMes { id: string; codigo: string | null; fecha: string; base: number | null }

export interface ContrasteFv {
  estado: 'coincide' | 'diferencia' | 'sin-fv' | 'sin-albaranes'
  fv: number | null
  albaranes: number
  /** FV − albaranes: positivo, la FV trae más (faltan albaranes); negativo, sobran. */
  diferencia: number | null
  /** Los albaranes sin importe: no suman, y se dicen. */
  sinImporte: AlbaranDelMes[]
  /** Las formas exactas de explicar lo que sobra (cada una, de 1 a 3 albaranes). */
  sobran: AlbaranDelMes[][]
  texto: string
}

const cent = (x: number) => Math.round(x * 100)

/** La base de la FV: la suma de las bases de sus líneas. */
export const baseFv = (f: { lineas: readonly { base: number }[] } | null | undefined): number | null =>
  f && f.lineas.length ? cent(f.lineas.reduce((t, l) => t + l.base, 0)) / 100 : null

/** Las formas de sumar exactamente `objetivo` céntimos con 1, 2 o 3 albaranes (como mucho, `max` formas). */
export function formasDeSumar(xs: readonly AlbaranDelMes[], objetivo: number, max = 3): AlbaranDelMes[][] {
  const con = xs.filter((x) => x.base !== null).map((x) => ({ x, c: cent(x.base!) }))
  const out: AlbaranDelMes[][] = []
  for (let i = 0; i < con.length && out.length < max; i++) if (con[i].c === objetivo) out.push([con[i].x])
  for (let i = 0; i < con.length && out.length < max; i++) for (let j = i + 1; j < con.length && out.length < max; j++)
    if (con[i].c + con[j].c === objetivo) out.push([con[i].x, con[j].x])
  for (let i = 0; i < con.length && out.length < max; i++) for (let j = i + 1; j < con.length && out.length < max; j++)
    for (let k = j + 1; k < con.length && out.length < max; k++) if (con[i].c + con[j].c + con[k].c === objetivo) out.push([con[i].x, con[j].x, con[k].x])
  return out
}

const nombre = (a: AlbaranDelMes) => `${a.codigo ?? 'albarán'} del ${a.fecha.slice(0, 10).split('-').reverse().slice(0, 2).join('/')} (${eurosExactos(a.base ?? 0)})`

export function contrastarFv(fv: number | null, xs: readonly AlbaranDelMes[]): ContrasteFv {
  const sinImporte = xs.filter((x) => x.base === null)
  const albaranes = cent(xs.reduce((t, x) => t + (x.base ?? 0), 0)) / 100
  const base = { fv, albaranes, sinImporte, sobran: [] as AlbaranDelMes[][] }
  const notaSin = sinImporte.length ? ` ${sinImporte.length === 1 ? 'Un albarán no tiene importe' : `${sinImporte.length} albaranes no tienen importe`} y no suma${sinImporte.length === 1 ? '' : 'n'}: ${sinImporte.map((a) => a.codigo ?? a.fecha).join(', ')}.` : ''
  if (fv === null) return { ...base, estado: 'sin-fv', diferencia: null, texto: `Aún no ha llegado su factura del mes (FV): los albaranes suman ${eurosExactos(albaranes)}.${notaSin}` }
  if (xs.length === 0) return { ...base, estado: 'sin-albaranes', diferencia: fv, texto: `Su factura (FV) es de ${eurosExactos(fv)} de base y no hay ningún albarán suyo de este mes y local.` }
  const d = cent(fv) - cent(albaranes)
  if (d === 0 && !sinImporte.length) return { ...base, estado: 'coincide', diferencia: 0, texto: `Coincide: su factura (FV) y los ${xs.length} albaranes suman ${eurosExactos(fv)} de base.` }
  if (d === 0) return { ...base, estado: 'diferencia', diferencia: 0, texto: `Suman lo mismo (${eurosExactos(fv)}), pero no se puede dar por bueno:${notaSin}` }
  if (d > 0) {
    return { ...base, estado: 'diferencia', diferencia: d / 100,
      texto: `No coincide: su factura (FV) es de ${eurosExactos(fv)} de base y los ${xs.length} albaranes suman ${eurosExactos(albaranes)}. Faltan albaranes por ${eurosExactos(d / 100)}: alguno sin subir, o sin marcar que lo paga el socio.${notaSin}` }
  }
  const sobran = formasDeSumar(xs, -d)
  const cuales = sobran.length === 1
    ? ` Sobra${sobran[0].length === 1 ? ' el' : 'n'} ${sobran[0].map(nombre).join(' y ')}: ${sobran[0].length === 1 ? 'su importe es' : 'suman'} justo la diferencia.`
    : sobran.length > 1
      ? ` Puede ser ${sobran.map((f) => f.map(nombre).join(' y ')).join(', o ')}: cualquiera suma justo la diferencia.`
      : ' Ningún albarán (ni dos ni tres juntos) suma justo la diferencia.'
  return { ...base, sobran, estado: 'diferencia', diferencia: d / 100,
    texto: `No coincide: su factura (FV) es de ${eurosExactos(fv)} de base y los ${xs.length} albaranes suman ${eurosExactos(albaranes)}: sobran ${eurosExactos(-d / 100)}.${cuales}${notaSin}` }
}
