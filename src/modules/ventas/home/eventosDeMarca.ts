// src/modules/ventas/home/eventosDeMarca.ts
//
// Los cierres y aperturas de marca de una ventana, para la línea del porqué.
// `availability_event` los guarda con `occurred_at`, la acción y —cuando quien
// los escribió lo supo— el local.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import type { EventoDeMarca } from './porqueSemana'

export async function leeEventosDeMarca(
  accountId: string,
  locationId: string | null,
  desde: Date,
  hasta: Date,
): Promise<EventoDeMarca[]> {
  if (!isSupabaseEnabled || !supabase) return []
  // Se mira una semana ANTES de la ventana: un cierre que empezó el domingo y
  // sigue el lunes explica el lunes, y si solo se leyera desde el lunes se
  // vería la marca cerrada sin saber desde cuándo.
  const margen = new Date(desde.getTime() - 7 * 86_400_000)

  let q = supabase.from('availability_event')
    .select('target_label, location_id, action, occurred_at')
    .eq('account_id', accountId).eq('scope', 'brand')
    .gte('occurred_at', margen.toISOString()).lt('occurred_at', hasta.toISOString())
    .order('occurred_at')
  if (locationId) q = q.eq('location_id', locationId)

  const { data, error } = await q
  if (error) throw new Error(`No se han podido leer los cierres de marca: ${error.message}`)

  const filas = (data ?? []) as {
    target_label: string | null; location_id: string | null
    action: string; occurred_at: string
  }[]
  const locIds = [...new Set(filas.map(f => f.location_id).filter((x): x is string => !!x))]
  const nombres = new Map<string, string>()
  if (locIds.length > 0) {
    const { data: locs } = await supabase.from('locations').select('id, name').in('id', locIds)
    for (const l of (locs ?? []) as { id: string; name: string }[]) nombres.set(l.id, l.name)
  }

  return filas
    .filter(f => f.action === 'open' || f.action === 'close')
    .map(f => ({
      marca: f.target_label ?? '(marca)',
      locationId: f.location_id,
      localNombre: f.location_id ? nombres.get(f.location_id) ?? null : null,
      accion: f.action as 'open' | 'close',
      cuando: f.occurred_at,
    }))
}
