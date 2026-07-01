// src/modules/integrations/services/locationDispatchService.ts
//
// Config de DESPACHO de reparto por local (la "verdad" que lee el trigger
// tg_auto_dispatch): modo (auto/manual) + broker por defecto. Vive en la tabla
// locations; se edita desde la ficha de cualquier broker de reparto (es config
// del local, no del conector).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

export type DispatchMode = 'auto' | 'manual'
export type DispatchBroker = 'catcher' | 'jelp' | 'uber_direct' | 'shipday'

export interface LocationDispatch { mode: DispatchMode; broker: DispatchBroker }

function db() {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return supabase!
}

export async function getLocationDispatch(locationId: string): Promise<LocationDispatch> {
  const { data, error } = await db()
    .from('locations')
    .select('dispatch_mode, dispatch_broker')
    .eq('id', locationId)
    .single()
  if (error) throw new Error(error.message)
  return {
    mode: ((data as any).dispatch_mode ?? 'auto') as DispatchMode,
    broker: ((data as any).dispatch_broker ?? 'catcher') as DispatchBroker,
  }
}

export async function setLocationDispatch(
  locationId: string,
  patch: Partial<LocationDispatch>,
): Promise<void> {
  const row: { dispatch_mode?: DispatchMode; dispatch_broker?: DispatchBroker } = {}
  if (patch.mode) row.dispatch_mode = patch.mode
  if (patch.broker) row.dispatch_broker = patch.broker
  if (Object.keys(row).length === 0) return
  const { error } = await db().from('locations').update(row as never).eq('id', locationId)
  if (error) throw new Error(error.message)
}
