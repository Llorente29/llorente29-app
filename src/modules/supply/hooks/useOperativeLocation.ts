// src/modules/supply/hooks/useOperativeLocation.ts
//
// Hook del LOCAL OPERATIVO para pantallas de riesgo (recepción, inventario,
// conteo). Resuelve un local SIEMPRE concreto y seguro, sin que el trabajador
// lo elija. Cascada:
//   1. Fichaje activo / local del empleado (operativeLocationService).
//   2. Gerente/admin: si el activeLocationId del header es concreto (≠ 'all'),
//      ese; si está en 'all', puede elegir uno concreto (override consciente).
//   3. Worker sin local resuelto → bloquea (no opera sin local claro).
//
// Devuelve isResolved + blocker para que la UI bloquee o deje elegir según rol.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { resolveOperativeLocation } from '@/modules/supply/services/operativeLocationService'

export interface UseOperativeLocationResult {
  /** Local operativo resuelto (UUID) o null si no se pudo resolver con seguridad. */
  operativeLocationId: string | null
  /** De dónde salió: fichaje, perfil del empleado, o elección consciente del gerente. */
  source: 'fichaje' | 'perfil' | 'gerente' | null
  /** True si hay un local concreto y seguro para operar. */
  isResolved: boolean
  /** Si no se pudo resolver: motivo legible para la UI. null si resuelto. */
  blocker: string | null
  /** True si el usuario (gerente/admin) puede elegir local manualmente. */
  canChoose: boolean
  /** Locales entre los que puede elegir un gerente (asignados o todos los de la cuenta). */
  chooseOptions: string[]
  /** Override manual del gerente (no se persiste; vale para la sesión de la pantalla). */
  setManualLocation: (id: string) => void
  loading: boolean
}

export function useOperativeLocation(): UseOperativeLocationResult {
  const { userProfile, activeLocationId } = useApp()
  const { activeAccountId } = useActiveAccount()

  const role = userProfile?.role ?? 'worker'
  const isManager = role === 'admin' || role === 'manager'

  const [resolvedId, setResolvedId] = useState<string | null>(null)
  const [source, setSource] = useState<'fichaje' | 'perfil' | null>(null)
  const [assigned, setAssigned] = useState<string[]>([])
  const [manual, setManual] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeAccountId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setManual(null)
    ;(async () => {
      try {
        const res = await resolveOperativeLocation(activeAccountId, userProfile?.employeeId ?? null)
        if (cancelled) return
        setResolvedId(res.locationId)
        setSource(res.source)
        setAssigned(res.assignedLocationIds)
      } catch {
        if (!cancelled) { setResolvedId(null); setSource(null); setAssigned([]) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [activeAccountId, userProfile?.employeeId])

  return useMemo<UseOperativeLocationResult>(() => {
    // 1. Override manual del gerente (elección consciente en pantalla).
    if (manual) {
      return {
        operativeLocationId: manual, source: 'gerente', isResolved: true,
        blocker: null, canChoose: isManager, chooseOptions: assigned,
        setManualLocation: setManual, loading,
      }
    }
    // 2. Local resuelto por fichaje/perfil.
    if (resolvedId) {
      return {
        operativeLocationId: resolvedId, source, isResolved: true,
        blocker: null, canChoose: isManager, chooseOptions: assigned,
        setManualLocation: setManual, loading,
      }
    }
    // 3. Gerente: si el header tiene un local concreto (≠ 'all'), úsalo.
    if (isManager && activeLocationId && activeLocationId !== 'all') {
      return {
        operativeLocationId: activeLocationId, source: 'gerente', isResolved: true,
        blocker: null, canChoose: true, chooseOptions: assigned,
        setManualLocation: setManual, loading,
      }
    }
    // 4. No resuelto: degradado por rol.
    if (isManager) {
      return {
        operativeLocationId: null, source: null, isResolved: false,
        blocker: 'Selecciona el local en el que vas a operar.',
        canChoose: true, chooseOptions: assigned, setManualLocation: setManual, loading,
      }
    }
    return {
      operativeLocationId: null, source: null, isResolved: false,
      blocker: 'No se ha podido determinar tu local. Ficha tu entrada o pide a tu responsable que te asigne un local.',
      canChoose: false, chooseOptions: [], setManualLocation: setManual, loading,
    }
  }, [manual, resolvedId, source, isManager, activeLocationId, assigned, loading])
}
