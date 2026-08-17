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
  scope?: 'single' | 'all'
  requestedLocationId?: string | null
  locations: ConnectLocationResult[]
  publish: Partial<PublishResult> | null
}

// locationId opcional (2.3, 15/08/2026): acota la operación a un solo local
// en vez del barrido de todos los locales mapeados de la marca. Omitido =
// comportamiento de siempre (el botón "Conectar a delivery" de Kitchen no
// cambia). El asistente de conexión de Fase 3 lo pasará siempre, acotando al
// local que se acaba de conectar por 2.1.
export async function connectBrandToDelivery(brandId: string, locationId?: string): Promise<ConnectResult> {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }

  const { data, error } = await supabase.functions.invoke('hubrise-brand-connect', {
    body: locationId ? { brand_id: brandId, location_id: locationId } : { brand_id: brandId },
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

  const d = (data ?? {}) as {
    ok?: boolean; error?: string; scope?: 'single' | 'all'; requested_location_id?: string | null
    locations?: ConnectLocationResult[]; publish?: Partial<PublishResult> | null
  }
  return {
    ok: d.ok === true,
    error: d.error,
    scope: d.scope,
    requestedLocationId: d.requested_location_id ?? null,
    locations: d.locations ?? [],
    publish: d.publish ?? null,
  }
}
