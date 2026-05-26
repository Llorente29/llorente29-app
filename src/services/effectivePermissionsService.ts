// src/services/effectivePermissionsService.ts
//
// Lee los permisos efectivos del usuario logueado en una cuenta concreta,
// resueltos server-side por la función SQL `get_effective_permissions`.
// La cascada vive en la BBDD (D1, Sprint 1):
//   admin → permission_set asignado (jsonb) → DENY.
//
// El RPC devuelve un objeto jsonb plano `{ "<permission_key>": boolean, ... }`.
// Si el caller es admin (global o de cuenta), el objeto contiene el marcador
// especial `{ "__full_access": true }` y los gates de UI deben tratarlo como
// "acceso total" sin consultar claves individuales.
//
// Convención de claves: SNAKE_CASE (igual que en BBDD y en permission_sets).
// El consumidor de cliente que use camelCase debe mapear en su capa, no aquí:
// este service expone la verdad de la BBDD tal cual.
//
// Fail-closed: ante error del RPC o BBDD no disponible devolvemos null o {};
// los callers tratan ausencia de permiso como denegación.

import { supabase, isSupabaseEnabled } from '../lib/supabase'

/**
 * Objeto plano de permisos efectivos resueltos por SQL.
 * - Claves en snake_case (igual que en BBDD / permission_sets).
 * - Valor true = permitido; false o ausente = denegado.
 * - Marcador especial `__full_access: true` = admin con acceso total
 *   (los callers deben cortocircuitar y NO inspeccionar otras claves).
 */
export type EffectivePermissions = Record<string, boolean>

/**
 * Llama al RPC `get_effective_permissions(p_account_id)` y devuelve el
 * objeto de permisos efectivos para el usuario logueado.
 *
 * - Si Supabase no está habilitado → null.
 * - Si el RPC devuelve error → log y null (no lanza, para no romper la
 *   carga del AppContext: el caller decide qué hacer con null).
 * - Si data es null/undefined → `{}` (fail-closed: sin permisos).
 * - En caso normal → el jsonb del RPC casteado a EffectivePermissions.
 */
export async function getEffectivePermissions(
  accountId: string,
): Promise<EffectivePermissions | null> {
  if (!isSupabaseEnabled || !supabase) return null

  const { data, error } = await supabase.rpc('get_effective_permissions', {
    p_account_id: accountId,
  })

  if (error) {
    console.error('[effectivePermissionsService] get_effective_permissions error:', error)
    return null
  }

  if (data === null || data === undefined) return {}

  return data as unknown as EffectivePermissions
}
