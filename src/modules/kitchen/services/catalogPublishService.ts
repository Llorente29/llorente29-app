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

/**
 * Un precio propio por canal que CAMBIA respecto al base, tal y como se
 * publicaría. Precios en el formato de HubRise ("13.50 EUR").
 */
export interface DryRunPriceChange {
  ref: string
  nombre: string
  canales: string[]      // slugs de canal: glovo | justeat | uber…
  base: string
  se_publica: string
  delta_pct: number | null
}

/** Un catálogo de destino, tal y como lo devuelve el ensayo. */
export interface DryRunTarget {
  external_catalog_id: string
  connection_name: string
  location_id: string | null
  productos: number
  /**
   * TOTAL, no lo que se enseñe. Una confirmación nunca describe una muestra.
   * Opcionales a propósito: la OTA llega por estación, así que un panel puede
   * hablar un rato con un Edge que todavía no los manda. La UI lo tolera en
   * vez de reventar.
   */
  precios_propios_total?: number
  /** Completa y ya ordenada por diferencia descendente (la ordena el Edge). */
  precios_propios?: DryRunPriceChange[]
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

/** Un local, tal y como lo necesita cualquier pantalla que publique. */
export interface LocalPublicable { id: string; name: string }

/**
 * Locales de la cuenta, para elegir ámbito antes de publicar.
 *
 * SÓLO LOS ABIERTOS (02/09). Hasta hoy esta consulta no filtraba `active` y la
 * rejilla de precios sí: dos pantallas que publican la misma carta contaban
 * locales distintos, y la carta de marcas ofrecía «Plaza Castilla», que está
 * cerrado. Es la Regla 10 en su forma más barata de arreglar: una consulta.
 */
export async function listPublishLocations(accountId: string): Promise<LocalPublicable[]> {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  const { data, error } = await supabase
    .from('locations').select('id, name')
    .eq('account_id', accountId).eq('active', true).order('name')
  // El error NO se traga: sin locales el selector se queda en "toda la cuenta"
  // como única opción y publicar tocaría los dos escaparates sin que se sepa.
  if (error) throw new Error(`No se han podido cargar los locales: ${error.message}`)
  return (data ?? []) as LocalPublicable[]
}

// ── A QUIÉN LE CAMBIA EL ESCAPARATE (02/09) ────────────────────────────────
// Publicar una carta REEMPLAZA el catálogo vivo en cada local del ámbito. Hasta
// hoy las dos pantallas que publican decían el ámbito con un NÚMERO —«toda la
// cuenta», «los 3 locales»— y nunca con los nombres. Un número no es un aviso:
// quien pulsa no puede saber que acaba de republicar el escaparate de Alcalá en
// horario de servicio hasta que se lo cuentan.
//
// La regla, y vale para Julio igual que para José: la pantalla dice QUÉ LOCALES
// quedan afectados, con sus nombres, y si son más de uno pide un consentimiento
// aparte. No es un permiso que se le niegue a nadie: es una consecuencia que no
// se puede descubrir después.
//
// Vive AQUÍ y en ningún otro sitio. Las dos pantallas tenían cada una su copia
// —`ambitoNombre` y `dondeNombre`— y ya discrepaban: una decía «toda la cuenta»
// y la otra «los 3 locales» para exactamente lo mismo. Regla 10.

export interface AlcancePublicacion {
  /** Los locales que quedan afectados. Vacío sólo si no se han podido leer. */
  ids: string[]
  nombres: string[]
  /** Como lo diría una persona: «Foodint Alcalá y Foodint Carabanchel». */
  frase: string
  /** Más de un local: la consecuencia no es obvia y hay que consentirla. */
  esMultiple: boolean
  /** No se sabe a qué locales va. Se dice; no se adivina ni se calla. */
  desconocido: boolean
}

/** «A», «A y B», «A, B y C». Todos, siempre: un umbral ordena, no esconde. */
export function enumeraNombres(nombres: string[]): string {
  if (nombres.length === 0) return ''
  if (nombres.length === 1) return nombres[0]
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

/**
 * De la elección del usuario a los locales de verdad, con nombre y todo.
 * `locationId === null` significa «toda la cuenta», que es justo el caso en el
 * que hay que decir nombres, no contar.
 */
export function alcanceDePublicacion(
  locationId: string | null, locales: LocalPublicable[],
): AlcancePublicacion {
  if (locationId) {
    const l = locales.find((x) => x.id === locationId)
    if (!l) {
      // El id no está en la lista: pudo fallar la carga. No se inventa un nombre.
      return {
        ids: [locationId], nombres: [], esMultiple: false, desconocido: true,
        frase: 'un local que no se ha podido identificar',
      }
    }
    return { ids: [l.id], nombres: [l.name], frase: l.name, esMultiple: false, desconocido: false }
  }

  if (locales.length === 0) {
    // Toda la cuenta y no sabemos cuántos son. Es el peor caso posible para
    // pulsar a ciegas, así que se trata como múltiple: pide consentimiento.
    return {
      ids: [], nombres: [], esMultiple: true, desconocido: true,
      frase: 'todos los locales de la cuenta (no se han podido leer sus nombres)',
    }
  }

  const nombres = locales.map((l) => l.name)
  return {
    ids: locales.map((l) => l.id),
    nombres,
    frase: enumeraNombres(nombres),
    esMultiple: locales.length > 1,
    desconocido: false,
  }
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
