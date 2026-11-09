// supabase/functions/_shared/cobro/liquidacion.ts
//
// G05 · Tarea 2 (09/11/2026). LA LIQUIDACIÓN DE GOCARDLESS EN EL BANCO, hecha
// asiento. GoCardless ingresa de una vez lo cobrado de varios clientes menos
// su comisión. Ese ingreso, en la contabilidad de cada empresa:
//   · banco (572) al DEBE, por lo que llega de verdad;
//   · cada cliente (su 430) al HABER, por lo que pagó (el cobro de su factura);
//   · la comisión (626) al DEBE, por diferencia: así el asiento cuadra siempre
//     con el banco (GoCardless guarda las comisiones con décimas de céntimo y
//     redondea la suma; decisiones_qbo.md: en la demo, solo 626);
//   · un devuelto después de cobrado (retrocedido) se deshace: su 430 al DEBE,
//     y el cliente vuelve a «Te deben».
// Lo que no se sabe contabilizar (un reembolso sin cobro, un reparto de
// comisiones de socio) NO se inventa: la liquidación queda parada y lo dice.
//
// De la documentación de GoCardless (api-reference/payout-item, 09/11): cada
// partida trae su importe en céntimos con un decimal, positivo (entra) o
// negativo (sale), su tipo y su cobro. Puro.
//
// Lo prueban tests/unit/modules/conta/gestoria/g05/liquidacion.test.ts.

import { euros } from '../tarifa/precio.ts'

export interface Partida {
  tipo: string
  /** En céntimos, con un decimal, como lo da GoCardless («4.0», «-24.0»). */
  importe: string
  cobroId: string | null
}

/** Lo que Sumied sabe de cada cobro: de qué cliente y factura es. */
export interface CobroConocido { clienteId: string; cliente: string; factura: string | null }

export interface LineaDeAsiento {
  /** Qué cuenta: el banco, la 430 del cliente o la comisión. La base pone el código de cada empresa. */
  cuenta: 'banco' | 'cliente' | 'comision'
  clienteId: string | null
  concepto: string
  debeCent: number
  haberCent: number
}

export interface AsientoDeLiquidacion {
  lineas: LineaDeAsiento[]
  /** Lo que llega al banco (el importe de la liquidación). */
  bancoCent: number
  comisionCent: number
  cobrosCent: number
  devueltosCent: number
  /** Lo que impide hacer el asiento, en palabras. Vacío: se puede validar. */
  parado: string[]
}

/** «4.0» o «-24.5» en décimas de céntimo (enteros, para no perder la décima). */
const decimas = (x: string) => Math.round(Number(x) * 10)

const DE_CLIENTE_ENTRA = new Set(['payment_paid_out'])
const DE_CLIENTE_SALE = new Set(['payment_failed', 'payment_charged_back', 'payment_refunded'])
const DE_COMISION = new Set(['gocardless_fee', 'app_fee', 'surcharge_fee'])

/**
 * El asiento de una liquidación. `bancoCent`: lo que dice GoCardless que ingresa
 * (y lo que tiene que traer el banco). `documento`: su referencia.
 */
export function asientoDeLiquidacion(bancoCent: number, documento: string, partidas: Partida[], cobros: ReadonlyMap<string, CobroConocido>): AsientoDeLiquidacion {
  const parado: string[] = []
  const porCliente = new Map<string, { cliente: CobroConocido; entra: number; sale: number; facturas: Set<string> }>()
  let comisionDecimas = 0
  for (const p of partidas) {
    const d = decimas(p.importe)
    if (DE_COMISION.has(p.tipo)) { comisionDecimas -= d; continue } // un cargo de comisión viene en negativo; su devolución, en positivo
    const entra = DE_CLIENTE_ENTRA.has(p.tipo); const sale = DE_CLIENTE_SALE.has(p.tipo)
    if (!entra && !sale) { parado.push(`Hay una partida de GoCardless que Sumied no sabe contabilizar («${p.tipo}», ${euros(Math.round(d / 10))})`); continue }
    const c = p.cobroId ? cobros.get(p.cobroId) : undefined
    if (!c) { parado.push(`Un cobro de ${euros(Math.round(Math.abs(d) / 10))} no es de ningún recibo de Sumied`); continue }
    if (d % 10 !== 0) { parado.push(`El cobro de ${c.cliente} trae décimas de céntimo`); continue }
    const x = porCliente.get(c.clienteId) ?? { cliente: c, entra: 0, sale: 0, facturas: new Set<string>() }
    if (entra) x.entra += d / 10; else x.sale += -d / 10
    if (c.factura) x.facturas.add(c.factura)
    porCliente.set(c.clienteId, x)
  }
  const cobrosCent = [...porCliente.values()].reduce((s, x) => s + x.entra, 0)
  const devueltosCent = [...porCliente.values()].reduce((s, x) => s + x.sale, 0)
  // La comisión, por diferencia con el banco: lo que de verdad se quedó GoCardless.
  const comisionCent = cobrosCent - devueltosCent - bancoCent
  // Comprobación: la diferencia tiene que ser la suma de sus comisiones, redondeada (como redondea GoCardless la liquidación).
  if (!parado.length && Math.abs(comisionCent - Math.round(comisionDecimas / 10)) > 1) {
    parado.push(`Lo que llega al banco (${euros(bancoCent)}) no cuadra con los cobros menos la comisión que dice GoCardless`)
  }
  const lineas: LineaDeAsiento[] = []
  if (bancoCent > 0) lineas.push({ cuenta: 'banco', clienteId: null, concepto: `Liquidación de GoCardless ${documento}`, debeCent: bancoCent, haberCent: 0 })
  if (bancoCent < 0) lineas.push({ cuenta: 'banco', clienteId: null, concepto: `Liquidación de GoCardless ${documento}`, debeCent: 0, haberCent: -bancoCent })
  if (comisionCent > 0) lineas.push({ cuenta: 'comision', clienteId: null, concepto: `Comisión de GoCardless ${documento}`, debeCent: comisionCent, haberCent: 0 })
  // GoCardless devuelve la comisión de los cobros que fallan: si devuelve más de lo que cobra, va al haber.
  if (comisionCent < 0) lineas.push({ cuenta: 'comision', clienteId: null, concepto: `Comisión devuelta por GoCardless ${documento}`, debeCent: 0, haberCent: -comisionCent })
  const ordenados = [...porCliente.values()].sort((a, b) => a.cliente.cliente.localeCompare(b.cliente.cliente, 'es'))
  for (const x of ordenados) {
    const facturas = [...x.facturas].sort().join(', ')
    if (x.entra) lineas.push({ cuenta: 'cliente', clienteId: x.cliente.clienteId, concepto: `Cobro${facturas ? ` de la ${facturas}` : ''} por GoCardless`, debeCent: 0, haberCent: x.entra })
    if (x.sale) lineas.push({ cuenta: 'cliente', clienteId: x.cliente.clienteId, concepto: `Devuelto${facturas ? ` de la ${facturas}` : ''} por GoCardless`, debeCent: x.sale, haberCent: 0 })
  }
  const debe = lineas.reduce((s, l) => s + l.debeCent, 0); const haber = lineas.reduce((s, l) => s + l.haberCent, 0)
  if (debe !== haber && !parado.length) parado.push(`El asiento no cuadra: ${euros(debe)} al debe y ${euros(haber)} al haber`)
  return { lineas, bancoCent, comisionCent, cobrosCent, devueltosCent, parado }
}
