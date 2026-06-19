// src/modules/multitenancy/services/brandsService.ts
//
// Service CRUD del catálogo de marcas. Scope cuenta.
//
// Operaciones:
//   - listBrands(opts)         → lista filtrada/paginada
//   - getBrandById(id)         → una marca
//   - getBrandBySlug(acc,slug) → para validar duplicados
//   - createBrand(input)       → alta
//   - updateBrand(id, patch)   → modificación
//   - archiveBrand(id)         → soft delete (preserva histórico ventas)
//   - restoreBrand(id)         → des-archivar
//
// Convención de errores: todos los métodos LANZAN Error si falla la query.
// Los componentes envuelven en try/catch. Coherente con authService /
// notificationsService del proyecto.
//
// Identidad operativa (regla v17.1):
//   - actorId: string | null  → currentEmployee?.id ?? null
//   - actorName: string       → currentEmployee?.name ?? (isAdmin ? adminEmail : 'Anónimo')
//   El caller pasa estos valores; el service NO accede al context.
//
// NOTA DEUDA 0 (2026-06-03): la comisión NO vive en brand. Se eliminó
// brand.commission_pct (era residuo ignorado por la economía). La comisión
// vive ÚNICAMENTE en brand_channel_rate. Ver brandChannelRateService.ts.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { slugify } from '../utils/slug'
import type {
  Brand,
  BrandInsert,
  BrandUpdate,
  RowBrand,
  RowBrandInsert,
  RowBrandUpdate,
  BrandOwnershipType,
} from '../../../types/multitenancy'

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

// NOTA: rowToBrand exportado para tests unitarios. No usar fuera de tests
// ni de este service — el resto del proyecto debe consumir las funciones
// públicas (listBrands, getBrandById, etc.) que ya devuelven Brand mapeado.
export function rowToBrand(row: RowBrand): Brand {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    slug: row.slug,
    ownershipType: row.ownership_type as BrandOwnershipType,
    color: row.color,
    logoUrl: row.logo_url,
    shopUrl: row.shop_url,
    qrCaption: row.qr_caption,
    notes: row.notes,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
  }
}

function brandInsertToRow(input: BrandInsert): RowBrandInsert {
  return {
    account_id: input.accountId,
    name: input.name,
    slug: input.slug,
    ownership_type: input.ownershipType ?? 'own',
    color: input.color ?? null,
    logo_url: input.logoUrl ?? null,
    notes: input.notes ?? null,
    is_active: input.isActive ?? true,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
}

function brandUpdateToRow(patch: BrandUpdate): RowBrandUpdate {
  const row: RowBrandUpdate = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.slug !== undefined) row.slug = patch.slug
  if (patch.ownershipType !== undefined) row.ownership_type = patch.ownershipType
  if (patch.color !== undefined) row.color = patch.color
  if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl
  if (patch.shopUrl !== undefined) row.shop_url = patch.shopUrl
  if (patch.qrCaption !== undefined) row.qr_caption = patch.qrCaption
  if (patch.notes !== undefined) row.notes = patch.notes
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

/**
 * Convierte un nombre de marca en slug URL-safe.
 *
 * Mantenido como wrapper de `slugify` para compatibilidad con imports
 * y tests existentes. Internamente delega en la utilidad genérica.
 *
 * @deprecated en sentido suave: para código nuevo, importa `slugify` de
 * `../utils/slug`. Este wrapper se mantiene por estabilidad.
 */
export const slugifyBrandName = slugify

// ─────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────

export interface ListBrandsOptions {
  accountId: string
  /** Si true, incluye marcas archivadas. Default false. */
  includeArchived?: boolean
  /** Si false, excluye marcas con is_active=false. Default true (las incluye). */
  includeInactive?: boolean
  /** Filtro de texto sobre name o slug (case-insensitive). */
  search?: string
  /** Filtra por tipo. */
  ownershipType?: BrandOwnershipType
  /** Paginación. */
  limit?: number
  offset?: number
}

/**
 * Lista marcas filtradas/paginadas. Ordenadas alfabéticamente por nombre.
 */
export async function listBrands(opts: ListBrandsOptions): Promise<Brand[]> {
  requireSupabase()
  let query = supabase!
    .from('brand')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('name', { ascending: true })

  if (!opts.includeArchived) {
    query = query.is('archived_at', null)
  }
  if (opts.includeInactive === false) {
    query = query.eq('is_active', true)
  }
  if (opts.ownershipType) {
    query = query.eq('ownership_type', opts.ownershipType)
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
    throw new Error(`Error listando marcas: ${error.message}`)
  }
  return (data ?? []).map(rowToBrand)
}

/**
 * Obtiene una marca por id. Devuelve null si no existe.
 */
export async function getBrandById(id: string): Promise<Brand | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo marca ${id}: ${error.message}`)
  }
  return data ? rowToBrand(data) : null
}

/**
 * Obtiene una marca por slug dentro de una cuenta. Útil para validar duplicados.
 */
export async function getBrandBySlug(
  accountId: string,
  slug: string
): Promise<Brand | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand')
    .select('*')
    .eq('account_id', accountId)
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo marca por slug: ${error.message}`)
  }
  return data ? rowToBrand(data) : null
}

/**
 * Crea una nueva marca. Valida que el slug sea único en la cuenta.
 * Si no se pasa slug en input, lo genera desde name.
 */
export async function createBrand(input: BrandInsert): Promise<Brand> {
  requireSupabase()

  const finalInput: BrandInsert = {
    ...input,
    slug: input.slug && input.slug.trim() !== ''
      ? input.slug
      : slugify(input.name),
  }

  const existing = await getBrandBySlug(finalInput.accountId, finalInput.slug)
  if (existing) {
    throw new Error(
      `Ya existe una marca con el slug "${finalInput.slug}" en esta cuenta.`
    )
  }

  const { data, error } = await supabase!
    .from('brand')
    .insert(brandInsertToRow(finalInput))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error creando marca: ${error.message}`)
  }
  return rowToBrand(data)
}

/**
 * Actualiza una marca. Solo campos presentes en patch se modifican.
 */
export async function updateBrand(
  id: string,
  patch: BrandUpdate
): Promise<Brand> {
  requireSupabase()

  if (patch.slug !== undefined) {
    const current = await getBrandById(id)
    if (!current) {
      throw new Error(`Marca ${id} no encontrada.`)
    }
    if (patch.slug !== current.slug) {
      const dup = await getBrandBySlug(current.accountId, patch.slug)
      if (dup && dup.id !== id) {
        throw new Error(`Ya existe una marca con el slug "${patch.slug}".`)
      }
    }
  }

  const rowPatch = brandUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getBrandById(id)
    if (!current) throw new Error(`Marca ${id} no encontrada.`)
    return current
  }

  const { data, error } = await supabase!
    .from('brand')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando marca ${id}: ${error.message}`)
  }
  return rowToBrand(data)
}

/**
 * Archiva una marca (soft delete). Marca is_active=false y archived_at=now().
 * Preserva el histórico de ventas asociado.
 */
export async function archiveBrand(id: string): Promise<Brand> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand')
    .update({
      is_active: false,
      archived_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error archivando marca ${id}: ${error.message}`)
  }
  return rowToBrand(data)
}

/**
 * Des-archiva una marca. La reactiva y borra archived_at.
 */
export async function restoreBrand(id: string): Promise<Brand> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand')
    .update({
      is_active: true,
      archived_at: null,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error restaurando marca ${id}: ${error.message}`)
  }
  return rowToBrand(data)
}
