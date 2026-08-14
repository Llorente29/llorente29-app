// src/modules/multitenancy/hooks/usePermissions.ts
//
// Hook de conveniencia sobre AppContext para consultar permisos del user
// logueado en la cuenta activa. Resuelve dos casuísticas:
//
//   1. ¿El user tiene un permiso concreto? (e.g., 'show_staff', 'show_salaries')
//   2. ¿El user tiene rol que bypasea permisos? (admin global / admin de cuenta)
//
// FUENTE DE LOS PERMISOS:
//   AppContext carga `permissions` desde el RPC `get_effective_permissions`
//   (server-side). El RPC devuelve la fila de `manager_permissions` del
//   user_profile tal cual, como jsonb `{ <snake_case_column>: boolean }`
//   (ENCARGO CODE 14/08, f0-responsable-de-local: get_effective_permissions
//   ya NO pasa por permission_sets/permission_set_assignments — esas tablas
//   se eliminaron por ser código muerto que nadie leía. Antes de esta nota
//   el comentario describía ese diseño viejo; el RPC en sí llevaba tiempo
//   sin usarlo). Para admins incluye el marcador especial
//   `{ __full_access: true }`; para un manager sin fila en
//   manager_permissions devuelve `{}` (fail-closed).
//
//   Las claves son las columnas reales de `manager_permissions` en
//   snake_case (e.g. 'showSalaries' en camelCase del cliente → 'show_salaries'
//   como clave de este diccionario).
//
// REGLA DE PERMISOS (alineada con AppContext y BBDD):
//   - admin de cuenta (roleInActiveAccount === 'admin') → ve todo dentro
//     de su cuenta, ignora el diccionario.
//   - Caller con marcador __full_access en el dict → ve todo (independiente
//     del rol; permite que un usuario con set "full" tenga bypass aunque
//     no sea admin formal).
//   - Resto → consulta clave concreta en el diccionario.
//
// IMPORTANTE — POR QUÉ NO USAMOS `isAdmin` DEL CONTEXT:
// `AppContext.isAdmin` es hoy `!!adminEmail` (deuda B-8): mide "¿hay sesión
// Supabase?", NO "¿el rol del user en su cuenta es admin?". Cualquier user
// logueado (admin, manager, etc.) lo pone a true. Si este hook lo usara,
// todo manager logueado pasaría como acceso total y el gating quedaría
// neutralizado. La fuente de verdad granular del rol es `roleInActiveAccount`.

import { useMemo } from 'react'
import { useApp } from '../../../context/AppContext'
import type { EffectivePermissions } from '../../../services/effectivePermissionsService'
import type { UserProfileRole } from '../../../types/multitenancy'

/**
 * Clave de permiso. El diccionario de permisos efectivos es dinámico (lo
 * resuelve la BBDD vía `get_effective_permissions`), por lo que NO podemos
 * enumerar las claves a nivel de tipo. Convención: snake_case, las mismas
 * claves que `permission_sets.permissions` en BBDD.
 */
export type PermissionKey = string

export interface UsePermissionsResult {
  /** Diccionario de permisos efectivos o null (sin cuenta activa / RPC falló). */
  permissions: EffectivePermissions | null
  /** Rol del user en la cuenta activa. null si aún no resuelto. */
  role: UserProfileRole | null
  /** True si el user puede saltarse el diccionario (admin global / de cuenta / marcador). */
  isFullAccess: boolean
  /**
   * Consulta un permiso por su clave (snake_case). Reglas:
   *   - Si isFullAccess → siempre true.
   *   - Si permissions === null → false (RPC falló o cuenta no resuelta).
   *   - Si permissions[key] === true → true.
   *   - Clave ausente o false → false (fail-closed).
   */
  hasPermission: (key: PermissionKey) => boolean
}

export function usePermissions(): UsePermissionsResult {
  const { permissions, roleInActiveAccount } = useApp()

  // isFullAccess: el bypass viene del ROL REAL en la cuenta activa
  // (roleInActiveAccount === 'admin') o del marcador __full_access que el
  // RPC `get_effective_permissions` emite para sets con acceso total.
  // NO usamos `isAdmin` del context: ver nota "POR QUÉ NO USAMOS isAdmin"
  // arriba — equivale a "hay sesión" y trataría a cualquier manager como
  // acceso total (deuda B-8).
  const isFullAccess = useMemo(
    () =>
      roleInActiveAccount === 'admin' ||
      permissions?.__full_access === true,
    [roleInActiveAccount, permissions]
  )

  const hasPermission = (key: PermissionKey): boolean => {
    if (isFullAccess) return true
    if (!permissions) return false
    return permissions[key] === true
  }

  return {
    permissions,
    role: roleInActiveAccount,
    isFullAccess,
    hasPermission,
  }
}
