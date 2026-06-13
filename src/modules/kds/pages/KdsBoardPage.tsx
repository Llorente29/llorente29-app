// src/modules/kds/pages/KdsBoardPage.tsx
//
// Pantalla KDS dentro del Shell (sesión). Resuelve el local del selector global,
// carga las estaciones del local (para nombrar los grupos y ofrecer un filtro
// manual) y monta el tablero reutilizable KdsBoard SIN token (RLS de sesión).
//
// El mismo KdsBoard se reutiliza en el kiosco (/cocina-tv) con token de dispositivo.

import { useEffect, useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'
import { useApp } from '../../../context/AppContext'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { listStations, type KitchenStation } from '../services/kdsService'
import KdsBoard from '../components/KdsBoard'

export default function KdsBoardPage() {
  const { activeAccountId } = useApp()
  const { resolvedLocationId, isConsolidated } = useLocationScope()
  const [stations, setStations] = useState<KitchenStation[]>([])
  const [filter, setFilter] = useState<string[] | null>(null) // null = todas

  useEffect(() => {
    if (!activeAccountId || !resolvedLocationId) { setStations([]); return }
    let cancelled = false
    listStations(activeAccountId, resolvedLocationId)
      .then(rows => { if (!cancelled) setStations(rows.filter(s => s.isActive)) })
      .catch(() => { if (!cancelled) setStations([]) })
    return () => { cancelled = true }
  }, [activeAccountId, resolvedLocationId])

  // Reset del filtro al cambiar de local.
  useEffect(() => { setFilter(null) }, [resolvedLocationId])

  const stationNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of stations) m[s.id] = s.name
    return m
  }, [stations])

  if (isConsolidated || !resolvedLocationId) {
    return (
      <div className="grid place-items-center h-[60vh] text-center text-text-secondary">
        <div>
          <MapPin className="mx-auto mb-3 text-text-secondary" size={32} />
          <p className="text-lg font-medium text-text-primary">Selecciona un local</p>
          <p className="text-sm mt-1">El KDS es por local. Elige uno en el selector de arriba.</p>
        </div>
      </div>
    )
  }

  function toggleStation(id: string) {
    setFilter(prev => {
      const base = prev ?? stations.map(s => s.id)
      const next = base.includes(id) ? base.filter(x => x !== id) : [...base, id]
      // Si quedan todas seleccionadas, volvemos a null (= todas, sin filtro).
      return next.length === stations.length ? null : next
    })
  }

  const allActive = filter === null

  return (
    <div className="space-y-3">
      {/* Filtro manual de estación (sesión) */}
      {stations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFilter(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium ring-1 transition-colors ${
              allActive ? 'bg-accent text-text-on-accent ring-transparent' : 'bg-card text-text-secondary ring-border-default hover:text-text-primary'
            }`}
          >
            Todas
          </button>
          {stations.map(s => {
            const active = filter === null || filter.includes(s.id)
            return (
              <button
                key={s.id}
                onClick={() => toggleStation(s.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium ring-1 transition-colors ${
                  active && !allActive ? 'bg-accent text-text-on-accent ring-transparent'
                    : active ? 'bg-card text-text-primary ring-border-default'
                    : 'bg-card text-text-secondary/50 ring-border-default hover:text-text-primary'
                }`}
              >
                {s.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Tablero (dark, alto contraste) */}
      <div className="h-[calc(100vh-12rem)] min-h-[480px] rounded-xl overflow-hidden ring-1 ring-zinc-800">
        <KdsBoard
          locationId={resolvedLocationId}
          stationNames={stationNames}
          manualStationFilter={filter}
        />
      </div>
    </div>
  )
}
