// src/modules/orders/services/fiscalTiqueService.ts
//
// V04 · PR 1 · Lo fiscal del tique de un pedido, para la vista previa de
// Pedidos («Ver tiques»). Lo da la base (fiscal_for_preview), que solo lee: el
// número de la serie lo da la tablet al imprimir, nunca la vista previa.
// Si la base no contesta, la vista previa sale como antes (sin lo fiscal): es
// para mirar, no para imprimir.

import { rpcSinTipar } from '@/lib/rpcSinTipar'
import type { FiscalTique } from '@/native/print/fiscalTique'

export async function fiscalParaVistaPrevia(saleId: string): Promise<FiscalTique | null> {
  try {
    return (await rpcSinTipar<FiscalTique | null>('fiscal_for_preview', { p_sale_id: saleId })) ?? null
  } catch (e) {
    console.warn('[tique] sin lo fiscal en la vista previa:', e instanceof Error ? e.message : e)
    return null
  }
}
