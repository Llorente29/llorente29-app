// src/modules/ventas/home/ventasDelDia.ts
//
// Las ventas de UN día del negocio, con su desglose por local. Es lo que
// necesitan la tarjeta «Ventas · ayer» y su espejo.
//
// ── POR QUÉ NO SE REUSA homeMetricsService ─────────────────────────────────
// Aquel suma un rango y devuelve un total; aquí hace falta el desglose por
// local Y el número de pedidos por local, que es lo que pide la maqueta
// («Alcalá 1.450 € · 61 pedidos»). Añadirle eso lo convertiría en dos
// funciones dentro de una.
//
// ── EL CORTE DEL DÍA ───────────────────────────────────────────────────────
// `sale.sold_at` está en UTC. El día se corta en hora del NEGOCIO con
// `diaDelNegocio` (src/lib/fechas.ts), no con la medianoche del navegador: es
// la regla 4, y aquí se llevaría por delante el primer o el último servicio.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'

export interface VentasPorLocal {
  locationId: string | null
  nombre: string
  total: number
  pedidos: number
}

export interface VentasDeUnDia {
  total: number
  pedidos: number
  porLocal: VentasPorLocal[]
}

interface FilaVenta { total: number | null; location_id: string | null }

/**
 * Agrupa las ventas por local. PURA, para poder probarla: es donde se puede
 * equivocar uno contando.
 */
export function agrupaPorLocal(
  filas: FilaVenta[],
  nombres: Map<string, string>,
): VentasDeUnDia {
  const acc = new Map<string, { total: number; pedidos: number }>()
  let total = 0
  for (const f of filas) {
    const importe = Number(f.total) || 0
    total += importe
    const clave = f.location_id ?? ''
    const a = acc.get(clave) ?? { total: 0, pedidos: 0 }
    a.total += importe
    a.pedidos += 1
    acc.set(clave, a)
  }
  const porLocal = [...acc.entries()]
    .map(([id, v]) => ({
      locationId: id === '' ? null : id,
      // Un local que no está en el mapa NO se llama «desconocido» ni se
      // descarta: se dice que no se ha podido identificar. Descartarlo haría
      // que la suma de las filas no cuadrara con la cifra grande.
      nombre: id === '' ? 'Sin local' : (nombres.get(id) ?? 'Local no identificado'),
      total: v.total,
      pedidos: v.pedidos,
    }))
    // De más a menos, como la maqueta. Empate → alfabético, para que no baile.
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'))

  return { total, pedidos: filas.length, porLocal }
}

function sb() {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

/** Nombres de los locales de la cuenta, para el desglose. */
export async function nombresDeLocales(accountId: string): Promise<Map<string, string>> {
  const { data, error } = await sb()
    .from('locations').select('id, name').eq('account_id', accountId)
  if (error) throw new Error(`No se han podido leer los locales: ${error.message}`)
  return new Map(((data ?? []) as { id: string; name: string }[]).map(l => [l.id, l.name]))
}

/** Ventas de un rango [desde, hasta), agrupadas por local. */
export async function ventasEntre(
  accountId: string,
  desde: Date,
  hasta: Date,
  locationId: string | null,
  nombres: Map<string, string>,
): Promise<VentasDeUnDia> {
  let q = sb()
    .from('sale')
    .select('total, location_id')
    .eq('account_id', accountId)
    .gte('sold_at', desde.toISOString())
    .lt('sold_at', hasta.toISOString())
  if (locationId) q = q.eq('location_id', locationId)

  const { data, error } = await q
  if (error) throw new Error(`No se han podido leer las ventas: ${error.message}`)
  return agrupaPorLocal((data ?? []) as FilaVenta[], nombres)
}
