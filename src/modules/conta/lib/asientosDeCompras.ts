// src/modules/conta/lib/asientosDeCompras.ts
//
// S01 · PR 3 · Entrega 5 (PC01, punto 6): los orígenes que se deciden en
// Compras y gastos › Facturas recibidas además de la factura recibida, y cómo
// se llaman en palabras de oficina. La misma lista que SE_DECIDE_EN manda a
// 'recibidas' (una prueba lo compara: una sola vara).

import type { OrigenAsiento } from '@/modules/conta/lib/libro'

export const DE_COMPRAS: readonly OrigenAsiento[] = ['purchase_accrual', 'purchase_accrual_reversal', 'supplier_payment']

export function queEsDeCompras(o: OrigenAsiento): string {
  if (o === 'purchase_accrual') return 'Lo recibido sin factura, al cerrar el mes'
  if (o === 'purchase_accrual_reversal') return 'Su contrario, el día 1'
  if (o === 'supplier_payment') return 'Pago a proveedor'
  return 'Asiento de compras'
}

/** El título, con cuántos (regla 7). */
export function tituloDeCompras(n: number): string {
  return n === 1 ? 'Asientos de compras por validar · 1' : `Asientos de compras por validar · ${n}`
}
