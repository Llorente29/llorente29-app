// src/modules/multitenancy/services/brandLocationService.ts
//
// Service de la tabla `brand_location_availability` — relación many-to-many
// entre brand y location. Define qué marcas opera cada local de la cuenta.
//
// MODELO: toggle, no histórico.
//   - Cada par (account_id, brand_id, location_id) tiene COMO MÁXIMO 1 row.
//   - Garantizado por UNIQUE constraint en BBDD:
//     brand_location_availability_unique_triplet
//   - "Opt-in": si no hay row, la marca NO está disponible en ese local.
//   - is_active=true  → marca opera ahí hoy
//   - is_active=false → marca operó ahí en el pasado pero está retirada
//   - active_since/inactive_since → metadatos de fechas
//
// API orientada a casos de uso (no CRUD genérico):
//   - listBrandsForLocation(...)       → Brand[] con JOIN
//   - listLocationsForBrand(...)       → string[] de UUIDs
//   - setBrandAvailability(...)        → upsert idempotente
//   - removeBrandAvailability(...)     → soft delete (is_active=false + inactive_since)
//   - getBrandAvailability(...)        → lookup del par exacto
//   - listBrandLocationAvailabilities → listado raw (administrativo)
//
// Convención de errores: idéntica a otros services del módulo (throw Error).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  Brand,
  BrandLocationAvailability,
  BrandLocationAvailabilityInsert,
  RowBrand,
  RowBrandLocationAvailability,
  RowBrandLocationAvailabilityInsert,
  RowBrandLocationAvailabilityUpdate,
} from '../../../types/multitenancy'
import { rowToBrand } from './brandsService'

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

// NOTA: exportado para tests unitarios. No usar fuera de tests ni de
// este service.
export function rowToBrandLocationAvailability(
  row: RowBrandLocationAvailability
): BrandLocationAvailability {
  return {
    id: row.id,
    accountId: row.account_id,
    brandId: row.brand_id,
    locationId: row.location_id,
    isActive: row.is_active,
    activeSince: row.active_since,
    inactiveSince: row.inactive_since,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function blaInsertToRow(
  input: BrandLocationAvailabilityInsert
): RowBrandLocationAvailabilityInsert {
  return {
    account_id: input.accountId,
    brand_id: input.brandId,
    location_id: input.locationId,
    is_active: input.isActive ?? true,
    active_since: input.activeSince ?? null,
    inactive_since: input.inactiveSince ?? null,
    notes: input.notes ?? null,
  }
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

/** ISO date YYYY-MM-DD para el día actual (UTC). */
function todayISODate(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─────────────────────────────────────────────────────────────────────
// API pública — consulta orientada a casos de uso
// ─────────────────────────────────────────────────────────────────────

export interface ListBrandsForLocationOptions {
  /** Si true, incluye también marcas con is_active=false en la availability. Default false. */
  includeInactive?: boolean
}

/**
 * Lista las marcas que operan (u operaron) en un local.
 *
 * Hace JOIN contra `brand` y devuelve directamente entidades Brand del dominio,
 * filtrando solo las availabilities activas por defecto.
 *
 * Caso de uso típico: el header de la app pregunta "¿qué marcas tiene Alcalá?"
 * para poblar el BrandFilterSelector.
 */
export async function listBrandsForLocation(
  accountId: string,
  locationId: string,
  opts: ListBrandsForLocationOptions = {}
): Promise<Brand[]> {
  requireSupabase()
  let query = supabase!
    .from('brand_location_availability')
    .select('brand:brand_id(*)')
    .eq('account_id', accountId)
    .eq('location_id', locationId)

  if (!opts.includeInactive) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(
      `Error listando marcas del local ${locationId}: ${error.message}`
    )
  }

  // El embed devuelve { brand: RowBrand | null } por fila.
  // Filtramos brands nulos defensivamente (no debería ocurrir con FK válida).
  const brands: Brand[] = []
  for (const row of data ?? []) {
    const r = row as unknown as { brand: RowBrand | null }
    if (r.brand) brands.push(rowToBrand(r.brand))
  }

  // Ordenar alfabéticamente en cliente (Supabase REST no ordena
  // trivialmente por columna de tabla embebida).
  brands.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return brands
}

export interface ListLocationsForBrandOptions {
  /** Si true, incluye locations con is_active=false. Default false. */
  includeInactive?: boolean
}

/**
 * Lista los UUIDs de location en los que opera (u operó) una marca.
 *
 * Devuelve UUIDs (no entidades Location) porque las locations viven en
 * otro módulo del proyecto y este service no debe acoplarse a su shape.
 * El caller cruza esos UUIDs con su fuente de locations si necesita más.
 */
export async function listLocationsForBrand(
  accountId: string,
  brandId: string,
  opts: ListLocationsForBrandOptions = {}
): Promise<string[]> {
  requireSupabase()
  let query = supabase!
    .from('brand_location_availability')
    .select('location_id')
    .eq('account_id', accountId)
    .eq('brand_id', brandId)

  if (!opts.includeInactive) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(
      `Error listando locales de la marca ${brandId}: ${error.message}`
    )
  }
  return (data ?? []).map((r) => r.location_id)
}

/**
 * Obtiene la availability de un par (brand, location) en una cuenta.
 * Devuelve null si no existe row para ese triplete.
 */
export async function getBrandAvailability(
  accountId: string,
  brandId: string,
  locationId: string
): Promise<BrandLocationAvailability | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand_location_availability')
    .select('*')
    .eq('account_id', accountId)
    .eq('brand_id', brandId)
    .eq('location_id', locationId)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo availability: ${error.message}`)
  }
  return data ? rowToBrandLocationAvailability(data) : null
}

// ─────────────────────────────────────────────────────────────────────
// API pública — escritura
// ─────────────────────────────────────────────────────────────────────

/**
 * Marca una marca como disponible en un local (toggle ON), o actualiza
 * los metadatos si ya existía.
 *
 * Atómico vía ON CONFLICT del UNIQUE constraint
 * brand_location_availability_unique_triplet. NO hay race condition.
 *
 * Comportamiento:
 *   - Si NO existe row para (account_id, brand_id, location_id) → la crea
 *   - Si ya existe (esté activa o inactiva) → la actualiza con los valores
 *     del input. Si pasas isActive=true sobre una row inactiva, la reactivas.
 *
 * Si NO especificas activeSince y la availability se está creando/activando,
 * se rellena automáticamente con la fecha de hoy (YYYY-MM-DD UTC).
 */
export async function setBrandAvailability(
  input: BrandLocationAvailabilityInsert
): Promise<BrandLocationAvailability> {
  requireSupabase()

  const willBeActive = input.isActive ?? true
  const finalInput: BrandLocationAvailabilityInsert = {
    ...input,
    isActive: willBeActive,
    activeSince:
      input.activeSince === undefined && willBeActive
        ? todayISODate()
        : input.activeSince,
  }

  const { data, error } = await supabase!
    .from('brand_location_availability')
    .upsert(blaInsertToRow(finalInput), {
      onConflict: 'account_id,brand_id,location_id',
    })
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error en setBrandAvailability: ${error.message}`)
  }
  return rowToBrandLocationAvailability(data)
}

/**
 * Retira una marca de un local (toggle OFF). Soft delete:
 *   - is_active = false
 *   - inactive_since = hoy
 *
 * Conserva el resto de campos (active_since, notes) como histórico.
 * Si la row no existe, lanza error porque no tiene sentido retirar lo
 * que no estaba puesto. Si quieres "asegurar OFF independientemente del
 * estado previo", usa setBrandAvailability con isActive: false.
 */
export async function removeBrandAvailability(
  accountId: string,
  brandId: string,
  locationId: string
): Promise<BrandLocationAvailability> {
  requireSupabase()

  const current = await getBrandAvailability(accountId, brandId, locationId)
  if (!current) {
    throw new Error(
      `No hay availability para brand=${brandId} y location=${locationId} en esta cuenta.`
    )
  }

  const patch: RowBrandLocationAvailabilityUpdate = {
    is_active: false,
    inactive_since: todayISODate(),
  }

  const { data, error } = await supabase!
    .from('brand_location_availability')
    .update(patch)
    .eq('id', current.id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error en removeBrandAvailability: ${error.message}`)
  }
  return rowToBrandLocationAvailability(data)
}

// ─────────────────────────────────────────────────────────────────────
// API pública — listado administrativo
// ─────────────────────────────────────────────────────────────────────

export interface ListBrandLocationAvailabilitiesOptions {
  accountId: string
  /** Filtrar por brand. */
  brandId?: string
  /** Filtrar por location. */
  locationId?: string
  /** Si false, excluye inactivas. Default true (incluye ambas). */
  includeInactive?: boolean
  /** Paginación. */
  limit?: number
  offset?: number
}

/**
 * Lista raw de availabilities. Pensado para vistas administrativas
 * (no para el header de la app, ahí se usa listBrandsForLocation).
 */
export async function listBrandLocationAvailabilities(
  opts: ListBrandLocationAvailabilitiesOptions
): Promise<BrandLocationAvailability[]> {
  requireSupabase()
  let query = supabase!
    .from('brand_location_availability')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('created_at', { ascending: false })

  if (opts.brandId) query = query.eq('brand_id', opts.brandId)
  if (opts.locationId) query = query.eq('location_id', opts.locationId)
  if (opts.includeInactive === false) query = query.eq('is_active', true)

  if (typeof opts.limit === 'number') {
    const from = opts.offset ?? 0
    const to = from + opts.limit - 1
    query = query.range(from, to)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando availabilities: ${error.message}`)
  }
  return (data ?? []).map(rowToBrandLocationAvailability)
}
