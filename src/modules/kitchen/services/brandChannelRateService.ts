// src/modules/kitchen/services/brandChannelRateService.ts
//
// Service CRUD de las tarifas de comisión por (marca × canal × tipo de reparto).
// Capa A / Economía de Plataformas (EP1). La tabla brand_channel_rate cuelga de
// brand_channel (la cabecera marca↔canal); una marca×canal tiene hasta 3 filas,
// una por service_type. UNIQUE(brand_channel_id, service_type).
//
// Operaciones:
//   - listRatesByBrandChannel(brandChannelId)  → tarifas (hasta 3) de un canal
//   - listRatesByAccount(opts)                 → todas las de la cuenta (dashboard)
//   - getRateById(id)                          → una
//   - upsertRate(input)                        → crea o actualiza por (bc_id, service_type)
//   - updateRate(id, patch)                    → modificación por id
//   - archiveRate(id)                          → soft delete
//   - restoreRate(id)                          → des-archivar
//
// Convención de errores: todos los métodos LANZAN Error. Componentes en try/catch.
// Identidad operativa (v17.1): el caller pasa createdBy/createdByName.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  BrandChannelRate,
  BrandChannelRateInsert,
  BrandChannelRateUpdate,
  RowBrandChannelRate,
  RowBrandChannelRateInsert,
  RowBrandChannelRateUpdate,
  ServiceType,
} from '../../../types/kitchen'

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

export function rowToBrandChannelRate(row: RowBrandChannelRate): BrandChannelRate {
  return {
    id: row.id,
    accountId: row.account_id,
    brandChannelId: row.brand_channel_id,
    serviceType: row.service_type as ServiceType,
    commissionPct: row.commission_pct,
    commissionFixed: row.commission_fixed,
    commissionBase: row.commission_base as BrandChannelRate['commissionBase'],
    ownCustomerFee: row.own_customer_fee,
    ownCourierCost: row.own_courier_cost,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
  }
}

function rateInsertToRow(input: BrandChannelRateInsert): RowBrandChannelRateInsert {
  return {
    account_id: input.accountId,
    brand_channel_id: input.brandChannelId,
    service_type: input.serviceType,
    commission_pct: input.commissionPct ?? null,
    commission_fixed: input.commissionFixed ?? null,
    commission_base: input.commissionBase ?? 'pvp_con_iva',
    own_customer_fee: input.ownCustomerFee ?? null,
    own_courier_cost: input.ownCourierCost ?? null,
    is_active: input.isActive ?? true,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
}

function rateUpdateToRow(patch: BrandChannelRateUpdate): RowBrandChannelRateUpdate {
  const row: RowBrandChannelRateUpdate = {}
  if (patch.serviceType !== undefined) row.service_type = patch.serviceType
  if (patch.commissionPct !== undefined) row.commission_pct = patch.commissionPct
  if (patch.commissionFixed !== undefined) row.commission_fixed = patch.commissionFixed
  if (patch.commissionBase !== undefined) row.commission_base = patch.commissionBase
  if (patch.ownCustomerFee !== undefined) row.own_customer_fee = patch.ownCustomerFee
  if (patch.ownCourierCost !== undefined) row.own_courier_cost = patch.ownCourierCost
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt
  return row
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────

/**
 * Lista las tarifas (hasta 3, una por tipo de reparto) de un brand_channel.
 * Ordenadas por service_type para presentación estable.
 */
export async function listRatesByBrandChannel(
  brandChannelId: string,
  opts?: { includeArchived?: boolean }
): Promise<BrandChannelRate[]> {
  requireSupabase()
  let query = supabase!
    .from('brand_channel_rate')
    .select('*')
    .eq('brand_channel_id', brandChannelId)
    .order('service_type', { ascending: true })

  if (!opts?.includeArchived) {
    query = query.is('archived_at', null)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando tarifas del canal ${brandChannelId}: ${error.message}`)
  }
  return (data ?? []).map(rowToBrandChannelRate)
}

export interface ListRatesByAccountOptions {
  accountId: string
  includeArchived?: boolean
  includeInactive?: boolean
  serviceType?: ServiceType
  limit?: number
  offset?: number
}

/**
 * Lista todas las tarifas de la cuenta. Para el dashboard / ponderación por mix.
 */
export async function listRatesByAccount(
  opts: ListRatesByAccountOptions
): Promise<BrandChannelRate[]> {
  requireSupabase()
  let query = supabase!
    .from('brand_channel_rate')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('brand_channel_id', { ascending: true })
    .order('service_type', { ascending: true })

  if (!opts.includeArchived) {
    query = query.is('archived_at', null)
  }
  if (opts.includeInactive === false) {
    query = query.eq('is_active', true)
  }
  if (opts.serviceType) {
    query = query.eq('service_type', opts.serviceType)
  }
  if (typeof opts.limit === 'number') {
    const from = opts.offset ?? 0
    const to = from + opts.limit - 1
    query = query.range(from, to)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando tarifas de la cuenta: ${error.message}`)
  }
  return (data ?? []).map(rowToBrandChannelRate)
}

/**
 * Obtiene una tarifa por id. Devuelve null si no existe.
 */
export async function getRateById(id: string): Promise<BrandChannelRate | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand_channel_rate')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo tarifa ${id}: ${error.message}`)
  }
  return data ? rowToBrandChannelRate(data) : null
}

/**
 * Crea o actualiza la tarifa de un (brand_channel_id, service_type).
 * Aprovecha el UNIQUE para hacer upsert en una sola operación: es la forma
 * natural de la pantalla "Canales" (rellenar/editar las 3 tarifas).
 */
export async function upsertRate(
  input: BrandChannelRateInsert
): Promise<BrandChannelRate> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand_channel_rate')
    .upsert(rateInsertToRow(input), { onConflict: 'brand_channel_id,service_type' })
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error guardando tarifa: ${error.message}`)
  }
  return rowToBrandChannelRate(data)
}

/**
 * Actualiza una tarifa por id. Solo campos presentes en patch se modifican.
 */
export async function updateRate(
  id: string,
  patch: BrandChannelRateUpdate
): Promise<BrandChannelRate> {
  requireSupabase()

  const rowPatch = rateUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getRateById(id)
    if (!current) throw new Error(`Tarifa ${id} no encontrada.`)
    return current
  }

  const { data, error } = await supabase!
    .from('brand_channel_rate')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando tarifa ${id}: ${error.message}`)
  }
  return rowToBrandChannelRate(data)
}

/**
 * Archiva una tarifa (soft delete). is_active=false y archived_at=now().
 */
export async function archiveRate(id: string): Promise<BrandChannelRate> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand_channel_rate')
    .update({
      is_active: false,
      archived_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error archivando tarifa ${id}: ${error.message}`)
  }
  return rowToBrandChannelRate(data)
}

/**
 * Des-archiva una tarifa. La reactiva y borra archived_at.
 */
export async function restoreRate(id: string): Promise<BrandChannelRate> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand_channel_rate')
    .update({
      is_active: true,
      archived_at: null,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error restaurando tarifa ${id}: ${error.message}`)
  }
  return rowToBrandChannelRate(data)
}
