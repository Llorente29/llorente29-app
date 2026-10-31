// src/platform/feature-gate/useFeatureGate.ts
// Hook React para usar el featureGate de forma idiomática y reactiva.
// Re-renderiza el componente automáticamente cuando los flags cambian
// (tras un upgrade, refresh, logout, etc.).

import { useEffect, useState, useCallback } from 'react'
import { gate } from './featureGateService'
import { subscribeFeatureGate, notifyFeatureGateChanged } from './gateEvents'
import type { AccountPlatformState, Account } from '@/platform/types'
import { useApp } from '@/context/AppContext'

// ─── HOOK ────────────────────────────────────────────────────────────────

export interface UseFeatureGateResult {
  /** ¿El estado está cargado y disponible? */
  ready: boolean
  /** ¿La cuenta tiene activa esta feature? */
  has: (featureKey: string) => boolean
  /** ¿Alguna de estas features está activa? */
  hasAny: (featureKeys: string[]) => boolean
  /** ¿Todas estas features están activas? */
  hasAll: (featureKeys: string[]) => boolean
  /** ¿Se puede crear según las quotas? */
  canCreate: (quotaKey: string) => boolean
  /** Datos de la cuenta actual (null si no hay sesión) */
  account: Account | null
  /** ¿Es cuenta interna de Folvy? */
  isInternal: boolean
  /** Forzar recarga desde BBDD */
  refresh: () => Promise<void>
}

export function useFeatureGate(): UseFeatureGateResult {
  // Trigger para forzar re-render
  const [, setTick] = useState(0)
  const [snapshot, setSnapshot] = useState<AccountPlatformState | null>(
    gate.snapshot()
  )

  // DM1 · PR 1b (30/10): la cuenta activa de la pantalla. Al cambiarla (el
  // superadministrador, sin recargar), el gate vuelve a cargar la nueva y
  // avisa a todos. Para el resto el gate sigue a la base (cuentaDelGate.ts),
  // y cambiar de empresa recarga la aplicación entera.
  const { activeAccountId } = useApp()
  useEffect(() => {
    let cancel = false
    const antes = gate.snapshot()
    gate.load(activeAccountId).then(state => {
      if (cancel) return
      setSnapshot(state)
      if (state !== antes) notifyFeatureGateChanged()
    })
    return () => { cancel = true }
  }, [activeAccountId])

  // Suscribirse a cambios externos del gate
  useEffect(() => {
    const unsubscribe = subscribeFeatureGate(() => {
      setSnapshot(gate.snapshot())
      setTick(t => t + 1)
    })
    return unsubscribe
  }, [])

  // Funciones memoizadas que el componente puede usar
  const has = useCallback((k: string) => gate.has(k), [snapshot])
  const hasAny = useCallback((ks: string[]) => gate.hasAny(ks), [snapshot])
  const hasAll = useCallback((ks: string[]) => gate.hasAll(ks), [snapshot])
  const canCreate = useCallback((k: string) => gate.canCreate(k), [snapshot])
  const refresh = useCallback(async () => {
    await gate.refresh(activeAccountId)
    setSnapshot(gate.snapshot())
    setTick(t => t + 1)
    notifyFeatureGateChanged()
  }, [activeAccountId])

  return {
    ready: snapshot !== null,
    has,
    hasAny,
    hasAll,
    canCreate,
    account: snapshot?.account ?? null,
    isInternal: snapshot?.account.is_internal ?? false,
    refresh,
  }
}