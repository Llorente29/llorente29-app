// src/modules/kitchen/services/publishStatusService.ts
//
// T2e-A — ESTADO DE PUBLICACIÓN por marca (solo lectura). Lee catalog_publish /
// catalog_publish_target (lo que registra el Edge hubrise-catalog-publish) y compara
// la última publicación con el último cambio de la carta para saber si hay
// "cambios sin publicar" (modelo Otter: Publicado / Cambios sin publicar / Error).
//
// "Último cambio de la carta" = max(updated_at) de las superficies publicables de la
// marca: productos (menu_item), categorías (menu_category) y precios/disponibilidad
// por canal (menu_item_override). Cubre lo que el publicador envía. Los cambios solo
// en slots de combo o en grupos de modificadores sueltos son un hueco menor conocido
// (suelen ir acompañados de un toque en menu_item).
//
// Patrón del proyecto: supabase directo, requireSupabase(), mappers row->domain.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

export type PublishState = 'never' | 'published' | 'stale' | 'partial' | 'error'

export interface PublishTargetStatus {
  connectionName: string | null
  externalCatalogId: string | null
  status: string            // ok | error | pending
  errorText: string | null
  publishedAt: string | null
}

export interface BrandPublishStatus {
  state: PublishState
  lastPublishAt: string | null   // requested_at de la última publicación
  lastStatus: string | null      // done | partial | failed
  lastNote: string | null
  lastChangeAt: string | null    // max(updated_at) de la carta
  targets: PublishTargetStatus[]
}

export interface PublishHistoryEntry {
  id: string
  status: string
  note: string | null
  requestedAt: string
  targets: PublishTargetStatus[]
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

function targetRow(r: Record<string, unknown>): PublishTargetStatus {
  return {
    connectionName: (r.connection_name as string) ?? null,
    externalCatalogId: (r.external_catalog_id as string) ?? null,
    status: (r.status as string) ?? 'pending',
    errorText: (r.error_text as string) ?? null,
    publishedAt: (r.published_at as string) ?? null,
  }
}

// max(updated_at) de las superficies publicables de la marca.
async function getBrandLastChange(accountId: string, brandId: string): Promise<string | null> {
  const sb = supabase!
  // Una consulta por superficie, pidiendo solo el updated_at más reciente.
  const [items, cats] = await Promise.all([
    sb.from('menu_item').select('updated_at')
      .eq('account_id', accountId).eq('brand_id', brandId)
      .order('updated_at', { ascending: false }).limit(1),
    sb.from('menu_category').select('updated_at')
      .eq('account_id', accountId).eq('brand_id', brandId)
      .order('updated_at', { ascending: false }).limit(1),
  ])
  const times: string[] = []
  const t1 = items.data?.[0]?.updated_at as string | undefined
  const t2 = cats.data?.[0]?.updated_at as string | undefined
  if (t1) times.push(t1)
  if (t2) times.push(t2)

  // Overrides por canal: vía los menu_item de la marca (no tiene brand_id propio).
  const { data: ids } = await sb.from('menu_item').select('id')
    .eq('account_id', accountId).eq('brand_id', brandId)
  const itemIds = (ids ?? []).map((r) => r.id as string)
  if (itemIds.length > 0) {
    const { data: ov } = await sb.from('menu_item_override').select('updated_at')
      .eq('account_id', accountId).in('menu_item_id', itemIds)
      .order('updated_at', { ascending: false }).limit(1)
    const t3 = ov?.[0]?.updated_at as string | undefined
    if (t3) times.push(t3)
  }

  if (times.length === 0) return null
  return times.sort().at(-1) ?? null   // ISO 8601 ordena lexicográficamente
}

/** Estado de publicación de una marca: último resultado + si hay cambios sin publicar. */
export async function getBrandPublishStatus(
  accountId: string, brandId: string,
): Promise<BrandPublishStatus> {
  requireSupabase()
  const sb = supabase!

  const { data: pubs, error } = await sb.from('catalog_publish')
    .select('id, status, note, requested_at')
    .eq('account_id', accountId).eq('brand_id', brandId)
    .order('requested_at', { ascending: false }).limit(1)
  if (error) throw new Error(`Error leyendo estado de publicación: ${error.message}`)

  const lastChangeAt = await getBrandLastChange(accountId, brandId)

  const last = pubs?.[0]
  if (!last) {
    return { state: 'never', lastPublishAt: null, lastStatus: null, lastNote: null, lastChangeAt, targets: [] }
  }

  const { data: tg } = await sb.from('catalog_publish_target')
    .select('connection_name, external_catalog_id, status, error_text, published_at')
    .eq('publish_id', last.id as string)
  const targets = (tg ?? []).map(targetRow)

  const lastPublishAt = last.requested_at as string
  const lastStatus = last.status as string

  let state: PublishState
  if (lastStatus === 'failed') state = 'error'
  else if (lastChangeAt && lastChangeAt > lastPublishAt) state = 'stale'
  else if (lastStatus === 'partial') state = 'partial'
  else state = 'published'

  return { state, lastPublishAt, lastStatus, lastNote: (last.note as string) ?? null, lastChangeAt, targets }
}

/** Historial de publicaciones de una marca (con estado por conexión). */
export async function getBrandPublishHistory(
  accountId: string, brandId: string, limit = 5,
): Promise<PublishHistoryEntry[]> {
  requireSupabase()
  const sb = supabase!

  const { data: pubs, error } = await sb.from('catalog_publish')
    .select('id, status, note, requested_at')
    .eq('account_id', accountId).eq('brand_id', brandId)
    .order('requested_at', { ascending: false }).limit(limit)
  if (error) throw new Error(`Error leyendo historial de publicación: ${error.message}`)

  const ids = (pubs ?? []).map((p) => p.id as string)
  const targetsByPublish = new Map<string, PublishTargetStatus[]>()
  if (ids.length > 0) {
    const { data: tg } = await sb.from('catalog_publish_target')
      .select('publish_id, connection_name, external_catalog_id, status, error_text, published_at')
      .in('publish_id', ids)
    for (const r of tg ?? []) {
      const k = r.publish_id as string
      ;(targetsByPublish.get(k) ?? targetsByPublish.set(k, []).get(k)!).push(targetRow(r))
    }
  }

  return (pubs ?? []).map((p) => ({
    id: p.id as string,
    status: p.status as string,
    note: (p.note as string) ?? null,
    requestedAt: p.requested_at as string,
    targets: targetsByPublish.get(p.id as string) ?? [],
  }))
}
