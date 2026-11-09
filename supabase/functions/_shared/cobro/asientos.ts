// supabase/functions/_shared/cobro/asientos.ts
//
// G05 · Tarea 2 (09/11/2026). LOS ASIENTOS DEL COBRO, cada empresa en sus
// libros, con las subcuentas de cada una (decisiones_qbo.md, 09/11: salen de
// dos asientos reales de Cegid de QBO). Puro: dice qué líneas lleva cada
// asiento; los escribe la base con el motor de asientos que ya tiene Sumied.
//
//   · Factura:   430 cliente / 705 + 477.  (La escribe la V01 al emitir; aquí,
//                las líneas que tiene que dar, para comprobarlas y enseñarlas.)
//   · Cobro confirmado:  57200002 «Plataforma GoCardless» / 430 cliente, por
//                el importe entero.
//   · Ingreso de GoCardless en el banco:  572 banco / 57200002, por lo que
//                llega (el neto). Es lo que se concilia en Bancos.
//   · Devolución (devuelto o retrocedido después de contabilizar el cobro):
//                430 cliente / 57200002, y el cliente vuelve a «Te deben».
//   · LA COMISIÓN NO SE CONTABILIZA AQUÍ: GoCardless SAS manda una factura al
//     mes con todas sus comisiones, ya descontadas de los ingresos; se registra
//     como factura recibida (629 con inversión del sujeto pasivo / 400) y se
//     paga 400 / 57200002. No entra en el G05 del 17/11: mientras, la 57200002
//     se queda con el saldo de las comisiones. QBO aún tiene que confirmar lo
//     de la 57200002 (punto 15 de sus decisiones); mientras, se hace así.
//
// Lo que no se sabe contabilizar NO se inventa: el asiento queda parado y lo dice.
// Lo prueban tests/unit/modules/conta/gestoria/g05/asientos.test.ts.

import { euros } from '../tarifa/precio.ts'

/** Las subcuentas de una empresa para el cobro. En QBO (y en la demo): 430 + código de 5 cifras, 70500000, 47700021, 57200002. */
export interface CuentasDelCobro {
  /** El principio de la subcuenta de cada cliente («430») y cuántas cifras tiene entera (8). */
  prefijoCliente: string
  cifras: number
  ingresos: string
  ivaRepercutido: string
  retencion: string | null
  plataforma: string
  banco: string
}

export const CUENTAS_DE_QBO: Omit<CuentasDelCobro, 'banco'> = {
  prefijoCliente: '430', cifras: 8, ingresos: '70500000', ivaRepercutido: '47700021', retencion: null, plataforma: '57200002',
}

/** La subcuenta de un cliente: el prefijo y su código, con ceros en medio (cliente 827 → 43000827). */
export function subcuentaDelCliente(c: Pick<CuentasDelCobro, 'prefijoCliente' | 'cifras'>, codigo: number | string): string {
  const cod = String(codigo).trim()
  if (!/^\d+$/.test(cod) || Number(cod) <= 0) throw new Error(`El código de cliente «${cod}» tiene que ser un número.`)
  const hueco = c.cifras - c.prefijoCliente.length
  if (cod.replace(/^0+/, '').length > hueco) throw new Error(`El código de cliente ${cod} no cabe en una subcuenta de ${c.cifras} cifras que empieza por ${c.prefijoCliente}.`)
  return `${c.prefijoCliente}${cod.replace(/^0+/, '').padStart(hueco, '0')}`
}

export interface LineaDeAsiento { cuenta: string; concepto: string; debeCent: number; haberCent: number }

export interface Asiento {
  lineas: LineaDeAsiento[]
  /** Lo que impide hacerlo, en palabras. Vacío: se puede validar. */
  parado: string[]
}

const cuadra = (lineas: LineaDeAsiento[]) => lineas.reduce((s, l) => s + l.debeCent - l.haberCent, 0) === 0
const conCuadre = (lineas: LineaDeAsiento[], parado: string[] = []): Asiento => {
  if (!parado.length && !cuadra(lineas)) {
    const d = lineas.reduce((s, l) => s + l.debeCent, 0); const h = lineas.reduce((s, l) => s + l.haberCent, 0)
    parado.push(`El asiento no cuadra: ${euros(d)} al debe y ${euros(h)} al haber`)
  }
  return { lineas, parado }
}

/** El cliente de un asiento: su subcuenta y su nombre (para el concepto). */
export interface ClienteDelAsiento { cuenta: string; nombre: string }

/** La factura: 430 cliente al debe por el total; 705 por la base y 477 por el IVA al haber (y la retención, si la hay, al debe). */
export function asientoDeLaFactura(c: CuentasDelCobro, cliente: ClienteDelAsiento, numero: string, cifras: { baseCent: number; ivaCent: number; retencionCent: number; totalCent: number }): Asiento {
  const lineas: LineaDeAsiento[] = [{ cuenta: cliente.cuenta, concepto: `Factura ${numero} · ${cliente.nombre}`, debeCent: cifras.totalCent, haberCent: 0 }]
  const parado: string[] = []
  if (cifras.retencionCent) {
    if (!c.retencion) parado.push('La factura lleva retención y la empresa no tiene su cuenta de retenciones')
    else lineas.push({ cuenta: c.retencion, concepto: `Retención factura ${numero}`, debeCent: cifras.retencionCent, haberCent: 0 })
  }
  lineas.push({ cuenta: c.ingresos, concepto: `Factura ${numero}`, debeCent: 0, haberCent: cifras.baseCent })
  if (cifras.ivaCent) lineas.push({ cuenta: c.ivaRepercutido, concepto: `IVA factura ${numero}`, debeCent: 0, haberCent: cifras.ivaCent })
  return conCuadre(lineas, parado)
}

/** El cobro confirmado: 57200002 «Plataforma GoCardless» al debe, 430 del cliente al haber, por el importe entero. */
export function asientoDelCobro(c: CuentasDelCobro, cliente: ClienteDelAsiento, numero: string, importeCent: number): Asiento {
  if (!Number.isInteger(importeCent) || importeCent <= 0) return { lineas: [], parado: ['El cobro tiene que ser mayor que cero'] }
  return conCuadre([
    { cuenta: c.plataforma, concepto: `Cobro por GoCardless de la ${numero}`, debeCent: importeCent, haberCent: 0 },
    { cuenta: cliente.cuenta, concepto: `Cobro de la ${numero} · ${cliente.nombre}`, debeCent: 0, haberCent: importeCent },
  ])
}

/** La devolución de un cobro ya contabilizado: se deshace (430 al debe, 57200002 al haber) y el cliente vuelve a «Te deben». */
export function asientoDeLaDevolucion(c: CuentasDelCobro, cliente: ClienteDelAsiento, numero: string, importeCent: number, retrocedido: boolean): Asiento {
  if (!Number.isInteger(importeCent) || importeCent <= 0) return { lineas: [], parado: ['La devolución tiene que ser mayor que cero'] }
  const que = retrocedido ? 'Retrocedido' : 'Devuelto'
  return conCuadre([
    { cuenta: cliente.cuenta, concepto: `${que} el cobro de la ${numero} · ${cliente.nombre}`, debeCent: importeCent, haberCent: 0 },
    { cuenta: c.plataforma, concepto: `${que} por GoCardless de la ${numero}`, debeCent: 0, haberCent: importeCent },
  ])
}

/** Una partida de la liquidación de GoCardless (api-reference/payout-item, 09/11): céntimos con un decimal, + entra, − sale. */
export interface Partida { tipo: string; importe: string; cobroId: string | null }

const DE_CLIENTE = new Set(['payment_paid_out', 'payment_failed', 'payment_charged_back', 'payment_refunded'])
const DE_COMISION = new Set(['gocardless_fee', 'app_fee', 'surcharge_fee'])

export interface AsientoDelIngreso extends Asiento {
  bancoCent: number
  /** Lo que GoCardless se ha quedado de comisión en esta liquidación: el saldo que deja en la 57200002 hasta su factura mensual. */
  comisionCent: number
}

/**
 * El ingreso de GoCardless en el banco: 572 banco / 57200002, por lo que
 * llega. Antes, comprueba que lo que llega es lo cobrado menos lo devuelto y
 * menos sus comisiones (GoCardless guarda las comisiones con décimas de
 * céntimo y redondea la suma), y que cada cobro es de un recibo de Sumied: un
 * cobro que no es de Sumied (una suscripción que sigue viva en GoCardless) se
 * dice, no se mezcla.
 */
export function asientoDelIngreso(c: CuentasDelCobro, bancoCent: number, documento: string, partidas: Partida[], cobrosDeSumied: ReadonlySet<string>): AsientoDelIngreso {
  const parado: string[] = []
  let decimas = 0; let deClientesDecimas = 0
  for (const p of partidas) {
    const d = Math.round(Number(p.importe) * 10)
    decimas += d
    if (DE_COMISION.has(p.tipo)) continue
    if (!DE_CLIENTE.has(p.tipo)) { parado.push(`Hay una partida de GoCardless que Sumied no sabe contabilizar («${p.tipo}», ${euros(Math.round(d / 10))})`); continue }
    deClientesDecimas += d
    if (!p.cobroId || !cobrosDeSumied.has(p.cobroId)) parado.push(`Un cobro de ${euros(Math.round(Math.abs(d) / 10))} no es de ningún recibo de Sumied: ¿sigue viva una suscripción en GoCardless?`)
  }
  if (!parado.length && Math.round(decimas / 10) !== bancoCent) {
    parado.push(`Lo que llega al banco (${euros(bancoCent)}) no es lo que suman sus cobros, devoluciones y comisiones (${euros(Math.round(decimas / 10))})`)
  }
  const lineas: LineaDeAsiento[] = bancoCent >= 0
    ? [{ cuenta: c.banco, concepto: `Ingreso de GoCardless ${documento}`, debeCent: bancoCent, haberCent: 0 }, { cuenta: c.plataforma, concepto: `Ingreso de GoCardless ${documento}`, debeCent: 0, haberCent: bancoCent }]
    : [{ cuenta: c.plataforma, concepto: `Cargo de GoCardless ${documento}`, debeCent: -bancoCent, haberCent: 0 }, { cuenta: c.banco, concepto: `Cargo de GoCardless ${documento}`, debeCent: 0, haberCent: -bancoCent }]
  // Lo que se ha quedado GoCardless: lo cobrado (menos lo devuelto) y lo que llega, al céntimo de verdad.
  return { ...conCuadre(bancoCent === 0 ? [] : lineas, parado), bancoCent, comisionCent: Math.round(deClientesDecimas / 10) - bancoCent }
}
