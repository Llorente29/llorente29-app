// src/modules/multitenancy/hooks/usePermissions.ts
//
// Hook de conveniencia sobre AppContext para consultar permisos del user
// logueado en la cuenta activa. Resuelve dos casuísticas:
//
//   1. ¿El user tiene un permiso concreto? (e.g., showStaff, showSalaries)
//   2. ¿El user tiene rol que bypasea permisos? (admin global / admin de cuenta)
//
// REGLA DE PERMISOS (alineada con AppContext y BBDD):
//   - admin global (is_internal) → ve todo, ignora manager_permissions.
//   - admin de cuenta → ve todo dentro de su cuenta, ignora manager_permissions.
//   - manager → respeta manager_permissions.
//   - worker → no tiene panel de permisos; no aplica.
//
// Hoy AppContext carga `permissions` solo si role ≠ 'worker'. Para admins
// ese row puede ser null. El hook devuelve `true` para cualquier permiso si
// el user es admin (de cualquier scope), independientemente de `permissions`.
//
// DEUDA B-8: `isAdmin` del context sigue siendo `!!adminEmail`. Cuando se
// migre a `userProfile?.role === 'admin'`, este hook seguirá funcionando
// porque ya consulta también `roleInActiveAccount`.

import { useMemo } from 'react'
import { useApp } from '../../../context/AppContext'
import type { ManagerPermissions, UserProfileRole } from '../../../types/multitenancy'

/**
 * Claves válidas para hasPermission(). Son los nombres camelCase de los
 * booleanos de manager_permissions, exceptuando los campos meta (createdAt,
 * userProfileId, updatedAt).
 */
export type PermissionKey = Exclude<
  keyof ManagerPermissions,
  'userProfileId' | 'createdAt' | 'updatedAt'
>

export interface UsePermissionsResult {
  /** Row de manager_permissions o null (admin / worker / aún cargando). */
  permissions: ManagerPermissions | null
  /** Rol del user en la cuenta activa. null si aún no resuelto. */
  role: UserProfileRole | null
  /** True si el user puede saltarse manager_permissions (admin global o de cuenta). */
  isFullAccess: boolean
  /**
   * Consulta un permiso por su clave. Reglas:
   *   - Si isFullAccess → siempre true.
   *   - Si permissions === null → false (worker no tiene panel; manager sin row aún).
   *   - Si permissions[key] === true → true.
   *   - Si permissions[key] === false → false.
   */
  hasPermission: (key: PermissionKey) => boolean
}

export function usePermissions(): UsePermissionsResult {
  const { permissions, roleInActiveAccount, isAdmin } = useApp()

  // isFullAccess: admin global (isAdmin con cuenta interna) o admin de cuenta.
  // Hoy `isAdmin` cubre el caso "hay sesión Supabase" (deuda B-8). Cuando se
  // migre, este derivado seguirá siendo correcto porque ya considera
  // roleInActiveAccount === 'admin'.
  const isFullAccess = useMemo(
    () => isAdmin || roleInActiveAccount === 'admin',
    [isAdmin, roleInActiveAccount]
  )

  const hasPermission = (key: PermissionKey): boolean => {
    if (isFullAccess) return true
    if (!permissions) return false
    const value = permissions[key]
    // Defensive: si por alguna razón la clave no es boolean, lo tratamos como false.
    return value === true
  }

  return {
    permissions,
    role: roleInActiveAccount,
    isFullAccess,
    hasPermission,
  }
}
