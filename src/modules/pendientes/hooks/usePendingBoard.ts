// src/modules/pendientes/hooks/usePendingBoard.ts
//
// ENCARGO CODE (14/08) Pantalla de PENDIENTES, Fase 1. Un solo fetch de
// pending_board(); expone las filas crudas y los contadores que necesitan
// tanto la pantalla /pendientes como la pestaña permanente del TopBar.

import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { getPendingBoard, type PendingItem } from '../pendientesService'

export interface UsePendingBoardResult {
  items: PendingItem[]
  loading: boolean
  error: string | null
  /** Suma de items en capas 'ahora' + 'semana'. NUNCA 'salud' (B.1). */
  actionableCount: number
  refetch: () => void
}

export function usePendingBoard(): UsePendingBoardResult {
  const { activeAccountId } = useApp()
  const [items, setItems] = useState<PendingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!activeAccountId) { setItems([]); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    getPendingBoard(activeAccountId)
      .then(rows => { if (!cancelled) setItems(rows) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeAccountId, tick])

  const refetch = useCallback(() => setTick(t => t + 1), [])

  const actionableCount = items
    .filter(i => i.layer === 'ahora' || i.layer === 'semana')
    .reduce((sum, i) => sum + i.items, 0)

  return { items, loading, error, actionableCount, refetch }
}
