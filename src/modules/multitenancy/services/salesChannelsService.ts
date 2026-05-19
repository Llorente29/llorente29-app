// src/modules/multitenancy/services/salesChannelsService.ts
//
// Service CRUD del catálogo de canales de venta. Scope cuenta.
//
// Operaciones:
//   - listSalesChannels(opts)         → lista filtrada/paginada
//   - getSalesChannelById(id)         → un canal
//   - getSalesChannelBySlug(acc,slug) → para validar duplicados
//   - createSalesChannel(input)       → alta
//   - updateSalesChannel(id, patch)   → modificación
//   - archiveSalesChannel(id)         → soft delete
//   - restoreSalesChannel(id)         → des-archivar
//
// Convención de errores: idéntica a brandsService — todos los métodos
// LANZAN Error si falla la query.
//
// Diferencias con brandsService:
//   - No tiene logoUrl, notes, createdBy, createdByName (la tabla no los tiene)
//   - channelType en vez de ownershipType (5 valores en vez de 2)
//   - Tabla `sales_channel` (no `sales_channels`, sin la "s" final)

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { slugify } from '../utils/slug'
import type {
  SalesChannel,
  SalesChannelInsert,
  SalesChannelUpdate,
  RowSalesChannel,
  RowSalesChannelInsert,
  RowSalesChannelUpdate,
  SalesChannelType,
} from '../../../types/multitenancy'

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

// NOTA: rowToSalesChannel exportado para tests unitarios. No usar fuera de
// tests ni de este service.
export function rowToSalesChannel(row: RowSalesChannel): SalesChannel {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    slug: row.slug,
    channelType: row.channel_type as SalesChannelType,
    defaultCommissionPct: row.default_commission_pct,
    color: row.color,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function salesChannelInsertToRow(
  input: SalesChannelInsert
): RowSalesChannelInsert {
  return {
    account_id: input.accountId,
    name: input.name,
    slug: input.slug,
    channel_type: input.channelType ?? 'other',
    default_commission_pct: input.defaultCommissionPct ?? null,
    color: input.color ?? null,
    is_active: input.isActive ?? true,
  }
}

function salesChannelUpdateToRow(
  patch: SalesChannelUpdate
): RowSalesChannelUpdate {
  const row: RowSalesChannelUpdate = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.slug !== undefined) row.slug = patch.slug
  if (patch.channelType !== undefined) row.channel_type = patch.channelType
  if (patch.defaultCommissionPct !== undefined) {
    row.default_commission_pct = patch.defaultCommissionPct
  }
  if (patch.color !== undefined) row.color = patch.color
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

export interface ListSalesChannelsOptions {
  accountId: string
  /** Si true, incluye canales archivados. Default false. */
  includeArchived?: boolean
  /** Si false, excluye canales con is_active=false. Default true. */
  includeInactive?: boolean
  /** Filtro de texto sobre name o slug (case-insensitive). */
  search?: string
  /** Filtra por tipo de canal. */
  channelType?: SalesChannelType
  /** Paginación. */
  limit?: number
  offset?: number
}

/**
 * Lista canales de venta filtrados/paginados. Ordenados alfabéticamente por nombre.
 */
export async function listSalesChannels(
  opts: ListSalesChannelsOptions
): Promise<SalesChannel[]> {
  requireSupabase()
  let query = supabase!
    .from('sales_channel')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('name', { ascending: true })

  if (!opts.includeArchived) {
    query = query.is('archived_at', null)
  }
  if (opts.includeInactive === false) {
    query = query.eq('is_active', true)
  }
  if (opts.channelType) {
    query = query.eq('channel_type', opts.channelType)
  }
  if (opts.search && opts.search.trim() !== '') {
    const term = `%${opts.search.trim()}%`
    query = query.or(`name.ilike.${term},slug.ilike.${term}`)
  }
  if (typeof opts.limit === 'number') {
    const from = opts.offset ?? 0
    const to = from + opts.limit - 1
    query = query.range(from, to)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando canales de venta: ${error.message}`)
  }
  return (data ?? []).map(rowToSalesChannel)
}

/**
 * Obtiene un canal por id. Devuelve null si no existe.
 */
export async function getSalesChannelById(
  id: string
): Promise<SalesChannel | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('sales_channel')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo canal ${id}: ${error.message}`)
  }
  return data ? rowToSalesChannel(data) : null
}

/**
 * Obtiene un canal por slug dentro de una cuenta. Útil para validar duplicados.
 */
export async function getSalesChannelBySlug(
  accountId: string,
  slug: string
): Promise<SalesChannel | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('sales_channel')
    .select('*')
    .eq('account_id', accountId)
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo canal por slug: ${error.message}`)
  }
  return data ? rowToSalesChannel(data) : null
}

/**
 * Crea un canal de venta. Valida slug único en la cuenta.
 * Si no se pasa slug en input, lo genera desde name.
 */
export async function createSalesChannel(
  input: SalesChannelInsert
): Promise<SalesChannel> {
  requireSupabase()

  const finalInput: SalesChannelInsert = {
    ...input,
    slug: input.slug && input.slug.trim() !== ''
      ? input.slug
      : slugify(input.name),
  }

  const existing = await getSalesChannelBySlug(
    finalInput.accountId,
    finalInput.slug
  )
  if (existing) {
    throw new Error(
      `Ya existe un canal con el slug "${finalInput.slug}" en esta cuenta.`
    )
  }

  const { data, error } = await supabase!
    .from('sales_channel')
    .insert(salesChannelInsertToRow(finalInput))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error creando canal: ${error.message}`)
  }
  return rowToSalesChannel(data)
}

/**
 * Actualiza un canal. Solo campos presentes en patch se modifican.
 */
export async function updateSalesChannel(
  id: string,
  patch: SalesChannelUpdate
): Promise<SalesChannel> {
  requireSupabase()

  if (patch.slug !== undefined) {
    const current = await getSalesChannelById(id)
    if (!current) {
      throw new Error(`Canal ${id} no encontrado.`)
    }
    if (patch.slug !== current.slug) {
      const dup = await getSalesChannelBySlug(current.accountId, patch.slug)
      if (dup && dup.id !== id) {
        throw new Error(`Ya existe un canal con el slug "${patch.slug}".`)
      }
    }
  }

  const rowPatch = salesChannelUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getSalesChannelById(id)
    if (!current) throw new Error(`Canal ${id} no encontrado.`)
    return current
  }

  const { data, error } = await supabase!
    .from('sales_channel')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando canal ${id}: ${error.message}`)
  }
  return rowToSalesChannel(data)
}

/**
 * Archiva un canal (soft delete). Marca is_active=false y archived_at=now().
 * Preserva el histórico de ventas asociado.
 */
export async function archiveSalesChannel(id: string): Promise<SalesChannel> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('sales_channel')
    .update({
      is_active: false,
      archived_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error archivando canal ${id}: ${error.message}`)
  }
  return rowToSalesChannel(data)
}

/**
 * Des-archiva un canal. Lo reactiva y borra archived_at.
 */
export async function restoreSalesChannel(id: string): Promise<SalesChannel> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('sales_channel')
    .update({
      is_active: true,
      archived_at: null,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error restaurando canal ${id}: ${error.message}`)
  }
  return rowToSalesChannel(data)
}
