// src/modules/multitenancy/services/costCentersService.ts
//
// Service CRUD de centros de coste. Scope cuenta.
//
// Operaciones:
//   - listCostCenters(opts)           → lista filtrada/paginada
//   - getCostCenterById(id)           → un centro
//   - getCostCenterByCode(acc, code)  → para validar duplicados
//   - createCostCenter(input)         → alta
//   - updateCostCenter(id, patch)     → modificación
//   - archiveCostCenter(id)           → soft delete (solo is_active=false)
//   - restoreCostCenter(id)           → reactivar
//
// Convención de errores: idéntica a brandsService / salesChannelsService —
// todos los métodos LANZAN Error si falla la query.
//
// Diferencias con brandsService y salesChannelsService:
//   - NO tiene slug (el identificador legible es `code`, ya en formato corto)
//   - NO tiene archived_at: soft delete usa solo is_active=false
//   - NO importa slugify (no se necesita)
//   - Tiene FK opcional a `location` → filtro extra en list
//
// Sobre validación cross-account del locationId:
//   No se valida que el location pertenezca a la misma cuenta. La FK de
//   Postgres impide insertar un location_id inexistente. La validación
//   cross-account es responsabilidad de capa superior si se necesita.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  CostCenter,
  CostCenterInsert,
  CostCenterUpdate,
  RowCostCenter,
  RowCostCenterInsert,
  RowCostCenterUpdate,
} from '../../../types/multitenancy'

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

// NOTA: rowToCostCenter exportado para tests unitarios. No usar fuera de
// tests ni de este service.
export function rowToCostCenter(row: RowCostCenter): CostCenter {
  return {
    id: row.id,
    accountId: row.account_id,
    locationId: row.location_id,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function costCenterInsertToRow(input: CostCenterInsert): RowCostCenterInsert {
  return {
    account_id: input.accountId,
    location_id: input.locationId ?? null,
    code: input.code,
    name: input.name,
    is_active: input.isActive ?? true,
  }
}

function costCenterUpdateToRow(patch: CostCenterUpdate): RowCostCenterUpdate {
  const row: RowCostCenterUpdate = {}
  if (patch.locationId !== undefined) row.location_id = patch.locationId
  if (patch.code !== undefined) row.code = patch.code
  if (patch.name !== undefined) row.name = patch.name
  if (patch.isActive !== undefined) row.is_active = patch.isActive
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

export interface ListCostCentersOptions {
  accountId: string
  /** Si false, excluye centros con is_active=false. Default true (los incluye). */
  includeInactive?: boolean
  /**
   * Filtrar por location.
   *   - undefined → todos los centros (incluyendo los que no tienen location asignado)
   *   - UUID      → solo centros asignados a ese local
   *   - null      → solo centros sin location asignado (cross-local / generales)
   */
  locationId?: string | null
  /** Filtro de texto sobre code o name (case-insensitive). */
  search?: string
  /** Paginación. */
  limit?: number
  offset?: number
}

/**
 * Lista cost centers filtrados/paginados. Ordenados alfabéticamente por code.
 */
export async function listCostCenters(
  opts: ListCostCentersOptions
): Promise<CostCenter[]> {
  requireSupabase()
  let query = supabase!
    .from('cost_center')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('code', { ascending: true })

  if (opts.includeInactive === false) {
    query = query.eq('is_active', true)
  }
  if (opts.locationId === null) {
    query = query.is('location_id', null)
  } else if (typeof opts.locationId === 'string') {
    query = query.eq('location_id', opts.locationId)
  }
  if (opts.search && opts.search.trim() !== '') {
    const term = `%${opts.search.trim()}%`
    query = query.or(`code.ilike.${term},name.ilike.${term}`)
  }
  if (typeof opts.limit === 'number') {
    const from = opts.offset ?? 0
    const to = from + opts.limit - 1
    query = query.range(from, to)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando centros de coste: ${error.message}`)
  }
  return (data ?? []).map(rowToCostCenter)
}

/**
 * Obtiene un cost center por id. Devuelve null si no existe.
 */
export async function getCostCenterById(
  id: string
): Promise<CostCenter | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('cost_center')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo cost center ${id}: ${error.message}`)
  }
  return data ? rowToCostCenter(data) : null
}

/**
 * Obtiene un cost center por code dentro de una cuenta. Útil para validar duplicados.
 */
export async function getCostCenterByCode(
  accountId: string,
  code: string
): Promise<CostCenter | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('cost_center')
    .select('*')
    .eq('account_id', accountId)
    .eq('code', code)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo cost center por code: ${error.message}`)
  }
  return data ? rowToCostCenter(data) : null
}

/**
 * Crea un cost center. Valida que el code sea único en la cuenta.
 */
export async function createCostCenter(
  input: CostCenterInsert
): Promise<CostCenter> {
  requireSupabase()

  if (!input.code || input.code.trim() === '') {
    throw new Error('El code del cost center es obligatorio.')
  }

  const existing = await getCostCenterByCode(input.accountId, input.code)
  if (existing) {
    throw new Error(
      `Ya existe un cost center con el code "${input.code}" en esta cuenta.`
    )
  }

  const { data, error } = await supabase!
    .from('cost_center')
    .insert(costCenterInsertToRow(input))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error creando cost center: ${error.message}`)
  }
  return rowToCostCenter(data)
}

/**
 * Actualiza un cost center. Solo campos presentes en patch se modifican.
 */
export async function updateCostCenter(
  id: string,
  patch: CostCenterUpdate
): Promise<CostCenter> {
  requireSupabase()

  if (patch.code !== undefined) {
    const current = await getCostCenterById(id)
    if (!current) {
      throw new Error(`Cost center ${id} no encontrado.`)
    }
    if (patch.code !== current.code) {
      const dup = await getCostCenterByCode(current.accountId, patch.code)
      if (dup && dup.id !== id) {
        throw new Error(
          `Ya existe un cost center con el code "${patch.code}".`
        )
      }
    }
  }

  const rowPatch = costCenterUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getCostCenterById(id)
    if (!current) throw new Error(`Cost center ${id} no encontrado.`)
    return current
  }

  const { data, error } = await supabase!
    .from('cost_center')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando cost center ${id}: ${error.message}`)
  }
  return rowToCostCenter(data)
}

/**
 * Archiva un cost center (soft delete). Marca is_active=false.
 * No hay archived_at en esta tabla — solo cambia el flag.
 */
export async function archiveCostCenter(id: string): Promise<CostCenter> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('cost_center')
    .update({ is_active: false })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error archivando cost center ${id}: ${error.message}`)
  }
  return rowToCostCenter(data)
}

/**
 * Restaura un cost center archivado.
 */
export async function restoreCostCenter(id: string): Promise<CostCenter> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('cost_center')
    .update({ is_active: true })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error restaurando cost center ${id}: ${error.message}`)
  }
  return rowToCostCenter(data)
}
