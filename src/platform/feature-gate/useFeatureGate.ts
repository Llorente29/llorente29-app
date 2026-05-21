// src/platform/feature-gate/useFeatureGate.ts
// Hook React para usar el featureGate de forma idiomática y reactiva.
// Re-renderiza el componente automáticamente cuando los flags cambian
// (tras un upgrade, refresh, logout, etc.).

import { useEffect, useState, useCallback } from 'react'
import { gate } from './featureGateService'
import { subscribeFeatureGate, notifyFeatureGateChanged } from './gateEvents'
import type { AccountPlatformState, Account } from '@/platform/types'

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

  // Carga inicial si no hay snapshot todavía
  useEffect(() => {
    let cancel = false
    if (!snapshot) {
      gate.load().then(state => {
        if (!cancel) setSnapshot(state)
      })
    }
    return () => { cancel = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    await gate.refresh()
    setSnapshot(gate.snapshot())
    setTick(t => t + 1)
    notifyFeatureGateChanged()
  }, [])

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