// src/modules/supply/services/purchaseOrderCleanupService.ts
//
// P1 (10/08) — diagnóstico de pedidos "enviado" colgados. SOLO DIAGNÓSTICO:
// ninguna función de aquí escribe nada por sí sola. Propone una acción por
// pedido para que Julio la apruebe fila a fila.
//
// P1.b (10/08) — deja de ser un barrido one-shot: se convierte en vigía
// PERMANENTE. Solo entran en la lista los pedidos "enviado" vencidos más de
// `hung_order_days_threshold` días (supply_settings, default 14) — eso es lo
// que justifica proponer el cierre corto. El botón "Cerrar pendiente" del
// panel (CloseShortOrderModal) SÍ escribe, con motivo obligatorio; el resto
// de la fila sigue siendo solo lectura.
//
// Dos causas conocidas (hallazgo 10/08) que ayudan a elegir el motivo del
// cierre corto:
//   - Pedido en un local YA CERRADO (locations.active=false) → propone
//     'cancelar_local_cerrado' (así nacieron los fantasma de Plaza Castilla).
//   - Pedido en un local activo, con recepciones CONFIRMADAS del MISMO
//     proveedor+local que nunca se enlazaron (purchase_order_id NULL) →
//     propone 'revisar_casado' (probablemente SÍ llegó, solo que la recepción
//     no se enlazó al pedido). Sin candidatos → 'revisar_manual' (no se
//     inventa un matching sin pistas).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import {
  listPurchaseOrders, listPurchaseOrderLines, type PurchaseOrder,
} from '@/modules/supply/services/purchaseOrderService'
import { listGoodsReceipts, getSupplySettings } from '@/modules/supply/services/goodsReceiptService'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

type Row = Record<string, unknown>

export type HungOrderAction = 'cancelar_local_cerrado' | 'revisar_casado' | 'revisar_manual'

export interface HungOrderReview {
  orderId: string
  code: string | null
  supplierId: string | null
  supplierName: string | null
  locationId: string | null
  locationName: string | null
  locationActive: boolean
  orderDate: string
  expectedDate: string | null
  daysOverdue: number
  hungOrderDaysThreshold: number
  lineCount: number
  proposedAction: HungOrderAction
  proposedNote: string
  /** Recepciones confirmadas del mismo proveedor+local sin pedido enlazado (candidatas). */
  unmatchedReceiptCodes: string[]
  /** Pedido completo, para "Cerrar pendiente" (CloseShortOrderModal). */
  order: PurchaseOrder
}

// Sin expected_date: se usa order_date como referencia (igual que el filtro de
// ventana del muelle en OrderReceiveFlow.tsx) — "sin fecha" no es "invisible
// para siempre" para la vigía.
function daysOverdueFor(expectedDate: string | null, orderDate: string): number {
  const ref = expectedDate ?? orderDate
  const exp = new Date(ref + 'T00:00:00').getTime()
  const now = Date.now()
  const d = Math.floor((now - exp) / 86400000)
  return d > 0 ? d : 0
}

export async function getHungOrdersReview(accountId: string): Promise<HungOrderReview[]> {
  requireSupabase()

  const [allOrders, locRes, receipts, suppliers, settings] = await Promise.all([
    listPurchaseOrders({ accountId, status: 'enviado' }),
    supabase!.from('locations').select('id, name, active').eq('account_id', accountId),
    listGoodsReceipts({ accountId, status: 'confirmado' }),
    listSuppliers(accountId),
    getSupplySettings(accountId),
  ])
  if (locRes.error) throw new Error(`Error cargando locales: ${locRes.error.message}`)

  const threshold = settings.hungOrderDaysThreshold
  // Vigía: solo entran los "enviado" vencidos más de `threshold` días (por
  // expected_date, o por order_date si no hay expected_date).
  const orders = allOrders.filter(o => daysOverdueFor(o.expectedDate, o.orderDate) > threshold)

  const locationById = new Map<string, { name: string; active: boolean }>()
  for (const r of (locRes.data ?? []) as Row[]) {
    locationById.set(String(r.id), { name: (r.name as string) ?? '(sin nombre)', active: Boolean(r.active) })
  }
  const supplierNameById = new Map(suppliers.map(s => [s.id, s.name]))

  // Recepciones confirmadas SIN pedido enlazado, agrupadas por proveedor+local
  // — candidatas a "esto probablemente era este pedido, solo que no se enlazó".
  const unmatchedByKey = new Map<string, string[]>()
  for (const r of receipts) {
    if (r.purchaseOrderId) continue
    if (!r.supplierId || !r.locationId) continue
    const key = `${r.supplierId}|${r.locationId}`
    const list = unmatchedByKey.get(key) ?? []
    list.push(r.code ?? r.id)
    unmatchedByKey.set(key, list)
  }

  const lineCounts = await Promise.all(
    orders.map(o => listPurchaseOrderLines(o.id).then(ls => ls.length).catch(() => 0)),
  )

  return orders.map((o, i): HungOrderReview => {
    const loc = o.locationId ? locationById.get(o.locationId) : undefined
    const locationActive = loc?.active ?? true // sin dato = no se propone cancelar por local
    const key = o.supplierId && o.locationId ? `${o.supplierId}|${o.locationId}` : ''
    const candidates = unmatchedByKey.get(key) ?? []

    const daysOverdue = daysOverdueFor(o.expectedDate, o.orderDate)
    let proposedAction: HungOrderAction
    let proposedNote: string
    if (!locationActive) {
      proposedAction = 'cancelar_local_cerrado'
      proposedNote = `Local "${loc?.name ?? '—'}" cerrado (locations.active=false). Vencido ${daysOverdue} días (umbral ${threshold}). Propuesto: cerrar pendiente — "el proveedor no lo va a servir".`
    } else if (candidates.length > 0) {
      proposedAction = 'revisar_casado'
      proposedNote = `${candidates.length} recepción(es) confirmada(s) de este proveedor en este local sin pedido enlazado (${candidates.join(', ')}). Vencido ${daysOverdue} días (umbral ${threshold}). Revisa si es un casado antes de cerrar.`
    } else {
      proposedAction = 'revisar_manual'
      proposedNote = `Vencido ${daysOverdue} días (umbral ${threshold}) sin recepciones sin enlazar que lo expliquen. Propuesto: cerrar pendiente si ya no va a llegar.`
    }

    return {
      orderId: o.id,
      code: o.code,
      supplierId: o.supplierId,
      supplierName: o.supplierId ? supplierNameById.get(o.supplierId) ?? null : null,
      locationId: o.locationId,
      locationName: loc?.name ?? null,
      locationActive,
      orderDate: o.orderDate,
      expectedDate: o.expectedDate,
      daysOverdue,
      hungOrderDaysThreshold: threshold,
      lineCount: lineCounts[i] ?? 0,
      proposedAction,
      proposedNote,
      unmatchedReceiptCodes: candidates,
      order: o,
    }
  }).sort((a, b) => b.daysOverdue - a.daysOverdue)
}
