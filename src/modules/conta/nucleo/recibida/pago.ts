// src/modules/conta/nucleo/recibida/pago.ts
//
// K06 · «Cómo se paga» es la cuenta del pago (Julio, 19/11: «los pagos pueden
// ser por más que bancos»). Lo que decide la ficha de la recibida, sin React ni
// red, como «Cómo se cobra» en la emitida (K05):
//
//   · La PROPUESTA (K10, Julio, 21/11: como en ERP10): la «Cuenta de pago» de
//     la ficha del proveedor; si no la tiene, la del último pago; si no hay
//     ninguna, vacía (pendiente de pagar). Si sus últimos pagos van por más de
//     una cuenta, la duda en ámbar. La «plataforma» ya no se propone: su 430
//     pasó a la ficha con la tanda del K10.
//   · Qué HACE al guardar la cuenta que hay en la casilla:
//       - un banco, una tarjeta o la caja de la empresa (su tesorería): lo
//         mismo que «Ya la he pagado» de Pagos (conta_pago_a_mano): queda
//         esperando el cargo, y al casarlo en Bancos lleva su asiento;
//       - la 430 de la plataforma: «Compensación con la liquidación» (la forma
//         de pago de la 0790, como hoy): al validarla queda pagada con el
//         asiento de su liquidación;
//       - otra cuenta (la 551 del socio…): el asiento del pago, validado, y la
//         factura pagada (conta_recibida_pagar_con_cuenta, K06);
//       - vacía, sin fecha o con la fecha después de hoy: pendiente de pagar.

import type { TonoEstado } from '../ficha/piezas'

const fechaEs = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** De dónde sale la cuenta propuesta (el rótulo pequeño, en gris). */
export type OrigenPago = 'De su ficha' | 'La del último pago'

export interface DatosPropuestaPago {
  /** K10 · La «Cuenta de pago» de la ficha del proveedor en esta empresa (company_account_link, papel «pago»), o null. */
  deLaFicha: string | null
  /** Las cuentas de sus últimos pagos, del más nuevo al más viejo (sin las compensaciones). */
  ultimas: readonly string[]
}

export interface PropuestaPago {
  /** '' = pendiente de pagar. */
  cuenta: string
  origen: OrigenPago | null
  /** Las cuentas por las que ha pagado al proveedor, si son más de una (la duda en ámbar); null si no hay duda. */
  duda: { cuentas: string[] } | null
}

/** Cuántos pagos de antes se miran para la duda. */
export const PAGOS_PARA_LA_DUDA = 5

/**
 * K10 · La cuenta del pago que se propone, como en ERP10:
 *   1. la «Cuenta de pago» de su ficha;
 *   2. si no la tiene, la de su último pago; si los últimos van por más de una cuenta, la duda;
 *   3. sin ninguna, vacía (pendiente de pagar).
 */
export function propuestaDelPago(d: DatosPropuestaPago): PropuestaPago {
  if (d.deLaFicha?.trim()) return { cuenta: d.deLaFicha.trim(), origen: 'De su ficha', duda: null }
  const ultimas = d.ultimas.filter((c) => c.trim() !== '').slice(0, PAGOS_PARA_LA_DUDA)
  if (!ultimas.length) return { cuenta: '', origen: null, duda: null }
  const distintas = [...new Set(ultimas)]
  return { cuenta: ultimas[0], origen: 'La del último pago', duda: distintas.length > 1 ? { cuentas: distintas } : null }
}

export type QueHaceElPago =
  | { que: 'pendiente'; porque: string }
  | { que: 'banco'; tesoreriaId: string; cuenta: string; fecha: string; importe: number }
  | { que: 'liquidacion'; cuenta: string }
  | { que: 'otra'; cuenta: string; fecha: string; importe: number }

export interface DatosQueHace {
  cuenta: string
  /** AAAA-MM-DD, o ''. */
  fecha: string
  hoy: string
  importe: number
  /** Las tesorerías de la empresa (banco, tarjeta, caja), por el código de su subcuenta. */
  tesorerias: ReadonlyMap<string, string>
  /** La plataforma de la factura, si lo es: su 430 y si hay liquidación. */
  plataforma: { cuenta430: string | null; hayLiquidacion: boolean } | null
  /** La subcuenta del proveedor: no es una cuenta de pago. */
  cuentaProveedor: string | null
}

/** Qué hace al guardar la cuenta que hay en la casilla. Pendiente siempre lleva su porqué (regla 8). */
export function queHaceElPago(o: DatosQueHace): QueHaceElPago {
  const cuenta = o.cuenta.trim()
  if (!cuenta) return { que: 'pendiente', porque: 'sin cuenta de pago' }
  if (o.plataforma?.cuenta430 && cuenta === o.plataforma.cuenta430) {
    // La fecha y el importe son los de su liquidación: no hacen falta aquí.
    return o.plataforma.hayLiquidacion ? { que: 'liquidacion', cuenta } : { que: 'pendiente', porque: 'no hay liquidación de la que descontarla: se paga después por bancos' }
  }
  if (o.cuentaProveedor && cuenta === o.cuentaProveedor) return { que: 'pendiente', porque: `la ${cuenta} es la del proveedor, no una cuenta de pago` }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.fecha)) return { que: 'pendiente', porque: 'sin la fecha del pago' }
  if (o.fecha > o.hoy) return { que: 'pendiente', porque: `se paga el ${fechaEs(o.fecha)}, después de hoy` }
  if (!(o.importe > 0)) return { que: 'pendiente', porque: 'sin importe que pagar' }
  const teso = o.tesorerias.get(cuenta)
  return teso ? { que: 'banco', tesoreriaId: teso, cuenta, fecha: o.fecha, importe: o.importe } : { que: 'otra', cuenta, fecha: o.fecha, importe: o.importe }
}

/** La fecha del pago que se propone: el vencimiento, si lo hay; si no, la de la factura. */
export function fechaDelPago(fecha: string, vence: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(vence)) return vence
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : ''
}

/** La duda de la cuenta del pago, para la línea ámbar: «Le has pagado por la 57200001 y la 55100001: ¿cuál?». */
export function textoDudaPago(duda: { cuentas: readonly string[] }, nombre: (c: string) => string): { tono: TonoEstado; texto: string } {
  const lista = duda.cuentas.map((c) => `la ${c}${nombre(c) ? ` (${nombre(c)})` : ''}`)
  const juntas = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}` : lista[0]
  return { tono: 'ambar', texto: `Sus últimos pagos van por ${juntas}: mira cuál es esta` }
}

/** Lo que se dice después de guardar, cuando queda pendiente (regla 8: con su porqué). */
export const textoPendiente = (porque: string) => `Queda pendiente de pagar (${porque}).`

/**
 * X21b (Julio, 21/11) · «Cómo se paga» admite cualquier subcuenta del plan. Si la elegida no es una tesorería (banco,
 * tarjeta, caja) ni la 430 de la plataforma, una línea dice qué asiento hará al validar, sin bloquear: el del pago,
 * con la del proveedor al debe y la elegida al haber (conta_recibida_pagar_con_cuenta). Null si no toca decirlo.
 */
export function textoAsientoDelPago(q: QueHaceElPago, o: { nombre: (c: string) => string; cuentaProveedor: string | null; importe: string }): string | null {
  if (q.que !== 'otra') return null
  const nombre = o.nombre(q.cuenta)
  const elegida = `la ${q.cuenta}${nombre ? ` · ${nombre}` : ''}`
  const proveedor = o.cuentaProveedor ? `la ${o.cuentaProveedor} del proveedor` : 'la del proveedor'
  return `No es un banco ni la caja: al validar, un asiento del pago con ${proveedor} al debe y ${elegida} al haber, por ${o.importe}, y la factura queda pagada.`
}
