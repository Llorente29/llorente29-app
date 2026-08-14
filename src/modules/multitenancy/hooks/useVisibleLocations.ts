// src/modules/multitenancy/hooks/useVisibleLocations.ts
//
// ENCARGO CODE (14/08) feat/f0-responsable-de-local, B.4 — "Responsable de
// local: solo los suyos. El selector de local no ofrece los demás y el
// ámbito por defecto es su local si solo tiene uno."
//
// NO se toca AppContext.tsx (regla de la casa: no tocar App.tsx ni
// AppContext.tsx sin permiso explícito). AppContext sigue exponiendo TODOS
// los locales de la cuenta (locations) sin filtrar — lo sigue necesitando
// cualquier pantalla de administración de locales. Este hook es una vista
// DERIVADA por encima: para un admin, locations sin tocar; para un
// responsable de local, solo los locales con fila en manager_locations
// para su user_profile.
//
// 🔴 Deuda declarada (B.4, no se resuelve aquí): esto es solo la interfaz.
// current_user_manages_location() hoy solo gobierna 3 políticas RLS, todas
// de `vacations` — un responsable con la clave pública podría leer datos
// de otro local por API directa. Disparador: el primer cliente con más de
// un local y responsables distintos.

import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type { Location } from '../../../types'

export interface UseVisibleLocationsResult {
  /** Locales que este user puede ver/elegir. Admin: todos. Manager: solo los suyos. */
  visibleLocations: Location[]
  /** true si el user es 'manager' y por tanto ve un subconjunto (no todos los de la cuenta). */
  isRestricted: boolean
  /** true mientras se resuelve manager_locations (solo aplica si role='manager'). */
  loading: boolean
}

export function useVisibleLocations(): UseVisibleLocationsResult {
  const { locations, roleInActiveAccount, authUserId, activeAccountId } = useApp()
  const [managedIds, setManagedIds] = useState<Set<string> | null>(null)
  const [loading, setLoading] = useState(false)

  const isManager = roleInActiveAccount === 'manager'

  useEffect(() => {
    if (!isManager) { setManagedIds(null); return }
    if (!isSupabaseEnabled || !supabase || !authUserId || !activeAccountId) { setManagedIds(new Set()); return }

    let cancelled = false
    setLoading(true)
    ;(async () => {
      // 2 queries (resolver user_profile del user en esta cuenta + sus
      // manager_locations) — mismo patrón que getPermissionsForUserInAccount
      // en managerPermissionsService.ts.
      const { data: profile } = await supabase!
        .from('user_profiles')
        .select('id')
        .eq('user_id', authUserId)
        .eq('account_id', activeAccountId)
        .maybeSingle()

      if (!profile) { if (!cancelled) { setManagedIds(new Set()); setLoading(false) }; return }

      const { data: rows } = await supabase!
        .from('manager_locations')
        .select('location_id')
        .eq('user_profile_id', profile.id)

      if (!cancelled) {
        setManagedIds(new Set((rows ?? []).map((r: { location_id: string }) => r.location_id)))
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [isManager, authUserId, activeAccountId])

  if (!isManager) {
    return { visibleLocations: locations, isRestricted: false, loading: false }
  }

  const ids = managedIds ?? new Set<string>()
  return {
    visibleLocations: locations.filter(l => ids.has(l.id)),
    isRestricted: true,
    loading,
  }
}
