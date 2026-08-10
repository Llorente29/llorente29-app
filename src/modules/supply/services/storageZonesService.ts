// src/modules/supply/services/storageZonesService.ts
//
// AL1 — Cuerpo de gestión de almacén/zonas. Capa de servicio.
//
// Envuelve las 4 RPC (ver migración 20260617T1200_al1_storage_zones_rpcs.sql):
//   - getStorageCoverage   → storage_coverage     (KPIs + zonas con preview top-5)
//   - listOrphans          → storage_orphans      (huérfanos por valor, paginado)
//   - listZoneItems        → storage_zone_items   (artículos de una zona, paginado)
//   - assignItemsToZones   → assign_items_to_zones (bloque + multi-zona + principal)
//
// Las RPC devuelven jsonb; supabase-js lo entrega ya como objeto JS. Aquí se
// mapea snake_case → camelCase, coherente con storageAreaService / inventoryCountService.
//
// El CRUD de zonas (crear/renombrar/reordenar/archivar) y la asignación 1-a-1
// siguen en storageAreaService.ts; este servicio NO lo duplica, sólo añade la
// capa de cobertura/huérfanos/bloque que AL1 necesita.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { formatBaseQty } from '../lib/stockDisplay'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

type Row = Record<string, unknown>

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '')
}
function strOrNull(v: unknown): string | null {
  return v == null ? null : str(v)
}

// ─── Cobertura del local (status de cobertura) ───

export interface ZonePreviewItem {
  recipeItemId: string
  name: string
  valueEur: number
  qty: number
  unitAbbr: string | null
}

export interface ZoneCoverage {
  id: string
  name: string
  parentId: string | null
  position: number
  itemCount: number
  valueEur: number          // € imputado a esta zona (artículos cuya PRINCIPAL es esta)
  topItems: ZonePreviewItem[]
}

export interface CoverageKpis {
  rawActive: number
  placed: number
  orphans: number
  totalValue: number        // € total de stock en el local
  orphanValue: number       // € que está en artículos sin zona
}

export interface StorageCoverage {
  kpis: CoverageKpis
  zones: ZoneCoverage[]
}

function mapPreviewItem(r: Row): ZonePreviewItem {
  return {
    recipeItemId: str(r.recipe_item_id),
    name: str(r.name),
    valueEur: num(r.value_eur),
    qty: num(r.qty),
    unitAbbr: strOrNull(r.unit_abbr),
  }
}

/** KPIs de cobertura + zonas (con preview de sus 5 artículos de más valor). */
export async function getStorageCoverage(
  accountId: string,
  locationId: string,
): Promise<StorageCoverage> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('storage_coverage', {
    p_account: accountId,
    p_location: locationId,
  })
  if (error) throw new Error(`Error cargando la cobertura: ${error.message}`)
  const obj = (data ?? {}) as { kpis?: Row; zones?: Row[] }
  const k = (obj.kpis ?? {}) as Row
  const zones = (obj.zones ?? []) as Row[]
  return {
    kpis: {
      rawActive: num(k.raw_active),
      placed: num(k.placed),
      orphans: num(k.orphans),
      totalValue: num(k.total_value),
      orphanValue: num(k.orphan_value),
    },
    zones: zones.map(z => ({
      id: str(z.id),
      name: str(z.name),
      parentId: strOrNull(z.parent_id),
      position: num(z.position),
      itemCount: num(z.item_count),
      valueEur: num(z.value_eur),
      topItems: ((z.top_items ?? []) as Row[]).map(mapPreviewItem),
    })),
  }
}

// ─── Huérfanos del local (raw activos sin zona), por valor desc ───

export interface OrphanItem {
  recipeItemId: string
  name: string
  familyId: string | null
  familyName: string | null
  valueEur: number
  qty: number
  unitAbbr: string | null
}

export interface OrphanPage {
  total: number
  items: OrphanItem[]
}

export async function listOrphans(
  accountId: string,
  locationId: string,
  opts: { search?: string | null; familyId?: string | null; limit?: number; offset?: number } = {},
): Promise<OrphanPage> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('storage_orphans', {
    p_account: accountId,
    p_location: locationId,
    p_search: opts.search?.trim() || undefined,
    p_family: opts.familyId || undefined,
    p_limit: opts.limit ?? 50,
    p_offset: opts.offset ?? 0,
  })
  if (error) throw new Error(`Error cargando los huérfanos: ${error.message}`)
  const obj = (data ?? {}) as { total?: unknown; items?: Row[] }
  return {
    total: num(obj.total),
    items: ((obj.items ?? []) as Row[]).map(r => ({
      recipeItemId: str(r.recipe_item_id),
      name: str(r.name),
      familyId: strOrNull(r.family_id),
      familyName: strOrNull(r.family_name),
      valueEur: num(r.value_eur),
      qty: num(r.qty),
      unitAbbr: strOrNull(r.unit_abbr),
    })),
  }
}

// ─── Artículos de una zona (lista completa + buscador), por valor desc ───

export interface ZoneItem {
  recipeItemId: string
  name: string
  valueEur: number
  qty: number
  unitAbbr: string | null
  isPrimary: boolean        // position 0 = esta es su zona principal (lleva el €)
}

export interface ZoneItemsPage {
  total: number
  items: ZoneItem[]
}

export async function listZoneItems(
  accountId: string,
  areaId: string,
  opts: { search?: string | null; limit?: number; offset?: number } = {},
): Promise<ZoneItemsPage> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('storage_zone_items', {
    p_account: accountId,
    p_area: areaId,
    p_search: opts.search?.trim() || undefined,
    p_limit: opts.limit ?? 50,
    p_offset: opts.offset ?? 0,
  })
  if (error) throw new Error(`Error cargando los artículos de la zona: ${error.message}`)
  const obj = (data ?? {}) as { total?: unknown; items?: Row[] }
  return {
    total: num(obj.total),
    items: ((obj.items ?? []) as Row[]).map(r => ({
      recipeItemId: str(r.recipe_item_id),
      name: str(r.name),
      valueEur: num(r.value_eur),
      qty: num(r.qty),
      unitAbbr: strOrNull(r.unit_abbr),
      isPrimary: Boolean(r.is_primary),
    })),
  }
}

// ─── Asignación EN BLOQUE (multi-zona + principal) ───

export type AssignMode = 'add' | 'replace'

/**
 * Asigna N artículos a M zonas de una vez.
 * - primaryZoneId debe estar entre zoneIds; recibe position 0 (lleva el €).
 * - mode 'add'     → mantiene las zonas que el artículo ya tuviera.
 * - mode 'replace' → fija solo estas (quita el artículo de las otras zonas DE ESTE LOCAL).
 * Devuelve cuántos artículos se asignaron.
 */
export async function assignItemsToZones(
  accountId: string,
  itemIds: string[],
  zoneIds: string[],
  primaryZoneId: string,
  mode: AssignMode = 'add',
): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('assign_items_to_zones', {
    p_account: accountId,
    p_item_ids: itemIds,
    p_zone_ids: zoneIds,
    p_primary_zone_id: primaryZoneId,
    p_mode: mode,
  })
  if (error) throw new Error(`No se pudo asignar: ${error.message}`)
  const obj = (data ?? {}) as { assigned?: unknown }
  return num(obj.assigned)
}

// ─── Quitar (a huérfanos / de una zona / vaciar zona) ───

/**
 * Quita asignaciones zona↔artículo. Semántica:
 *   - itemIds undefined → todos los artículos de las zonas dadas (= vaciar zona)
 *   - zoneIds undefined → de TODAS las zonas del local (= mandar a huérfano)
 *   - ambos dados        → esos artículos en esas zonas
 * Devuelve cuántas asignaciones se quitaron. Promueve principal automáticamente.
 */
export async function unassignItemsFromZones(
  accountId: string,
  locationId: string,
  opts: { itemIds?: string[] | null; zoneIds?: string[] | null } = {},
): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('unassign_items_from_zones', {
    p_account: accountId,
    p_location: locationId,
    p_item_ids: opts.itemIds ?? undefined,
    p_zone_ids: opts.zoneIds ?? undefined,
  })
  if (error) throw new Error(`No se pudo quitar: ${error.message}`)
  const obj = (data ?? {}) as { removed?: unknown }
  return num(obj.removed)
}

/** Vacía una zona: todos sus artículos vuelven a "sin zona". */
export function emptyZone(accountId: string, locationId: string, zoneId: string): Promise<number> {
  return unassignItemsFromZones(accountId, locationId, { zoneIds: [zoneId] })
}

/** Manda artículos a "sin zona" (los quita de todas sus zonas en el local). */
export function sendItemsToOrphans(accountId: string, locationId: string, itemIds: string[]): Promise<number> {
  return unassignItemsFromZones(accountId, locationId, { itemIds })
}

/** Quita artículos de UNA zona concreta (conserva sus otras zonas). */
export function removeItemsFromZone(accountId: string, locationId: string, itemIds: string[], zoneId: string): Promise<number> {
  return unassignItemsFromZones(accountId, locationId, { itemIds, zoneIds: [zoneId] })
}

// ─── Mover de una zona a otra (conserva el resto; el destino hereda el rol) ───

/**
 * Mueve N artículos de una zona a otra. Desde "sin zona" se usa
 * assignItemsToZones (no esto): mover siempre parte de una zona origen.
 * Devuelve cuántos artículos se movieron.
 */
export async function moveItemsToZone(
  accountId: string,
  itemIds: string[],
  fromZoneId: string,
  toZoneId: string,
): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('move_items_to_zone', {
    p_account: accountId,
    p_item_ids: itemIds,
    p_from_zone_id: fromZoneId,
    p_to_zone_id: toZoneId,
  })
  if (error) throw new Error(`No se pudo mover: ${error.message}`)
  const obj = (data ?? {}) as { moved?: unknown }
  return num(obj.moved)
}

// ─── Presentación: cantidad legible en UNIDAD BASE (kg/L/ud) ───
// Nunca en recuento de formato de compra — ver stockDisplay.ts (formatBaseQty).

export interface StockQtyDisplay {
  main: string            // lo grande: "5 L" / "3,5 kg" / "-25 g" / "12 ud" / "sin contar"
  counted: boolean        // false = nunca contado (se pinta en gris)
  negative: boolean       // true = qty < 0 — AUTO-PROTECCIÓN: nunca se esconde como "sin contar"
}

/**
 * Cómo mostrar la cantidad de un artículo:
 *   - sin stock ni valor (ni positivo ni negativo) → "sin contar" (gris): no
 *     se ha contado nunca.
 *   - si no → la cantidad en unidad base, legible (g→kg, ml→L desde 1000). Un
 *     negativo se enseña TAL CUAL (nunca 0 ni "sin contar" — vigía de stock
 *     negativo, 10/08: el fallo silencioso que esto reemplaza escondía 24
 *     fichas en negativo porque `q > 0`/`valueEur > 0` excluían el negativo).
 * qty viene SIEMPRE en la unidad base del artículo.
 */
export function formatStockQty(
  qty: number | null | undefined,
  unitAbbr: string | null,
  valueEur?: number | null,
): StockQtyDisplay {
  const q = Number(qty)
  const hasQty = Number.isFinite(q) && q !== 0
  const hasValue = valueEur != null && Number.isFinite(valueEur) && valueEur !== 0
  if (!hasQty && !hasValue) return { main: 'sin contar', counted: false, negative: false }
  return { main: formatBaseQty(Number.isFinite(q) ? q : 0, unitAbbr), counted: true, negative: q < 0 }
}
