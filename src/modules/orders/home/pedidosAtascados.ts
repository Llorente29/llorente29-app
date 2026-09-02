// Pedidos de HubRise sin aceptar, para la tarjeta del Inicio.
//
// ── EL CRITERIO ES EL DEL VIGÍA, LETRA POR LETRA ───────────────────────────
// `hubrise_order_stuck_watchdog` ya define «atascado», y su migración del 27/08
// documenta la trampa en la que se cae al reescribirlo:
//
//   «La hipótesis era que mirase status/order_status en vez de accepted_at.
//    Mira status y order_status, sí — pero cambiarlo a accepted_at sería peor,
//    porque accepted_at NO PRUEBA NADA. El trigger tg_sale_seal_kpi_hitos lo
//    rellena en el INSERT de TODAS las ventas […] Es un sello de KPI de cocina,
//    no una aceptación. Un vigía que mirase accepted_at estaría ciego para
//    siempre.»
//
// Así que aquí se copia el criterio del vigía y no se inventa otro. Si algún
// día cambia, cambia en los dos sitios — y el que lo cambie tiene este comentario
// para saber que hay dos.
//
// ── LA VENTANA DE 3 HORAS ──────────────────────────────────────────────────
// El vigía mira solo las últimas 3 h, y NO es parte de la definición de
// «atascado»: es su anti-spam, para no reavisar eternamente del mismo pedido.
// La tarjeta la conserva por dos razones: que la cifra y el correo digan lo
// mismo, y porque un pedido «nuevo» de hace tres días no es algo que arreglar
// antes de abrir, es basura de datos. Y la tarjeta DICE la ventana.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'

export const MINUTOS_PARA_ATASCADO = 3
export const HORAS_DE_VENTANA = 3

export interface PedidoAtascado {
  marca: string
  minutos: number
  total: number
}

export async function leePedidosAtascados(
  accountId: string, locationId: string | null,
): Promise<PedidoAtascado[]> {
  if (!isSupabaseEnabled || !supabase) return []
  const ahora = Date.now()
  const desde = new Date(ahora - HORAS_DE_VENTANA * 3600_000).toISOString()
  const hasta = new Date(ahora - MINUTOS_PARA_ATASCADO * 60_000).toISOString()

  let q = supabase.from('sale')
    .select('external_brand_text, total, created_at, order_status')
    .eq('account_id', accountId)
    .eq('source', 'hubrise')
    .eq('status', 'open')
    .is('cancelled_at', null)
    .gt('created_at', desde)
    .lt('created_at', hasta)
    .order('created_at')
  if (locationId) q = q.eq('location_id', locationId)

  const { data, error } = await q
  if (error) throw new Error(`No se han podido leer los pedidos: ${error.message}`)

  return ((data ?? []) as Record<string, unknown>[])
    // `coalesce(order_status,'new') in ('new','received')`, igual que el vigía.
    .filter(r => ['new', 'received'].includes(String(r.order_status ?? 'new')))
    .map(r => ({
      marca: String(r.external_brand_text ?? 'sin marca'),
      minutos: Math.round((ahora - new Date(String(r.created_at)).getTime()) / 60000),
      total: Number(r.total) || 0,
    }))
    .sort((a, b) => b.minutos - a.minutos)
}
