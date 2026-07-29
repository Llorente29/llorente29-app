// src/modules/kitchen/services/hubriseBrandConnectService.ts
//
// Servicio del ASISTENTE "Conectar a delivery" (front -> Edge
// hubrise-brand-connect). El Edge hace el trabajo (crear/reusar catálogo por
// local con el token escritor, guardar brand_hubrise_catalog, publicar la
// carta reusando hubrise-catalog-publish). Aquí solo invocamos y normalizamos
// el resultado. La sesión del usuario viaja sola en functions.invoke (su JWT).
//
// El Edge devuelve 200 también en fallos de negocio (sin token escritor, sin
// locales HubRise), con { ok:false, error }, para que la UI los muestre sin
// tratarlos como errores de red.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type { PublishResult } from './catalogPublishService'

export interface ConnectLocationResult {
  location_id: string
  external_location_id: string
  location_name: string
  status: 'ya_conectada' | 'reusada_por_nombre' | 'creada' | 'error'
  external_catalog_id?: string
  error?: string
}

export interface ConnectResult {
  ok: boolean
  error?: string
  locations: ConnectLocationResult[]
  publish: Partial<PublishResult> | null
}

export async function connectBrandToDelivery(brandId: string): Promise<ConnectResult> {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }

  const { data, error } = await supabase.functions.invoke('hubrise-brand-connect', {
    body: { brand_id: brandId },
  })

  // Error de transporte / no-2xx (auth, crash). Intentamos leer el cuerpo si lo hay.
  if (error) {
    let msg = error.message ?? 'Error conectando la marca a delivery.'
    try {
      const ctx = (error as unknown as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json()
        if (j?.error) msg = j.error
      }
    } catch { /* ignore */ }
    return { ok: false, error: msg, locations: [], publish: null }
  }

  const d = (data ?? {}) as Partial<ConnectResult>
  return {
    ok: d.ok === true,
    error: d.error,
    locations: d.locations ?? [],
    publish: d.publish ?? null,
  }
}
