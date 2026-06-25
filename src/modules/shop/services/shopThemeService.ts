// src/modules/shop/services/shopThemeService.ts
//
// Capa de diseño de la Folvy Shop: lectura y escritura de shop_theme.
// La IDENTIDAD (logo, color, slug, shop_url) NO vive aquí, vive en brand;
// shop_theme solo lleva la "piel" (template, acento override, fuente, modo,
// densidad de foto, hero) + la PUBLICACIÓN (is_published, hub_visible,
// hub_position). Una fila por marca (brand_id) + una de cuenta (brand_id null
// = shell del hub multimarca).
//
// Filosofía "bonito desde el minuto 0": ensureThemesForAccount SIEMBRA por
// defecto un tema presentable para cada marca activa y el hub, de forma
// IDEMPOTENTE (los índices únicos parciales de la tabla lo garantizan; aquí
// además solo insertamos lo que falta y toleramos la colisión 23505 por carrera).

import { supabase } from '@/lib/supabase'

export type ShopTemplate = 'clasica' | 'escaparate' | 'minimal'
export type ShopFont = 'fraunces' | 'grotesk' | 'editorial'
export type ShopMode = 'light' | 'dark' | 'auto'
export type ShopPhotoDensity = 'compacta' | 'comoda'

export type ShopTheme = {
  id: string
  account_id: string
  brand_id: string | null          // null = tema del hub de la cuenta
  template: ShopTemplate
  accent_color: string | null      // null → el front usa brand.color
  font: ShopFont
  mode: ShopMode
  photo_density: ShopPhotoDensity
  hero_url: string | null
  is_published: boolean
  hub_visible: boolean
  hub_position: number
  extra: Record<string, unknown>
  created_at: string
  updated_at: string
}

// Identidad de la marca que el front necesita junto al tema (no se duplica: se lee).
export type ShopBrandRef = {
  id: string
  name: string
  slug: string | null
  color: string | null
  logo_url: string | null
}

export type BrandWithTheme = ShopTheme & { brand: ShopBrandRef | null }

const THEME_DEFAULTS = {
  template: 'clasica' as ShopTemplate,
  accent_color: null as string | null,
  font: 'fraunces' as ShopFont,
  mode: 'auto' as ShopMode,
  photo_density: 'comoda' as ShopPhotoDensity,
  hero_url: null as string | null,
  is_published: false,   // nace en BORRADOR: presentable, pero no público hasta que el dueño publica
  hub_visible: true,
  extra: {},
}

function db() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase as any
}

/** Siembra (idempotente) un tema por defecto para cada marca activa y para el
 *  hub de la cuenta. Devuelve el estado final ordenado por hub_position. */
export async function ensureThemesForAccount(accountId: string): Promise<ShopTheme[]> {
  const sb = db()

  const { data: brands, error: bErr } = await sb
    .from('brand')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .is('archived_at', null)
    .order('name', { ascending: true })
  if (bErr) throw new Error(`No se pudieron leer las marcas: ${bErr.message}`)

  const { data: existing, error: eErr } = await sb
    .from('shop_theme')
    .select('id, brand_id, hub_position')
    .eq('account_id', accountId)
  if (eErr) throw new Error(`No se pudieron leer los temas: ${eErr.message}`)

  const rows = existing ?? []
  const existingBrandIds = new Set(rows.filter((t: any) => t.brand_id).map((t: any) => t.brand_id))
  const hasHub = rows.some((t: any) => t.brand_id === null)
  let maxPos = rows.reduce((m: number, t: any) => (t.brand_id ? Math.max(m, t.hub_position ?? 0) : m), 0)

  const toInsert: any[] = []
  if (!hasHub) {
    toInsert.push({ account_id: accountId, brand_id: null, hub_position: 0, ...THEME_DEFAULTS })
  }
  for (const b of brands ?? []) {
    if (existingBrandIds.has(b.id)) continue
    maxPos += 1
    toInsert.push({ account_id: accountId, brand_id: b.id, hub_position: maxPos, ...THEME_DEFAULTS })
  }

  if (toInsert.length) {
    const { error: iErr } = await sb.from('shop_theme').insert(toInsert)
    // 23505 = otra pestaña/usuario sembró a la vez; los índices únicos parciales
    // garantizan que no se duplica. No es un error real: seguimos.
    if (iErr && iErr.code !== '23505') {
      throw new Error(`No se pudieron crear los temas: ${iErr.message}`)
    }
  }

  return listThemes(accountId)
}

/** Todos los temas de la cuenta (hub + marcas), ordenados por hub_position. */
export async function listThemes(accountId: string): Promise<ShopTheme[]> {
  const { data, error } = await db()
    .from('shop_theme')
    .select('*')
    .eq('account_id', accountId)
    .order('hub_position', { ascending: true })
  if (error) throw new Error(`No se pudieron leer los temas: ${error.message}`)
  return (data ?? []) as ShopTheme[]
}

/** Temas de marca con la identidad de su marca embebida (para el Asistente y el hub).
 *  Excluye el tema del hub (brand_id null). */
export async function listBrandsWithTheme(accountId: string): Promise<BrandWithTheme[]> {
  const { data, error } = await db()
    .from('shop_theme')
    .select('*, brand:brand_id ( id, name, slug, color, logo_url )')
    .eq('account_id', accountId)
    .not('brand_id', 'is', null)
    .order('hub_position', { ascending: true })
  if (error) throw new Error(`No se pudieron leer las marcas de la tienda: ${error.message}`)
  return (data ?? []) as BrandWithTheme[]
}

/** Tema del hub de la cuenta (brand_id null), o null si aún no sembrado. */
export async function getHubTheme(accountId: string): Promise<ShopTheme | null> {
  const { data, error } = await db()
    .from('shop_theme')
    .select('*')
    .eq('account_id', accountId)
    .is('brand_id', null)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el tema del hub: ${error.message}`)
  return (data ?? null) as ShopTheme | null
}

const EDITABLE_FIELDS = [
  'template', 'accent_color', 'font', 'mode', 'photo_density', 'hero_url',
  'is_published', 'hub_visible', 'hub_position', 'extra',
] as const

type EditablePatch = Partial<Pick<ShopTheme,
  'template' | 'accent_color' | 'font' | 'mode' | 'photo_density' | 'hero_url' |
  'is_published' | 'hub_visible' | 'hub_position' | 'extra'>>

/** Actualiza un tema (whitelist de campos; nunca toca account_id/brand_id). */
export async function updateTheme(id: string, patch: EditablePatch): Promise<ShopTheme> {
  const clean: Record<string, unknown> = {}
  for (const k of EDITABLE_FIELDS) {
    if (k in patch && (patch as any)[k] !== undefined) clean[k] = (patch as any)[k]
  }
  if (Object.keys(clean).length === 0) throw new Error('Nada que actualizar.')

  const { data, error } = await db()
    .from('shop_theme')
    .update(clean)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`No se pudo guardar el tema: ${error.message}`)
  return data as ShopTheme
}

/** Atajo: publicar / despublicar el storefront de una marca. */
export async function setPublished(id: string, isPublished: boolean): Promise<ShopTheme> {
  return updateTheme(id, { is_published: isPublished })
}
