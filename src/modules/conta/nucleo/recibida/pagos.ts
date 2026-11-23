// src/modules/conta/nucleo/recibida/pagos.ts
//
// K10c · Los pagos de una factura recibida (como el bloque «Pago factura» de ERP10, con su ⊕): lo que la ficha nueva
// (K11b) necesita saber, sin React ni red. La base manda (conta_recibida_pago y el tope de supplier_invoice_payment);
// esto dice lo mismo para pintarlo antes de guardar:
//   · lo pagado y lo pendiente (total − suma de pagos), al céntimo;
//   · el estado: pendiente, pagada en parte o pagada;
//   · si un pago nuevo (o uno cambiado) cabe: no puede hacer que la suma pase del total (en ámbar en la pantalla).

export type EstadoPagos = 'pendiente' | 'pagada_parte' | 'pagada'

export interface UnPago { importe: number }

const c = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100)

/** Lo pagado, lo pendiente y el estado de una factura de `total` con estos pagos. */
export function estadoDePagos(total: number, pagos: readonly UnPago[]): { pagado: number; pendiente: number; estado: EstadoPagos; pagos: number } {
  const t = c(total)
  const p = pagos.reduce((s, x) => s + c(x.importe), 0)
  const pendiente = Math.max(0, t - p)
  const estado: EstadoPagos = t !== 0 && pendiente === 0 ? 'pagada' : p > 0 ? 'pagada_parte' : 'pendiente'
  return { pagado: p / 100, pendiente: pendiente / 100, estado, pagos: pagos.length }
}

/**
 * Si un pago de `importe` cabe en la factura: mayor que cero y sin pasar del total con los demás. `cambiando`: el índice
 * del pago que se está cambiando (no cuenta su importe de antes).
 */
export function cabeElPago(total: number, pagos: readonly UnPago[], importe: number, cambiando: number | null = null): { cabe: boolean; falta: number } {
  const otros = pagos.filter((_, i) => i !== cambiando)
  const { pendiente } = estadoDePagos(total, otros)
  const i = c(importe)
  return { cabe: i > 0 && i <= c(pendiente), falta: pendiente }
}

/** «2 pagos», «1 pago»: lo que dice «⊕ otro pago · N pagos». */
export const cuantosPagos = (n: number): string => `${n} ${n === 1 ? 'pago' : 'pagos'}`
