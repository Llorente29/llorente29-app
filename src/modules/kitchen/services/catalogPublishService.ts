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
//
// ── ÁMBITO Y ENSAYO (19/08) ────────────────────────────────────────────────
// El Edge acepta `location_id` desde el 17/08 y este servicio NO se lo pasaba,
// así que publicar Meraki Pita fue a los DOS catálogos a la vez: dmmj9 (Alcalá)
// y x77xp (Carabanchel). No hizo daño porque HubRise rechazó las dos por otro
// motivo; sin ese rechazo habría republicado el escaparate vivo de Alcalá en
// horario de servicio sin que nadie lo pidiera.
//
// Ahora el ámbito viaja SIEMPRE y explícito, y publicar pasa por dos puertas:
// primero `dry_run` —que no manda un solo byte a HubRise— y sólo después la
// publicación de verdad. Mismo principio que la rejilla de precios: la última
// pantalla antes de escribir dice DÓNDE escribe.

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
  variants?: number
  price_overrides?: number
  warnings: string[]
  targets: PublishTarget[]
}

/** Un precio del ensayo: el del sku y, si los hay, los propios por canal. */
export interface DryRunPrice {
  ref: string
  price: string
  price_overrides: Array<{ variant_refs: string[]; price: string }> | null
}

/** Un catálogo de destino, tal y como lo devuelve el ensayo. */
export interface DryRunTarget {
  external_catalog_id: string
  connection_name: string
  location_id: string | null
  productos: number
  precios: DryRunPrice[]
  precios_truncados: number
}

export interface DryRunResult {
  ok: boolean
  error?: string
  scope: 'single' | 'all'
  requested_location_id: string | null
  catalogos_en_alcance: number
  catalogos_descartados_por_ambito: number
  targets: DryRunTarget[]
  nota?: string
}

/** Locales de la cuenta, para elegir ámbito antes de publicar. */
export async function listPublishLocations(accountId: string): Promise<Array<{ id: string; name: string }>> {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  const { data, error } = await supabase
    .from('locations').select('id, name').eq('account_id', accountId).order('name')
  // El error NO se traga: sin locales el selector se queda en "toda la cuenta"
  // como única opción y publicar tocaría los dos escaparates sin que se sepa.
  if (error) throw new Error(`No se han podido cargar los locales: ${error.message}`)
  return (data ?? []) as Array<{ id: string; name: string }>
}

/**
 * ENSAYO. Dice a qué catálogo iría y con qué precios, SIN mandar nada a
 * HubRise: el Edge sale antes del PUT y antes de subir imágenes.
 */
export async function dryRunBrandCatalog(
  brandId: string, locationId: string | null,
): Promise<DryRunResult> {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')

  const { data, error } = await supabase.functions.invoke('hubrise-catalog-publish', {
    body: { brand_id: brandId, location_id: locationId ?? undefined, dry_run: true },
  })
  if (error) {
    let msg = error.message ?? 'Error preparando la publicación.'
    try {
      const ctx = (error as unknown as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json()
        if (j?.error) msg = j.error
      }
    } catch { /* ignore */ }
    return {
      ok: false, error: msg, scope: locationId ? 'single' : 'all',
      requested_location_id: locationId, catalogos_en_alcance: 0,
      catalogos_descartados_por_ambito: 0, targets: [],
    }
  }
  const d = (data ?? {}) as Partial<DryRunResult>
  return {
    ok: d.ok === true,
    error: d.error,
    scope: d.scope ?? (locationId ? 'single' : 'all'),
    requested_location_id: d.requested_location_id ?? locationId,
    catalogos_en_alcance: d.catalogos_en_alcance ?? 0,
    catalogos_descartados_por_ambito: d.catalogos_descartados_por_ambito ?? 0,
    targets: d.targets ?? [],
    nota: d.nota,
  }
}

/**
 * Publica de verdad. `locationId` viaja SIEMPRE (null = toda la cuenta, y
 * entonces la UI tiene que haberlo dicho con todas las letras).
 */
export async function publishBrandCatalog(
  brandId: string, locationId: string | null,
): Promise<PublishResult> {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }

  const { data, error } = await supabase.functions.invoke('hubrise-catalog-publish', {
    body: { brand_id: brandId, location_id: locationId ?? undefined },
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
    variants: d.variants,
    price_overrides: d.price_overrides,
    warnings: d.warnings ?? [],
    targets: d.targets ?? [],
  }
}
