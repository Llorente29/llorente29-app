// El stock negativo agrupado por local, para la tarjeta del Inicio.
//
// Cuelga de `getNegativeStockReport`, que es lo que ya usa la pantalla de
// Almacén: una sola definición de «negativo», de su causa y de su umbral.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { getNegativeStockReport } from '../services/negativeStockService'

export interface NegativoPorLocal {
  locationId: string
  local: string
  /** TODOS los negativos, crucen o no el umbral. La cifra grande los cuenta. */
  articulos: number
  /** Los que además cruzan el umbral anti-ruido. La nota los cuenta. */
  cruzanUmbral: number
  valorEur: number
}

export async function leeStockNegativoPorLocal(
  accountId: string, locationId: string | null,
): Promise<NegativoPorLocal[]> {
  if (!isSupabaseEnabled || !supabase) return []
  let q = supabase.from('locations').select('id, name')
    .eq('account_id', accountId).eq('active', true)
  if (locationId) q = q.eq('id', locationId)
  const { data, error } = await q.order('name')
  if (error) throw new Error(`No se han podido leer los locales: ${error.message}`)

  const salida: NegativoPorLocal[] = []
  for (const l of ((data ?? []) as { id: string; name: string }[])) {
    const rep = await getNegativeStockReport(accountId, l.id)
    salida.push({
      locationId: l.id,
      local: l.name,
      articulos: rep.items.length,
      cruzanUmbral: rep.items.filter(i => i.isAlert).length,
      valorEur: rep.items.reduce((s, i) => s + (i.valueEur || 0), 0),
    })
  }
  return salida.sort((a, b) => b.articulos - a.articulos)
}
