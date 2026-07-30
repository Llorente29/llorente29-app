// src/modules/integrations/services/locationAvailabilityService.ts
//
// Config de DISPONIBILIDAD (86) por local: interruptor auto/manual (prepara el
// futuro gatillo de auto-86 por stock, que aún no existe) + qué otros
// integradores usa el local (Last, Otter…) para el aviso multi-integrador que
// dispara set_product_availability(_by_token) al agotar. Vive en la tabla
// locations; se edita desde la ficha de reparto/integraciones del local
// (mismo sitio que dispatch_mode/dispatch_broker).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

export type AvailabilityAutoMode = 'auto' | 'manual'

export const OTHER_INTEGRATORS: { code: string; name: string }[] = [
  { code: 'last', name: 'Last' },
  { code: 'otter', name: 'Otter' },
  { code: 'deliverect', name: 'Deliverect' },
]

export interface LocationAvailabilityConfig {
  mode: AvailabilityAutoMode
  otherIntegrators: string[]
}

function db() {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return supabase!
}

export async function getLocationAvailabilityConfig(locationId: string): Promise<LocationAvailabilityConfig> {
  const { data, error } = await db()
    .from('locations')
    .select('availability_auto_mode, availability_other_integrators')
    .eq('id', locationId)
    .single()
  if (error) throw new Error(error.message)
  const row = data as { availability_auto_mode?: string; availability_other_integrators?: string[] } | null
  return {
    mode: ((row?.availability_auto_mode ?? 'manual') as AvailabilityAutoMode),
    otherIntegrators: row?.availability_other_integrators ?? [],
  }
}

export async function setLocationAvailabilityConfig(
  locationId: string,
  patch: Partial<LocationAvailabilityConfig>,
): Promise<void> {
  const row: { availability_auto_mode?: AvailabilityAutoMode; availability_other_integrators?: string[] } = {}
  if (patch.mode) row.availability_auto_mode = patch.mode
  if (patch.otherIntegrators) row.availability_other_integrators = patch.otherIntegrators
  if (Object.keys(row).length === 0) return
  const { error } = await db().from('locations').update(row as never).eq('id', locationId)
  if (error) throw new Error(error.message)
}
