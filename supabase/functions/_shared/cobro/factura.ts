// supabase/functions/_shared/cobro/factura.ts
//
// G05 · Tarea 2 (09/11/2026). LA FACTURA DE UN RECIBO, con lo que se cobra al
// céntimo. Puro. La factura de verdad la escribe la base con la de la V01
// (conta_venta_guardar + conta_venta_emitir: serie del emisor, número sin
// huecos, asiento 430 / 705 + 477 y Verifactu); aquí solo se decide qué
// líneas lleva y cuánto, para que la factura y el cobro digan lo mismo.
//
// Reglas:
//   · No hay factura sin cobro confirmado (eso lo decide gocardless.ts).
//   · La factura detalla cada trabajador con su nombre: una línea por servicio
//     («Gestión laboral · 4 trabajadores», 4 × 20,00 €, como la maqueta
//     Factura.dc.html) y debajo sus trabajadores si son hasta 10; con más, en
//     una hoja aparte (decisiones_qbo.md, 09/11).
//   · LA FACTURA Y EL COBRO, AL CÉNTIMO. La V01 calcula el IVA por tipo sobre
//     la suma de las bases, redondeado (_conta_venta_cifras). Si la tarifa de
//     la gestoría lleva el IVA dentro (QBO: 96,80 € = 80 € + 21 %), hay que
//     encontrar la base que, con su IVA redondeado, da justo el total del
//     recibo. Casi siempre existe; si no (unos pocos totales no salen con
//     ningún céntimo de base), se dice ANTES de cobrar y se cobra lo que dirá
//     la factura, con la diferencia en palabras. Nunca una factura que no
//     cuadra con su cobro.
//   · Si la tarifa va sin IVA, la base es la tarifa y se cobra base + IVA.
//   · La retención (si el emisor la aplica) se resta del total, como en la V01.
//
// Lo prueban tests/unit/modules/conta/gestoria/g05/factura.test.ts.

import { euros } from '../tarifa/precio.ts'
import type { LineaDeRecibo, Recibo } from './recibo.ts'

/** Cómo factura la empresa emisora. */
export interface Fiscal {
  /** El IVA de sus servicios, en % (21). */
  ivaPct: number
  /** La retención que aplica, en % (0 si no aplica). */
  retencionPct: number
  /** Si los precios de su tarifa llevan el IVA dentro (QBO: sí). */
  preciosConIva: boolean
}

/** El redondeo de la base (el de Postgres en round(x, 2): la mitad, hacia fuera). */
const redondear = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9)
/** El IVA y la retención de una base, en céntimos, como los calcula la V01. */
const cuotaDe = (baseCent: number, pct: number) => redondear((baseCent * pct) / 100)
/** El total de una factura con esa base. */
export const totalConBase = (baseCent: number, f: Fiscal) => baseCent + cuotaDe(baseCent, f.ivaPct) - cuotaDe(baseCent, f.retencionPct)

/**
 * La base que da un total exacto (con el IVA dentro). Null si ningún céntimo de
 * base lo da: entonces se devuelve la más cercana por debajo, para no cobrar de más.
 */
export function baseParaElTotal(totalCent: number, f: Fiscal): { baseCent: number; exacta: boolean } {
  const k = 1 + (f.ivaPct - f.retencionPct) / 100
  const cerca = Math.round(totalCent / k)
  for (const d of [0, -1, 1, -2, 2, -3, 3]) if (totalConBase(cerca + d, f) === totalCent) return { baseCent: cerca + d, exacta: true }
  // Ningún céntimo de base da el total: la que más se acerca sin pasarse (nunca se cobra de más).
  const debajo = [-3, -2, -1, 0, 1, 2, 3].map((d) => cerca + d).filter((x) => totalConBase(x, f) <= totalCent)
  const mejor = debajo.length ? debajo.reduce((m, x) => (totalConBase(x, f) > totalConBase(m, f) ? x : m)) : cerca - 3
  return { baseCent: mejor, exacta: false }
}

/** Hasta cuántos trabajadores van debajo de su línea, en la misma hoja; con más, en una hoja aparte (decisiones_qbo.md, 09/11). */
export const TRABAJADORES_EN_LA_LINEA = 10

export interface TrabajadorEnFactura { nombre: string; desde: string | null }

export interface LineaDeFactura {
  /** El servicio, con sus trabajadores si los lleva: «Gestión laboral · 4 trabajadores». */
  concepto: string
  /**
   * «Cantidad × precio» cuando todos los trabajadores cuestan lo mismo (la
   * maqueta: «4 × 20,00 €»); si no (un tramo, un paquete o un servicio fijo), 1.
   */
  cantidad: number
  /** El precio de cada uno, en céntimos (base, sin IVA): cantidad × precio = base de la línea. */
  precioCent: number
  /** La base de la línea, en céntimos. */
  baseCent: number
  ivaPct: number
  asignacionId: string
  trabajadores: TrabajadorEnFactura[] | null
  /** Dónde van sus trabajadores: debajo de la línea (hasta 10) o en la hoja aparte (más de 10). */
  trabajadoresEn: 'linea' | 'hoja' | null
}

export interface HojaDeTrabajadores { servicio: string; trabajadores: TrabajadorEnFactura[] }

export interface FacturaDelRecibo {
  lineas: LineaDeFactura[]
  baseCent: number
  ivaCent: number
  retencionCent: number
  /** Lo que dirá la factura: lo que se cobra en GoCardless. */
  totalCent: number
  /** Si el total del recibo sale exacto; si no, cuánto menos se cobra y por qué. */
  ajuste: null | { cent: number; porque: string }
  /** Los servicios con más de 10 trabajadores, con todos ellos por su nombre: la hoja aparte del PDF. Vacía: no hay hoja aparte. */
  hoja: HojaDeTrabajadores[]
}

const sinTrabajadores = (texto: string) => texto.replace(/ · \d+ trabajador(es)?$/, '')
const conceptoDe = (l: LineaDeRecibo) => {
  const n = l.trabajadores?.length ?? 0
  return `${sinTrabajadores(l.texto)}${l.trabajadores ? ` · ${n} ${n === 1 ? 'trabajador' : 'trabajadores'}` : ''}`
}

/**
 * Reparte una base total entre las líneas en proporción a su importe. El
 * céntimo que sobre o falte va a la línea de más importe que no va por
 * trabajador (así las de trabajadores siguen siendo «cantidad × precio»); si
 * todas van por trabajador, a la de más importe.
 */
function repartir(importes: number[], porTrabajador: boolean[], baseTotal: number): number[] {
  const suma = importes.reduce((s, x) => s + x, 0)
  const partes = importes.map((x) => (suma ? redondear((x * baseTotal) / suma) : 0))
  const dif = baseTotal - partes.reduce((s, x) => s + x, 0)
  if (dif !== 0 && partes.length) {
    const candidatas = importes.map((x, i) => ({ x, i })).filter((c) => !porTrabajador[c.i])
    const elegida = (candidatas.length ? candidatas : importes.map((x, i) => ({ x, i }))).reduce((m, c) => (c.x > m.x ? c : m))
    partes[elegida.i] += dif
  }
  return partes
}

/** Las líneas, las cifras y los trabajadores de la factura de un recibo. Lanza si el recibo está parado. */
export function facturaDelRecibo(r: Recibo, f: Fiscal): FacturaDelRecibo {
  if (r.parado.length) throw new Error(`Un recibo parado no se factura: ${r.parado.join('; ')}.`)
  const importes = r.lineas.map((l) => l.importeCent ?? 0)
  let baseTotal: number
  let ajuste: FacturaDelRecibo['ajuste'] = null
  if (f.preciosConIva) {
    const b = baseParaElTotal(r.totalCent, f)
    baseTotal = b.baseCent
    if (!b.exacta) {
      const total = totalConBase(baseTotal, f)
      ajuste = { cent: r.totalCent - total, porque: `Con el IVA redondeado al céntimo, ${euros(r.totalCent)} no sale con ninguna base: se cobra y se factura ${euros(total)}` }
    }
  } else {
    baseTotal = r.totalCent
  }
  const conTrabajadores = r.lineas.map((l) => !!l.trabajadores && l.trabajadores.length > 0)
  const bases = f.preciosConIva ? repartir(importes, conTrabajadores, baseTotal) : importes
  const lineas: LineaDeFactura[] = r.lineas.map((l, i) => {
    const n = l.trabajadores?.length ?? 0
    // «Cantidad × precio» solo si sale exacto al céntimo: n trabajadores al mismo precio.
    const porUno = n > 0 && bases[i] % n === 0 && /^\d+ × /.test(l.cuenta)
    const trabajadores = l.trabajadores && n ? l.trabajadores.map((t) => ({ nombre: t.nombre, desde: t.altaEl })) : null
    return {
      concepto: conceptoDe(l), cantidad: porUno ? n : 1, precioCent: porUno ? bases[i] / n : bases[i], baseCent: bases[i], ivaPct: f.ivaPct,
      asignacionId: l.asignacionId, trabajadores, trabajadoresEn: trabajadores ? (n > TRABAJADORES_EN_LA_LINEA ? 'hoja' : 'linea') : null,
    }
  })
  const ivaCent = cuotaDe(baseTotal, f.ivaPct)
  const retencionCent = cuotaDe(baseTotal, f.retencionPct)
  return {
    lineas, baseCent: baseTotal, ivaCent, retencionCent, totalCent: baseTotal + ivaCent - retencionCent, ajuste,
    hoja: lineas.filter((l) => l.trabajadoresEn === 'hoja').map((l) => ({ servicio: sinTrabajadores(r.lineas.find((x) => x.asignacionId === l.asignacionId)!.texto), trabajadores: l.trabajadores! })),
  }
}

/** Las líneas como las recibe conta_venta_guardar (precio en euros con 4 decimales; el tipo y la cuenta los pone la base). */
export const lineasParaGuardar = (fa: FacturaDelRecibo) =>
  fa.lineas.map((l) => ({ concepto: l.concepto, cantidad: l.cantidad, precio: l.precioCent / 100, descuento: 0, iva_pct: l.ivaPct }))
