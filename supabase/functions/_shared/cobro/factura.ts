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
//     y, aparte, la hoja de trabajadores con quién es cada uno.
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
import { mesEnPalabras, type LineaDeRecibo, type Recibo } from './recibo.ts'

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

export interface LineaDeFactura {
  concepto: string
  /** Siempre 1: el importe de un servicio por tramos no es «cantidad × precio». */
  cantidad: 1
  /** La base de la línea, en céntimos. */
  baseCent: number
  ivaPct: number
  asignacionId: string
}

export interface HojaDeTrabajadores { servicio: string; trabajadores: { nombre: string; desde: string | null }[] }

export interface FacturaDelRecibo {
  lineas: LineaDeFactura[]
  baseCent: number
  ivaCent: number
  retencionCent: number
  /** Lo que dirá la factura: lo que se cobra en GoCardless. */
  totalCent: number
  /** Si el total del recibo sale exacto; si no, cuánto menos se cobra y por qué. */
  ajuste: null | { cent: number; porque: string }
  /** Los trabajadores de cada servicio, por su nombre (la hoja aparte del PDF). */
  hoja: HojaDeTrabajadores[]
}

const sinTrabajadores = (texto: string) => texto.replace(/ · \d+ trabajador(es)?$/, '')
const conceptoDe = (l: LineaDeRecibo, mes: string) => {
  const n = l.trabajadores?.length ?? 0
  return `${sinTrabajadores(l.texto)}${l.trabajadores ? ` · ${n} ${n === 1 ? 'trabajador' : 'trabajadores'}` : ''} · ${mesEnPalabras(mes)}`
}

/** Reparte una base total entre las líneas en proporción a su importe; el céntimo que sobre o falte, a la de más importe. */
function repartir(importes: number[], baseTotal: number): number[] {
  const suma = importes.reduce((s, x) => s + x, 0)
  const partes = importes.map((x) => (suma ? redondear((x * baseTotal) / suma) : 0))
  const dif = baseTotal - partes.reduce((s, x) => s + x, 0)
  if (dif !== 0 && partes.length) {
    const i = importes.indexOf(Math.max(...importes))
    partes[i] += dif
  }
  return partes
}

/** Las líneas, las cifras y la hoja de trabajadores de la factura de un recibo. Lanza si el recibo está parado. */
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
  const bases = f.preciosConIva ? repartir(importes, baseTotal) : importes
  const lineas: LineaDeFactura[] = r.lineas.map((l, i) => ({ concepto: conceptoDe(l, r.mes), cantidad: 1, baseCent: bases[i], ivaPct: f.ivaPct, asignacionId: l.asignacionId }))
  const ivaCent = cuotaDe(baseTotal, f.ivaPct)
  const retencionCent = cuotaDe(baseTotal, f.retencionPct)
  return {
    lineas, baseCent: baseTotal, ivaCent, retencionCent, totalCent: baseTotal + ivaCent - retencionCent, ajuste,
    hoja: r.lineas.filter((l) => l.trabajadores && l.trabajadores.length)
      .map((l) => ({ servicio: sinTrabajadores(l.texto), trabajadores: l.trabajadores!.map((t) => ({ nombre: t.nombre, desde: t.altaEl })) })),
  }
}

/** Las líneas como las recibe conta_venta_guardar (precio en euros con 4 decimales; el tipo y la cuenta los pone la base). */
export const lineasParaGuardar = (fa: FacturaDelRecibo) =>
  fa.lineas.map((l) => ({ concepto: l.concepto, cantidad: l.cantidad, precio: l.baseCent / 100, descuento: 0, iva_pct: l.ivaPct }))
