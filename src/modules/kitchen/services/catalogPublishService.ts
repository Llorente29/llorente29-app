// src/modules/kitchen/services/catalogPublishService.ts
//
// Servicio del PUBLICADOR de catálogo (front -> Edge hubrise-catalog-publish).
// El Edge hace el trabajo (resolver marca->catálogo+token, construir payload,
// PUT a HubRise, registrar catalog_publish). Aquí solo invocamos y normalizamos
// el resultado. La sesión del usuario viaja sola en functions.invoke (su JWT).
//
// El Edge devuelve 200 también en fallos de negocio (sin conexión, validación),
// con { ok:false, error, warnings }, para que la UI los muestre sin tratarlos
// como errores de red.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

export interface PublishTarget {
  connection_name: string | null
  external_catalog_id: string | null
  status: 'ok' | 'error' | 'pending'
  error_text: string | null
}

export interface PublishResult {
  ok: boolean
  status: 'done' | 'partial' | 'failed' | 'pending'
  error?: string
  publish_id?: string
  products?: number
  deals?: number
  option_lists?: number
  warnings: string[]
  targets: PublishTarget[]
}

export async function publishBrandCatalog(brandId: string): Promise<PublishResult> {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }

  const { data, error } = await supabase.functions.invoke('hubrise-catalog-publish', {
    body: { brand_id: brandId },
  })

  // Error de transporte / no-2xx (auth, crash). Intentamos leer el cuerpo si lo hay.
  if (error) {
    let msg = error.message ?? 'Error publicando el catálogo.'
    try {
      const ctx = (error as unknown as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json()
        if (j?.error) msg = j.error
      }
    } catch { /* ignore */ }
    return { ok: false, status: 'failed', error: msg, warnings: [], targets: [] }
  }

  const d = (data ?? {}) as Partial<PublishResult>
  return {
    ok: d.ok === true,
    status: (d.status as PublishResult['status']) ?? (d.ok ? 'done' : 'failed'),
    error: d.error,
    publish_id: d.publish_id,
    products: d.products,
    deals: d.deals,
    option_lists: d.option_lists,
    warnings: d.warnings ?? [],
    targets: d.targets ?? [],
  }
}
