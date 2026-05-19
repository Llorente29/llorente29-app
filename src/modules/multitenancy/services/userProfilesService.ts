// src/modules/multitenancy/services/userProfilesService.ts
//
// Service CRUD de user_profiles. Vínculo N:N entre auth.users y accounts.
//
// Operaciones:
//   - listUserProfilesByUser(userId, opts?)        → cuentas a las que pertenece un user
//   - listUserProfilesByAccount(accountId, opts?)  → miembros de una cuenta
//   - getUserProfile(userId, accountId)            → perfil concreto (único por pareja)
//   - getUserProfileById(id)                       → lookup directo por PK
//   - createUserProfile(input)                     → vincular user a cuenta
//   - updateUserProfile(id, patch)                 → cambiar role/displayName/active
//   - setUserProfileActive(id, active)             → atajo para activar/desactivar
//   - deleteUserProfile(id)                        → hard delete (cascade a manager_permissions)
//
// DIFERENCIAS RESPECTO AL PATRÓN BRANDS (excepción consciente, ver multitenancy.ts §SHELL):
//   - NO hay archive/restore. El ciclo de vida es `active: boolean` (columna existente).
//   - SÍ hay deleteUserProfile (hard delete real). ON DELETE CASCADE en BBDD
//     limpia manager_permissions automáticamente.
//   - updateUserProfile NO permite cambiar userId ni accountId (campos inmutables
//     post-creación; mover un perfil entre cuentas sería una operación distinta).
//   - Las funciones list reciben userId/accountId explícitos para filtrar; aún
//     así RLS hace el scope real (un user solo ve sus profiles + los de cuentas
//     donde es admin/manager).
//
// Convención de errores: todos los métodos LANZAN Error si falla la query.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  UserProfile,
  UserProfileInsert,
  UserProfileUpdate,
  UserProfileRole,
  RowUserProfile,
  RowUserProfileInsert,
  RowUserProfileUpdate,
} from '../../../types/multitenancy'

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

// NOTA: rowToUserProfile exportado para tests. No usar fuera de tests/service.
export function rowToUserProfile(row: RowUserProfile): UserProfile {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    employeeId: row.employee_id,
    role: row.role as UserProfileRole,
    displayName: row.display_name,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function userProfileInsertToRow(input: UserProfileInsert): RowUserProfileInsert {
  return {
    user_id: input.userId,
    account_id: input.accountId,
    employee_id: input.employeeId ?? null,
    role: input.role ?? 'worker',
    display_name: input.displayName ?? null,
    active: input.active ?? true,
  }
}

function userProfileUpdateToRow(patch: UserProfileUpdate): RowUserProfileUpdate {
  const row: RowUserProfileUpdate = {}
  if (patch.employeeId !== undefined) row.employee_id = patch.employeeId
  if (patch.role !== undefined) row.role = patch.role
  if (patch.displayName !== undefined) row.display_name = patch.displayName
  if (patch.active !== undefined) row.active = patch.active
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

export interface ListUserProfilesOptions {
  /** Si false, excluye perfiles con active=false. Default true (los incluye). */
  includeInactive?: boolean
  /** Filtra por rol. */
  role?: UserProfileRole
  /** Filtro de texto sobre display_name (case-insensitive). */
  search?: string
  /** Paginación. */
  limit?: number
  offset?: number
}

/**
 * Lista los user_profiles de un user (las cuentas a las que pertenece).
 *
 * Caso de uso principal: al loguear, AppContext llama aquí para saber qué
 * cuentas tiene disponibles el usuario actual.
 *
 * Ordenado por created_at asc (orden estable de incorporación a cuentas).
 */
export async function listUserProfilesByUser(
  userId: string,
  opts: ListUserProfilesOptions = {}
): Promise<UserProfile[]> {
  requireSupabase()
  let query = supabase!
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (opts.includeInactive === false) {
    query = query.eq('active', true)
  }
  if (opts.role) {
    query = query.eq('role', opts.role)
  }
  if (typeof opts.limit === 'number') {
    const from = opts.offset ?? 0
    const to = from + opts.limit - 1
    query = query.range(from, to)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando perfiles del user ${userId}: ${error.message}`)
  }
  return (data ?? []).map(rowToUserProfile)
}

/**
 * Lista los user_profiles de una cuenta (miembros de la cuenta).
 *
 * Caso de uso principal: pantalla "Equipo / Usuarios" de cada cuenta.
 * Ordenado alfabéticamente por display_name (nulls al final).
 */
export async function listUserProfilesByAccount(
  accountId: string,
  opts: ListUserProfilesOptions = {}
): Promise<UserProfile[]> {
  requireSupabase()
  let query = supabase!
    .from('user_profiles')
    .select('*')
    .eq('account_id', accountId)
    .order('display_name', { ascending: true, nullsFirst: false })

  if (opts.includeInactive === false) {
    query = query.eq('active', true)
  }
  if (opts.role) {
    query = query.eq('role', opts.role)
  }
  if (opts.search && opts.search.trim() !== '') {
    const term = `%${opts.search.trim()}%`
    query = query.ilike('display_name', term)
  }
  if (typeof opts.limit === 'number') {
    const from = opts.offset ?? 0
    const to = from + opts.limit - 1
    query = query.range(from, to)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando perfiles de la cuenta ${accountId}: ${error.message}`)
  }
  return (data ?? []).map(rowToUserProfile)
}

/**
 * Obtiene el user_profile de un user en una cuenta concreta.
 * Único por UNIQUE (user_id, account_id). Devuelve null si no existe.
 *
 * Caso de uso principal: AppContext al cambiar de cuenta activa, resolver
 * el rol y permisos del user en esa cuenta.
 */
export async function getUserProfile(
  userId: string,
  accountId: string
): Promise<UserProfile | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Error obteniendo perfil de user ${userId} en cuenta ${accountId}: ${error.message}`
    )
  }
  return data ? rowToUserProfile(data) : null
}

/**
 * Obtiene un user_profile por su PK. Devuelve null si no existe o RLS lo oculta.
 */
export async function getUserProfileById(id: string): Promise<UserProfile | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('user_profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo perfil ${id}: ${error.message}`)
  }
  return data ? rowToUserProfile(data) : null
}

/**
 * Crea un nuevo user_profile. Vincula un user a una cuenta con un rol dado.
 * Solo admin de la cuenta destino (policy user_profiles_insert).
 *
 * Detecta colisión por UNIQUE (user_id, account_id) con error UX-friendly.
 */
export async function createUserProfile(
  input: UserProfileInsert
): Promise<UserProfile> {
  requireSupabase()

  const existing = await getUserProfile(input.userId, input.accountId)
  if (existing) {
    throw new Error(
      `El usuario ya tiene un perfil en esta cuenta (rol "${existing.role}").`
    )
  }

  const { data, error } = await supabase!
    .from('user_profiles')
    .insert(userProfileInsertToRow(input))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error creando perfil de usuario: ${error.message}`)
  }
  return rowToUserProfile(data)
}

/**
 * Actualiza un user_profile. Solo campos presentes en patch se modifican.
 * NO permite cambiar userId ni accountId (campos inmutables; ver cabecera).
 */
export async function updateUserProfile(
  id: string,
  patch: UserProfileUpdate
): Promise<UserProfile> {
  requireSupabase()

  const rowPatch = userProfileUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getUserProfileById(id)
    if (!current) throw new Error(`Perfil ${id} no encontrado.`)
    return current
  }

  const { data, error } = await supabase!
    .from('user_profiles')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando perfil ${id}: ${error.message}`)
  }
  return rowToUserProfile(data)
}

/**
 * Atajo para activar/desactivar un perfil sin pasar por updateUserProfile.
 *
 * Equivalente a updateUserProfile(id, { active }), expuesto aparte porque
 * es la operación más común (desactivar un user en una cuenta sin borrarlo).
 */
export async function setUserProfileActive(
  id: string,
  active: boolean
): Promise<UserProfile> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('user_profiles')
    .update({ active })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(
      `Error cambiando active=${active} en perfil ${id}: ${error.message}`
    )
  }
  return rowToUserProfile(data)
}

/**
 * Elimina un user_profile (HARD DELETE). Solo admin de la cuenta destino
 * (policy user_profiles_delete).
 *
 * Por FK ON DELETE CASCADE, esto borra automáticamente:
 *   - El row de manager_permissions asociado (1:1)
 * Y por FK ON DELETE SET NULL, deja a null:
 *   - user_profiles.employee_id si apuntaba a un employee borrado en otro lado
 *
 * Usar con cuidado. La mayoría de casos prácticos deberían usar
 * setUserProfileActive(id, false) en su lugar (soft delete vía active flag).
 */
export async function deleteUserProfile(id: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!
    .from('user_profiles')
    .delete()
    .eq('id', id)

  if (error) {
    throw new Error(`Error eliminando perfil ${id}: ${error.message}`)
  }
}
