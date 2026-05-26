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
//   (server-side, cascada admin → permission_set asignado → DENY). El RPC
//   devuelve un diccionario plano `{ <snake_case_key>: boolean }`. Para
//   admins incluye el marcador especial `{ __full_access: true }`; para
//   usuarios sin set asignado devuelve `{}` (fail-closed).
//
//   Las claves son las definidas en `permission_sets` (snake_case en BBDD),
//   NO los campos camelCase de la antigua tabla `manager_permissions`. Los
//   callers que migren desde la API legacy deben adaptar el nombre de la
//   clave (e.g. 'showSalaries' → 'show_salaries').
//
// REGLA DE PERMISOS (alineada con AppContext y BBDD):
//   - admin global (isAdmin) → ve todo, ignora el diccionario.
//   - admin de cuenta (role === 'admin') → ve todo dentro de su cuenta.
//   - Caller con marcador __full_access en el dict → ve todo (cinturón
//     redundante con los dos anteriores; permite que un usuario con set
//     "full" sin ser admin tenga el mismo bypass).
//   - Resto → consulta clave concreta en el diccionario.
//
// DEUDA B-8: `isAdmin` del context sigue siendo `!!adminEmail`. Cuando se
// migre a `userProfile?.role === 'admin'`, este hook seguirá funcionando
// porque ya considera `roleInActiveAccount` y `permissions.__full_access`.

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
  const { permissions, roleInActiveAccount, isAdmin } = useApp()

  // isFullAccess: admin global, admin de cuenta o marcador __full_access
  // emitido por el RPC. Los tres caminos son equivalentes para el bypass;
  // el marcador permite cubrir el caso de un set "full" sin requerir rol admin.
  const isFullAccess = useMemo(
    () =>
      isAdmin ||
      roleInActiveAccount === 'admin' ||
      permissions?.__full_access === true,
    [isAdmin, roleInActiveAccount, permissions]
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
