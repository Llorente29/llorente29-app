// El resumen de conteos sin cerrar, para la tarjeta del Inicio.
//
// EL CRITERIO NO SE INVENTA: sale de `atencionService`, que ya lo tenía escrito
// y razonado. Vivos son `contando` y `en_revision`; `aprobado` y `anulado` son
// finales. No se listan por `closed_at` porque un conteo cerrado y sin aprobar
// SIGUE pidiendo atención — es justo el caso que se quiere ver.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { listInventoryCounts } from '../services/inventoryCountService'
import { diasNaturalesEntre } from '@/lib/fechas'

/** Los mismos que usa la franja de atención. Una sola definición de «vivo». */
export const ESTADOS_VIVOS = ['contando', 'en_revision'] as const

export interface ConteosPorLocal {
  locationId: string
  local: string
  vivos: number
  /** Días naturales del más antiguo sin cerrar. null si no hay ninguno. */
  diasDelMasViejo: number | null
}

export async function leeConteosPendientes(
  accountId: string, locationId: string | null,
): Promise<ConteosPorLocal[]> {
  if (!isSupabaseEnabled || !supabase) return []
  let q = supabase.from('locations').select('id, name')
    .eq('account_id', accountId).eq('active', true)
  if (locationId) q = q.eq('id', locationId)
  const { data, error } = await q.order('name')
  if (error) throw new Error(`No se han podido leer los locales: ${error.message}`)

  const ahora = new Date()
  const salida: ConteosPorLocal[] = []
  for (const l of ((data ?? []) as { id: string; name: string }[])) {
    const todos = await listInventoryCounts(accountId, l.id)
    const vivos = todos.filter(c => (ESTADOS_VIVOS as readonly string[]).includes(c.status))
    // La antigüedad se mide desde que EMPEZÓ, no desde que se creó: un conteo
    // programado y no arrancado no lleva días abierto, lleva días sin abrir, y
    // son dos problemas distintos. Si no arrancó, cuenta desde su fecha prevista.
    const fechas = vivos
      .map(c => c.startedAt ?? c.scheduledFor)
      .filter((f): f is string => !!f)
      .map(f => diasNaturalesEntre(new Date(f), ahora))
    salida.push({
      locationId: l.id,
      local: l.name,
      vivos: vivos.length,
      diasDelMasViejo: fechas.length > 0 ? Math.max(...fechas) : null,
    })
  }
  return salida.sort((a, b) => b.vivos - a.vivos || a.local.localeCompare(b.local, 'es'))
}
