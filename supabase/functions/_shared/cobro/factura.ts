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
//   · LA FACTURA Y EL COBRO, AL CÉNTIMO, Y LO QUE PAGA EL CLIENTE NO CAMBIA
//     (Julio, nº 62). Si la tarifa de la gestoría lleva el IVA dentro (QBO:
//     96,80 € = 80 € + 21 %), se busca la base que, con su IVA redondeado, da
//     justo el total del recibo. Lo normal es que exista. Si no (unos 17 de cada 100
//     totales con el 21 %, como 145,00 €, no salen con ningún céntimo de base: 119,83 da 144,99 y
//     119,84, 145,01), la base es la más cercana y el IVA, lo que falta hasta el
//     total (119,83 + 25,17 = 145,00): un céntimo sobre base × tipo, dentro del
//     margen que acepta Verifactu en la cuota (±10 €). Se cobra y se factura
//     145,00 €: no es un cambio. La cuota de cada línea va en la factura
//     (ivaCent) y la base la guarda en sus líneas (customer_invoice_line.
//     tax_amount, V01b), así que el asiento, el libro y Verifactu la toman tal
//     cual. Nunca una factura que no cuadra con su cobro.
//   · Si la tarifa va sin IVA, la base es la tarifa y se cobra base + IVA.
//   · La retención (si el emisor la aplica) se resta del total, como en la V01.
//
// Lo prueban tests/unit/modules/conta/gestoria/g05/factura.test.ts.

import { euros } from '../tarifa/precio.ts'
import type { LineaDeRecibo, Recibo } from './recibo.ts'

/** Las retenciones de IRPF que puede aplicar un emisor (Julio, nº 31): sin retención, 15 % o 7 % (profesionales que empiezan). */
export const RETENCIONES = [0, 15, 7] as const

/** Cómo factura la empresa emisora. */
export interface Fiscal {
  /** El IVA de sus servicios, en % (21). */
  ivaPct: number
  /** La retención de IRPF que aplica, en %: 0, 15 o 7 (RETENCIONES). Va en su línea de la factura y en la 4730 del asiento. */
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
 * La base y el IVA de un total con el IVA dentro, al céntimo. Lo normal es que haya
 * una base cuyo IVA redondeado da justo el total (exacta). Si no la hay, la
 * base más cercana y el IVA lo que falta hasta el total: el que se aparta menos
 * de base × tipo (un céntimo). El total es siempre el del recibo.
 */
export function baseParaElTotal(totalCent: number, f: Fiscal): { baseCent: number; ivaCent: number; exacta: boolean } {
  const k = 1 + (f.ivaPct - f.retencionPct) / 100
  const cerca = Math.round(totalCent / k)
  for (const d of [0, -1, 1, -2, 2, -3, 3]) if (totalConBase(cerca + d, f) === totalCent) return { baseCent: cerca + d, ivaCent: cuotaDe(cerca + d, f.ivaPct), exacta: true }
  // Ningún céntimo de base da el total: la base cuyo IVA «lo que falta» se aparta menos de base × tipo.
  const forzado = (b: number) => totalCent - b + cuotaDe(b, f.retencionPct)
  const mejor = [0, -1, 1, -2, 2, -3, 3].map((d) => cerca + d)
    .reduce((m, b) => (Math.abs(forzado(b) - (b * f.ivaPct) / 100) < Math.abs(forzado(m) - (m * f.ivaPct) / 100) ? b : m))
  return { baseCent: mejor, ivaCent: forzado(mejor), exacta: false }
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
  /** La cuota de IVA de la línea, en céntimos: las de todas suman el IVA de la factura (la base la guarda en la línea). */
  ivaCent: number
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
  /** Lo que dirá la factura: lo que se cobra en GoCardless. Siempre el total del recibo. */
  totalCent: number
  /**
   * Cuando ninguna base da el total con su IVA redondeado: cuánto se aparta la
   * cuota de base × tipo redondeado (un céntimo) y por qué. No es un cambio: el
   * cliente paga lo mismo. Null si sale exacto.
   */
  cuotaAjustada: null | { cent: number; porque: string }
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

/**
 * La cuota de cada línea: su base × tipo redondeada, y el céntimo que sobre o
 * falte hasta el IVA de la factura, a la misma línea que recibe el de la base
 * (la de más importe que no va por trabajador). Así suman justo el IVA.
 */
function repartirCuota(bases: number[], porTrabajador: boolean[], ivaTotal: number, pct: number): number[] {
  const partes = bases.map((b) => cuotaDe(b, pct))
  const dif = ivaTotal - partes.reduce((s, x) => s + x, 0)
  if (dif !== 0 && partes.length) {
    const candidatas = bases.map((x, i) => ({ x, i })).filter((c) => !porTrabajador[c.i])
    const elegida = (candidatas.length ? candidatas : bases.map((x, i) => ({ x, i }))).reduce((m, c) => (c.x > m.x ? c : m))
    partes[elegida.i] += dif
  }
  return partes
}

/** Las líneas, las cifras y los trabajadores de la factura de un recibo. Lanza si el recibo está parado. */
export function facturaDelRecibo(r: Recibo, f: Fiscal): FacturaDelRecibo {
  if (r.parado.length) throw new Error(`Un recibo parado no se factura: ${r.parado.join('; ')}.`)
  if (!(RETENCIONES as readonly number[]).includes(f.retencionPct)) throw new Error(`La retención tiene que ser sin retención, 15 % o 7 %, no ${f.retencionPct} %.`)
  const importes = r.lineas.map((l) => l.importeCent ?? 0)
  let baseTotal: number
  let ivaTotal: number
  let cuotaAjustada: FacturaDelRecibo['cuotaAjustada'] = null
  if (f.preciosConIva) {
    const b = baseParaElTotal(r.totalCent, f)
    baseTotal = b.baseCent
    ivaTotal = b.ivaCent
    if (!b.exacta) {
      const dif = ivaTotal - cuotaDe(baseTotal, f.ivaPct)
      cuotaAjustada = { cent: dif, porque: `${euros(r.totalCent)} no sale con ninguna base y su IVA redondeado: base ${euros(baseTotal)} e IVA ${euros(ivaTotal)} (${dif > 0 ? 'un céntimo más' : 'un céntimo menos'} que ${euros(cuotaDe(baseTotal, f.ivaPct))}, dentro del margen de Verifactu). Se cobra y se factura ${euros(r.totalCent)}` }
    }
  } else {
    baseTotal = r.totalCent
    ivaTotal = cuotaDe(baseTotal, f.ivaPct)
  }
  const conTrabajadores = r.lineas.map((l) => !!l.trabajadores && l.trabajadores.length > 0)
  const bases = f.preciosConIva ? repartir(importes, conTrabajadores, baseTotal) : importes
  const cuotas = repartirCuota(bases, conTrabajadores, ivaTotal, f.ivaPct)
  const lineas: LineaDeFactura[] = r.lineas.map((l, i) => {
    const n = l.trabajadores?.length ?? 0
    // «Cantidad × precio» solo si sale exacto al céntimo: n trabajadores al mismo precio.
    const porUno = n > 0 && bases[i] % n === 0 && /^\d+ × /.test(l.cuenta)
    const trabajadores = l.trabajadores && n ? l.trabajadores.map((t) => ({ nombre: t.nombre, desde: t.altaEl })) : null
    return {
      concepto: conceptoDe(l), cantidad: porUno ? n : 1, precioCent: porUno ? bases[i] / n : bases[i], baseCent: bases[i], ivaPct: f.ivaPct, ivaCent: cuotas[i],
      asignacionId: l.asignacionId, trabajadores, trabajadoresEn: trabajadores ? (n > TRABAJADORES_EN_LA_LINEA ? 'hoja' : 'linea') : null,
    }
  })
  const retencionCent = cuotaDe(baseTotal, f.retencionPct)
  const totalCent = baseTotal + ivaTotal - retencionCent
  if (f.preciosConIva && totalCent !== r.totalCent) throw new Error(`La factura saldría por ${euros(totalCent)} y el recibo es de ${euros(r.totalCent)}.`)
  return {
    lineas, baseCent: baseTotal, ivaCent: ivaTotal, retencionCent, totalCent, cuotaAjustada,
    hoja: lineas.filter((l) => l.trabajadoresEn === 'hoja').map((l) => ({ servicio: sinTrabajadores(r.lineas.find((x) => x.asignacionId === l.asignacionId)!.texto), trabajadores: l.trabajadores! })),
  }
}

/** Las líneas como las recibe conta_venta_guardar (precio en euros con 4 decimales; el tipo y la cuenta los pone la base). */
export const lineasParaGuardar = (fa: FacturaDelRecibo) =>
  fa.lineas.map((l) => ({ concepto: l.concepto, cantidad: l.cantidad, precio: l.precioCent / 100, descuento: 0, iva_pct: l.ivaPct, cuota: l.ivaCent / 100 }))
