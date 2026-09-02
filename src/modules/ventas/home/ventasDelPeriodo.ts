// src/modules/ventas/home/ventasDelPeriodo.ts
//
// Lo que «Ticket medio» y «Ventas por canal» necesitan: la respuesta de
// `sales_dashboard` para AYER, que es el último día cerrado.
//
// ── POR QUÉ AYER Y NO HOY ──────────────────────────────────────────────────
// Un ticket medio de media mañana está hecho de cuatro pedidos y salta veinte
// euros con el quinto. Y su espejo —la RPC ya trae `prev`— compararía un día a
// medias contra uno entero, que es la entrada 6 del registro. Ayer está
// cerrado, su espejo también, y las dos tarjetas dicen «ayer» en el título.

import { getSalesDashboard, type SalesDashboard } from '../services/salesDashboardService'
import { diaAnterior } from '@/lib/fechas'

export interface PeriodoDeVentas {
  dashboard: SalesDashboard
  /** «miércoles», el día que se está enseñando. */
  nombreDelDia: string
}

export async function ventasDeAyerCompletas(
  accountId: string, locationId: string | null,
): Promise<PeriodoDeVentas> {
  const ayer = diaAnterior(new Date())
  const dashboard = await getSalesDashboard({
    accountId, from: ayer.desde, to: ayer.hasta,
    locationId: locationId || null, brandId: null, ownership: null, channel: null,
  })
  return {
    dashboard,
    nombreDelDia: ayer.desde.toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' }),
  }
}

/**
 * El ticket medio: importe entre pedidos.
 *
 * SIN PEDIDOS NO HAY TICKET MEDIO — no es cero, es que no existe. Dividir entre
 * cero y enseñar «0 €» diría que el ticket medio fue de cero euros, que es una
 * afirmación sobre el negocio, no sobre la falta de datos.
 */
export function ticketMedio(net: number, orders: number): number | null {
  return orders > 0 ? net / orders : null
}
