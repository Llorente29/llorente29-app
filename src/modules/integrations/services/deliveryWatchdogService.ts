// src/modules/integrations/services/deliveryWatchdogService.ts
//
// Umbrales del VIGÍA de reparto por local (Capa 4). Vive en delivery_watchdog_config
// (tabla nueva, aún no en database.ts → from() casteado, patrón de kdsService). El
// cron delivery-watchdog los lee; si no hay fila, aplica los defaults (45/90).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

export interface DeliveryWatchdogConfig {
  enabled: boolean
  inDeliveryThresholdMinutes: number   // "en reparto" (desde handed_to_courier_at)
  unsealedThresholdMinutes: number     // "sin cerrar" (desde que entró)
}

export const WATCHDOG_DEFAULTS: DeliveryWatchdogConfig = {
  enabled: true,
  inDeliveryThresholdMinutes: 45,
  unsealedThresholdMinutes: 90,
}

// from() acotado: la tabla aún no está en los tipos autogenerados.
function tbl(name: string) {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return (supabase! as unknown as { from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']> }).from(name)
}

export async function getDeliveryWatchdog(locationId: string): Promise<DeliveryWatchdogConfig> {
  const { data, error } = await tbl('delivery_watchdog_config')
    .select('enabled, in_delivery_threshold_minutes, unsealed_threshold_minutes')
    .eq('location_id', locationId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { ...WATCHDOG_DEFAULTS }
  const d = data as Record<string, unknown>
  return {
    enabled: (d.enabled as boolean | null) ?? true,
    inDeliveryThresholdMinutes: (d.in_delivery_threshold_minutes as number | null) ?? 45,
    unsealedThresholdMinutes: (d.unsealed_threshold_minutes as number | null) ?? 90,
  }
}

export async function setDeliveryWatchdog(
  locationId: string,
  patch: Partial<DeliveryWatchdogConfig>,
): Promise<void> {
  const row: Record<string, unknown> = { location_id: locationId, updated_at: new Date().toISOString() }
  if (patch.enabled !== undefined) row.enabled = patch.enabled
  if (patch.inDeliveryThresholdMinutes !== undefined) row.in_delivery_threshold_minutes = patch.inDeliveryThresholdMinutes
  if (patch.unsealedThresholdMinutes !== undefined) row.unsealed_threshold_minutes = patch.unsealedThresholdMinutes
  const { error } = await tbl('delivery_watchdog_config').upsert(row as never, { onConflict: 'location_id' })
  if (error) throw new Error(error.message)
}
