// src/modules/multitenancy/services/analysisAccountsService.ts
//
// Service CRUD de cuentas de análisis contables. Scope cuenta.
//
// MODELO: árbol jerárquico vía parent_id auto-referencial.
//   - Cuenta raíz: parent_id = null
//   - Cuenta hija: parent_id = UUID de otra cuenta DE LA MISMA ACCOUNT_ID
//   - FK a sí misma garantiza que el padre exista en la tabla
//   - La construcción del árbol (anidar children) NO está en este service:
//     se hará en la UI o en un utility aparte cuando se necesite.
//     Este service solo expone CRUD plano + filtro por parent.
//
// Operaciones:
//   - listAnalysisAccounts(opts)        → lista filtrada/paginada
//   - getAnalysisAccountById(id)        → una cuenta
//   - getAnalysisAccountByCode(acc,code)→ para validar duplicados
//   - createAnalysisAccount(input)      → alta (valida parent multi-tenant)
//   - updateAnalysisAccount(id, patch)  → modificación (valida parent multi-tenant + no auto-ciclo trivial)
//   - archiveAnalysisAccount(id)        → soft delete (is_active=false)
//   - restoreAnalysisAccount(id)        → reactivar
//
// Validaciones especiales (parent_id):
//   - Si patch/input incluye parent_id no nulo:
//     1. Verifico que el parent existe Y pertenece a la misma accountId
//     2. Si es update, verifico parent_id !== id (auto-ciclo trivial)
//   - NO detectamos ciclos profundos (A → B → A). Es coste alto para caso raro;
//     si la UI permite tal estado, se detecta visualmente. TODO futuro si hace falta.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  AnalysisAccount,
  AnalysisAccountInsert,
  AnalysisAccountUpdate,
  AnalysisAccountType,
  RowAnalysisAccount,
  RowAnalysisAccountInsert,
  RowAnalysisAccountUpdate,
} from '../../../types/multitenancy'

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

// NOTA: rowToAnalysisAccount exportado para tests unitarios.
export function rowToAnalysisAccount(row: RowAnalysisAccount): AnalysisAccount {
  return {
    id: row.id,
    accountId: row.account_id,
    code: row.code,
    name: row.name,
    parentId: row.parent_id,
    accountType: row.account_type as AnalysisAccountType,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function analysisAccountInsertToRow(
  input: AnalysisAccountInsert
): RowAnalysisAccountInsert {
  return {
    account_id: input.accountId,
    code: input.code,
    name: input.name,
    parent_id: input.parentId ?? null,
    account_type: input.accountType ?? 'other',
    is_active: input.isActive ?? true,
  }
}

function analysisAccountUpdateToRow(
  patch: AnalysisAccountUpdate
): RowAnalysisAccountUpdate {
  const row: RowAnalysisAccountUpdate = {}
  if (patch.code !== undefined) row.code = patch.code
  if (patch.name !== undefined) row.name = patch.name
  if (patch.parentId !== undefined) row.parent_id = patch.parentId
  if (patch.accountType !== undefined) row.account_type = patch.accountType
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

/**
 * Valida que un parent_id propuesto existe y pertenece a la misma cuenta.
 * Lanza Error descriptivo si falla. Se llama desde create y update.
 */
async function assertParentBelongsToAccount(
  accountId: string,
  parentId: string
): Promise<void> {
  const parent = await getAnalysisAccountById(parentId)
  if (!parent) {
    throw new Error(`La cuenta padre ${parentId} no existe.`)
  }
  if (parent.accountId !== accountId) {
    throw new Error(
      `La cuenta padre ${parentId} pertenece a otra account_id. Cross-tenant no permitido.`
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────

export interface ListAnalysisAccountsOptions {
  accountId: string
  /** Si false, excluye cuentas con is_active=false. Default true. */
  includeInactive?: boolean
  /**
   * Filtro por parent.
   *   - undefined → todas las cuentas
   *   - null      → solo cuentas raíz (parent_id IS NULL)
   *   - UUID      → solo hijas directas de esa cuenta padre
   */
  parentId?: string | null
  /** Filtro por tipo. */
  accountType?: AnalysisAccountType
  /** Filtro de texto sobre code o name (case-insensitive). */
  search?: string
  /** Paginación. */
  limit?: number
  offset?: number
}

/**
 * Lista cuentas de análisis filtradas/paginadas. Ordenadas alfabéticamente por code.
 */
export async function listAnalysisAccounts(
  opts: ListAnalysisAccountsOptions
): Promise<AnalysisAccount[]> {
  requireSupabase()
  let query = supabase!
    .from('analysis_account')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('code', { ascending: true })

  if (opts.includeInactive === false) {
    query = query.eq('is_active', true)
  }
  if (opts.parentId === null) {
    query = query.is('parent_id', null)
  } else if (typeof opts.parentId === 'string') {
    query = query.eq('parent_id', opts.parentId)
  }
  if (opts.accountType) {
    query = query.eq('account_type', opts.accountType)
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
    throw new Error(`Error listando cuentas de análisis: ${error.message}`)
  }
  return (data ?? []).map(rowToAnalysisAccount)
}

/**
 * Obtiene una cuenta por id. Devuelve null si no existe.
 */
export async function getAnalysisAccountById(
  id: string
): Promise<AnalysisAccount | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('analysis_account')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo cuenta ${id}: ${error.message}`)
  }
  return data ? rowToAnalysisAccount(data) : null
}

/**
 * Obtiene una cuenta por code dentro de una cuenta. Útil para validar duplicados.
 */
export async function getAnalysisAccountByCode(
  accountId: string,
  code: string
): Promise<AnalysisAccount | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('analysis_account')
    .select('*')
    .eq('account_id', accountId)
    .eq('code', code)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Error obteniendo cuenta por code "${code}": ${error.message}`
    )
  }
  return data ? rowToAnalysisAccount(data) : null
}

/**
 * Crea una cuenta de análisis. Valida:
 *   - code obligatorio y único en la cuenta
 *   - si tiene parent_id, el parent existe y pertenece a la misma accountId
 */
export async function createAnalysisAccount(
  input: AnalysisAccountInsert
): Promise<AnalysisAccount> {
  requireSupabase()

  if (!input.code || input.code.trim() === '') {
    throw new Error('El code de la cuenta de análisis es obligatorio.')
  }

  const existing = await getAnalysisAccountByCode(input.accountId, input.code)
  if (existing) {
    throw new Error(
      `Ya existe una cuenta con el code "${input.code}" en esta account_id.`
    )
  }

  if (input.parentId) {
    await assertParentBelongsToAccount(input.accountId, input.parentId)
  }

  const { data, error } = await supabase!
    .from('analysis_account')
    .insert(analysisAccountInsertToRow(input))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error creando cuenta de análisis: ${error.message}`)
  }
  return rowToAnalysisAccount(data)
}

/**
 * Actualiza una cuenta de análisis. Valida:
 *   - si patch.code: code único en la cuenta
 *   - si patch.parentId no nulo: parent existe, pertenece a la misma accountId,
 *     y no es la propia cuenta (auto-ciclo trivial).
 *   - NO detectamos ciclos profundos (A → B → A); riesgo aceptado.
 */
export async function updateAnalysisAccount(
  id: string,
  patch: AnalysisAccountUpdate
): Promise<AnalysisAccount> {
  requireSupabase()

  // Necesitamos la cuenta actual para validar varias cosas.
  const current = await getAnalysisAccountById(id)
  if (!current) {
    throw new Error(`Cuenta de análisis ${id} no encontrada.`)
  }

  // Validación de code único
  if (patch.code !== undefined && patch.code !== current.code) {
    const dup = await getAnalysisAccountByCode(current.accountId, patch.code)
    if (dup && dup.id !== id) {
      throw new Error(`Ya existe una cuenta con el code "${patch.code}".`)
    }
  }

  // Validación de parent
  if (patch.parentId !== undefined && patch.parentId !== null) {
    if (patch.parentId === id) {
      throw new Error(
        'Una cuenta no puede ser su propio padre (auto-ciclo trivial).'
      )
    }
    await assertParentBelongsToAccount(current.accountId, patch.parentId)
  }

  const rowPatch = analysisAccountUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    return current
  }

  const { data, error } = await supabase!
    .from('analysis_account')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando cuenta ${id}: ${error.message}`)
  }
  return rowToAnalysisAccount(data)
}

/**
 * Archiva una cuenta (soft delete). Marca is_active=false.
 * No hay archived_at en esta tabla.
 *
 * NOTA: NO se cascada a las hijas. Si una cuenta tiene hijas activas,
 * tras archivar el padre las hijas siguen activas pero "huérfanas
 * lógicamente". La UI tendrá que mostrar advertencia. Decidir cascada
 * cuando se diseñe la UI.
 */
export async function archiveAnalysisAccount(
  id: string
): Promise<AnalysisAccount> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('analysis_account')
    .update({ is_active: false })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error archivando cuenta ${id}: ${error.message}`)
  }
  return rowToAnalysisAccount(data)
}

/**
 * Restaura una cuenta archivada.
 */
export async function restoreAnalysisAccount(
  id: string
): Promise<AnalysisAccount> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('analysis_account')
    .update({ is_active: true })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error restaurando cuenta ${id}: ${error.message}`)
  }
  return rowToAnalysisAccount(data)
}
