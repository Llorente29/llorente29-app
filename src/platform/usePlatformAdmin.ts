// src/platform/usePlatformAdmin.ts
//
// Hook que determina si el usuario logueado es platform admin de Folvy.
//
// CONTEXTO (Sesion 15, 21/05/2026 — Porteria / Panel Admin):
// AppContext NO expone esta informacion. Su `isAdmin` significa "hay sesion
// Supabase" (!!adminEmail), y `roleInActiveAccount` es el rol DENTRO de una
// cuenta cliente (admin/manager/worker). Ninguno indica si el usuario es
// platform admin (plano de control Folvy, separado del plano de cliente).
//
// El dato vive en el JWT, en el claim `folvy.is_platform_admin`, emitido por
// el `custom_access_token_hook` de Supabase. La Edge Function check-account-status
// ya lo lee server-side; este hook hace lo mismo client-side, con la MISMA
// tecnica de decodificacion del payload del JWT.
//
// DISENO: hook independiente, NO toca AppContext (fichero sensible con logica
// anti-loop). Aislado y sin efectos colaterales.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface FolvyClaims {
  is_platform_admin?: boolean
  platform_admin_role?: string | null
  [key: string]: unknown
}

interface PlatformAdminState {
  // true si el JWT actual declara is_platform_admin === true.
  isPlatformAdmin: boolean
  // rol del platform admin si lo trae el claim (ej. 'ceo'), null si no.
  platformAdminRole: string | null
  // true mientras se resuelve la sesion inicial. Permite distinguir
  // "aun cargando" de "no es platform admin" (ambos isPlatformAdmin=false).
  loading: boolean
}

/**
 * Decodifica el payload de un JWT y devuelve sus claims folvy.*.
 * Misma logica que decodeFolvyClaims de la Edge Function (sin libs externas).
 * Devuelve null si el token es invalido o no trae el claim folvy.
 */
function decodeFolvyClaims(jwt: string): FolvyClaims | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(payloadB64))
    return (payload.folvy as FolvyClaims) ?? null
  } catch {
    return null
  }
}

/**
 * Hook que indica si el usuario logueado es platform admin de Folvy.
 *
 * Lee el JWT de la sesion actual y decodifica el claim folvy.is_platform_admin.
 * Reacciona a cambios de sesion (login/logout/refresh) via onAuthStateChange,
 * de modo que si el token se renueva, el estado se mantiene al dia.
 *
 * Uso tipico:
 *   const { isPlatformAdmin, loading } = usePlatformAdmin()
 *   if (loading) return <Cargando />
 *   if (!isPlatformAdmin) return <Navigate to="/" />
 */
export function usePlatformAdmin(): PlatformAdminState {
  const [state, setState] = useState<PlatformAdminState>({
    isPlatformAdmin: false,
    platformAdminRole: null,
    loading: true,
  })

  useEffect(() => {
    // Sin cliente Supabase (modo localStorage): nunca hay platform admin.
    if (!supabase) {
      setState({ isPlatformAdmin: false, platformAdminRole: null, loading: false })
      return
    }

    let cancelled = false

    function applyFromAccessToken(accessToken: string | undefined) {
      if (cancelled) return
      if (!accessToken) {
        setState({ isPlatformAdmin: false, platformAdminRole: null, loading: false })
        return
      }
      const folvy = decodeFolvyClaims(accessToken)
      setState({
        isPlatformAdmin: folvy?.is_platform_admin === true,
        platformAdminRole: folvy?.platform_admin_role ?? null,
        loading: false,
      })
    }

    // Resolucion inicial: leer la sesion actual.
    void supabase.auth.getSession().then(({ data }) => {
      applyFromAccessToken(data.session?.access_token)
    })

    // Reaccionar a cambios de sesion (login, logout, refresh de token).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      applyFromAccessToken(session?.access_token)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return state
}
