// src/modules/conta/lib/traer/casarPagos.ts
//
// N09 · Lo que de verdad le queda por pagar o cobrar a cada factura traída de ERP10, casando cada
// pago o cobro del diario con su factura. Antes (N04, pendientesPorSaldo) se repartía el saldo del
// tercero entre sus últimas facturas: una factura con pago parcial, o una vieja sin pagar con otra nueva
// pagada, salían mal.
//
// De dónde se sabe (medido con los ficheros de ejemplo del N04): del DIARIO. ERP10 no da cartera en lo
// que ya traemos; los libros de IVA no dicen nada del pago; el sumas y saldos da el saldo de cada
// tercero, que sirve para comprobar, no para casar. Un pago es un apunte en la cuenta del tercero por
// el otro lado del de su factura (al DEBE de la 400/410, al HABER de la 430/440), y ERP10 escribe en su
// concepto el número de la factura («Pago A-10», «Cobro F-1»). Se casa así, sin adivinar nada:
//
//   1. por documento: el concepto del pago lleva el número de UNA factura suya con algo pendiente, y el
//      pago no pasa de lo que le queda → se descuenta de esa (pagada entera o con pago parcial; dos pagos a
//      la misma factura se descuentan los dos);
//   2. un pago de VARIAS facturas: su concepto lleva varios números y el importe es justo la suma de lo
//      que les queda → todas pagadas;
//   3. sin número en el concepto: por importe, si es justo lo que le queda a UNA SOLA factura suya;
//   4. lo demás no se casa: el pago queda «sin casar», sus facturas entran como estén (pendientes
//      enteras si no las tocó otro pago), marcadas, y el paso 3 lo cuenta.
//
// La comprobación: lo pendiente de las facturas de cada tercero tiene que dar su saldo en el sumas y
// saldos de ERP10 (si se trajo; si no, el del diario). Si no da igual, se dice.

import { cifra } from './excel'
import type { DiarioLeido, Factura, SumasLeidas, Tercero } from './leer'
import type { Pendiente } from './aprender'

export type ComoQueda = 'pagada' | 'a_medias' | 'pendiente'

export interface FacturaConPagos {
  numero: string
  fecha: string
  nif: string
  /** Lo que se le debe (o nos debe) entera: su total menos la retención. */
  aPagar: number
  /** Lo que le queda, en céntimos. */
  pendiente: number
  como: ComoQueda
  /** Su tercero tiene pagos que no se han podido casar: lo que le queda no es seguro. */
  conPagosSinCasar: boolean
}

export interface PagoSinCasar { fecha: string; importe: number; concepto: string; porque: string }

export interface TerceroCasado {
  codigo: string
  nombre: string
  clase: 'proveedor' | 'cliente'
  facturas: FacturaConPagos[]
  pagosSinCasar: PagoSinCasar[]
  /** Lo pendiente de sus facturas, sumado. */
  pendiente: number
  /** Su saldo en ERP10: el del sumas y saldos si se trajo; si no, el del diario. */
  saldo: number
  saldoDe: 'sumas' | 'diario'
  /** Lo pendiente da igual que su saldo. */
  cuadra: boolean
  /** Tiene apuntes en el diario. */
  conMovimientos: boolean
}

/** Lo que se debe de una factura: su total menos la retención (la retención no se paga al tercero). */
const aPagar = (f: Factura) => f.total - (f.retencion?.importe ?? 0)

const sinAcentos = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()

/** ¿Lleva el concepto este número de factura, entero (no «A-10» dentro de «A-100»)? */
export function llevaNumero(concepto: string, numero: string): boolean {
  const n = sinAcentos(numero).trim()
  if (!n) return false
  const c = sinAcentos(concepto)
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Z0-9])${esc}($|[^A-Z0-9])`).test(c)
}

export function casarPagos(diario: DiarioLeido, terceros: readonly { t: Tercero; clase: 'proveedor' | 'cliente' }[], facturas: readonly Factura[], sumas: SumasLeidas | null): TerceroCasado[] {
  const deSumas = new Map((sumas?.filas ?? []).map((f) => [f.subcuenta, f]))
  return terceros.map(({ t, clase }) => {
    const suyas = facturas.filter((f) => f.nif && t.nif && f.nif === t.nif).sort((a, b) => a.expedicion.localeCompare(b.expedicion) || a.numero.localeCompare(b.numero))
    const pend = new Map(suyas.map((f) => [f, aPagar(f)]))
    // Los pagos (o cobros): sus apuntes por el otro lado del de sus facturas, por fecha.
    const apuntes = diario.asientos.flatMap((a) => a.apuntes.filter((x) => x.subcuenta === t.codigo).map((x) => ({ fecha: a.fecha, ...x })))
    const pagos = apuntes.filter((x) => (clase === 'proveedor' ? x.debe : x.haber) > 0).sort((a, b) => a.fecha.localeCompare(b.fecha))
    let saldoDiario = 0
    for (const x of apuntes) saldoDiario += clase === 'proveedor' ? x.haber - x.debe : x.debe - x.haber
    const sinCasar: PagoSinCasar[] = []
    for (const p of pagos) {
      const m = clase === 'proveedor' ? p.debe : p.haber
      const vivas = suyas.filter((f) => (pend.get(f) ?? 0) > 0)
      const nombradas = vivas.filter((f) => llevaNumero(p.concepto, f.numero))
      if (nombradas.length === 1) {
        const f = nombradas[0]
        if (m <= pend.get(f)!) { pend.set(f, pend.get(f)! - m); continue }
        sinCasar.push({ fecha: p.fecha, importe: m, concepto: p.concepto, porque: `es de más que lo que le queda a la ${f.numero}` }); continue
      }
      if (nombradas.length > 1) {
        const suma = nombradas.reduce((s, f) => s + pend.get(f)!, 0)
        if (m === suma) { for (const f of nombradas) pend.set(f, 0); continue }
        sinCasar.push({ fecha: p.fecha, importe: m, concepto: p.concepto, porque: `nombra ${nombradas.map((f) => f.numero).join(' y ')} y no es lo que les queda a todas` }); continue
      }
      const porImporte = vivas.filter((f) => pend.get(f) === m)
      if (porImporte.length === 1 && !suyas.some((f) => llevaNumero(p.concepto, f.numero))) { pend.set(porImporte[0], 0); continue }
      sinCasar.push({ fecha: p.fecha, importe: m, concepto: p.concepto,
        porque: porImporte.length > 1 ? `hay ${porImporte.length} facturas suyas de ese importe` : 'no nombra ninguna factura suya y no es lo que le queda a ninguna' })
    }
    const casadas: FacturaConPagos[] = suyas.map((f) => {
      const p = pend.get(f) ?? 0
      return { numero: f.numero, fecha: f.expedicion, nif: f.nif!, aPagar: aPagar(f), pendiente: p,
        como: p === 0 ? 'pagada' : p < aPagar(f) ? 'a_medias' : 'pendiente', conPagosSinCasar: sinCasar.length > 0 && p > 0 }
    })
    const fila = deSumas.get(t.codigo)
    const saldo = fila ? (clase === 'proveedor' ? fila.acreedor - fila.deudor : fila.deudor - fila.acreedor) : saldoDiario
    const pendiente = casadas.reduce((s, f) => s + f.pendiente, 0)
    return { codigo: t.codigo, nombre: t.nombreFiscal, clase, facturas: casadas, pagosSinCasar: sinCasar, pendiente, saldo, saldoDe: fila ? 'sumas' : 'diario', cuadra: pendiente === saldo, conMovimientos: apuntes.length > 0 }
  })
}

/** La frase de un tercero que no cuadra o tiene pagos sin casar (la del paso 3 y la de «Qué mirar»). */
export function fraseDelTercero(t: TerceroCasado): string {
  const quien = `${t.codigo} · ${t.nombre}`
  const partes: string[] = []
  if (t.pagosSinCasar.length) {
    partes.push(`${t.pagosSinCasar.length === 1 ? 'un pago que no he podido casar' : `${t.pagosSinCasar.length} pagos que no he podido casar`} (${t.pagosSinCasar.map((p) => `${cifra(p.importe)} del ${p.fecha.split('-').reverse().join('/')}: ${p.porque}`).join('; ')})`)
  }
  if (!t.cuadra) {
    partes.push(`lo que le queda por ${t.clase === 'cliente' ? 'cobrar' : 'pagar'} de sus facturas, ${cifra(t.pendiente)}, no da igual que su saldo en ${t.saldoDe === 'sumas' ? 'el sumas y saldos' : 'el diario'}, ${cifra(t.saldo)}`)
  }
  if (partes.length) return `${quien}: ${partes.join('; y ')}. Míralas.`
  // Cuadra: lo que dice de siempre (N04).
  if (!t.conMovimientos) return `${quien}: sin movimientos en el diario.`
  if (t.saldo === 0) return `${quien}: está a cero.`
  if (t.saldo < 0) return `${quien}: el saldo va al revés (${cifra(-t.saldo)} ${t.clase === 'cliente' ? 'a su favor' : 'a nuestro favor'}).`
  const pend = t.facturas.filter((f) => f.pendiente > 0).sort((a, b) => b.fecha.localeCompare(a.fecha))
  return `${quien}: ${t.clase === 'cliente' ? 'nos debe' : 'se le deben'} ${cifra(t.saldo)}`
    + (pend.length ? `, ${pend.length === 1 ? 'de la factura' : 'de las facturas'} ${pend.map((x) => x.como === 'a_medias' ? `${x.numero} (con pago parcial: le quedan ${cifra(x.pendiente)})` : x.numero).join(', ')}.` : ', y no hay facturas suyas en el libro para repartirlo.')
}

/**
 * Lo pendiente de cada tercero en la forma de siempre (Pendiente, la del N04, que lee paraLaBase), ahora
 * desde el casado: sus facturas con algo pendiente, y «no cuadra exacto» si hay pagos sin casar o lo
 * pendiente no da su saldo. Con dos datos más para el paso 3: las facturas con pagos sin casar y si cuadra.
 */
export function pendientesPorPagos(diario: DiarioLeido, terceros: readonly { t: Tercero; clase: 'proveedor' | 'cliente' }[], facturas: readonly Factura[], sumas: SumasLeidas | null): Pendiente[] {
  return casarPagos(diario, terceros, facturas, sumas).map((t) => ({
    codigo: t.codigo, nombre: t.nombre, clase: t.clase, saldo: t.saldo,
    facturas: t.facturas.filter((f) => f.pendiente > 0).sort((a, b) => b.fecha.localeCompare(a.fecha)).map((f) => ({ numero: f.numero, fecha: f.fecha, pendiente: f.pendiente })),
    cuadraExacto: t.cuadra && t.pagosSinCasar.length === 0,
    frase: fraseDelTercero(t),
    facturasSinCasar: t.facturas.filter((f) => f.conPagosSinCasar).map((f) => f.numero),
    cuadraConSaldo: t.cuadra,
  }))
}
