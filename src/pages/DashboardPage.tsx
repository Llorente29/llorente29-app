// src/pages/DashboardPage.tsx
// Dashboard principal con KPIs del negocio.
//
// Lectura de datos:
//  - Locales / staff: del AppContext (state local + sincronizado con Supabase)
//  - Trabajando ahora: derivado de clockEntries
//  - Tareas pendientes: del AppContext (legacy `tasks`)
//  - Incidencias abiertas: de Supabase (tabla appcc_incidents) — NO del context legacy
//
// Para clientes multi-local, las tarjetas de Incidencias e Incidencias
// muestran un desglose por local debajo del total.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/ui'
import * as incidentsService from '../modules/appcc/services/incidentsService'
import type { AppccIncident } from '../modules/appcc/types'
import type { Location } from '../types'

export function DashboardPage() {
  const { staff, tasks, locations } = useApp()

  // ---------- Datos derivados del context ----------
  const working = staff.filter(e => e.clockEntries[0]?.type === 'entrada').length
  const pending = tasks.filter(t => t.status === 'pendiente' || t.status === 'vencida').length

  const activeLocations = useMemo<Location[]>(
    () => locations.filter(l => l.active),
    [locations]
  )

  // ---------- Cargar incidencias abiertas de Supabase (todos los locales) ----------
  const [openIncidents, setOpenIncidents] = useState<AppccIncident[]>([])
  const [loadingInc, setLoadingInc] = useState(false)

  async function loadIncidents() {
    if (activeLocations.length === 0) {
      setOpenIncidents([])
      return
    }
    setLoadingInc(true)
    try {
      const all = await Promise.all(
        activeLocations.map(l => incidentsService.listOpenIncidents(l.id))
      )
      setOpenIncidents(all.flat())
    } catch (err) {
      console.error('[DashboardPage] loadIncidents error', err)
    } finally {
      setLoadingInc(false)
    }
  }

  // Carga inicial y refresco cada 60s
  useEffect(() => {
    void loadIncidents()
    const id = setInterval(() => void loadIncidents(), 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocations.length])

  const openInc = openIncidents.length

  // Desglose por local (solo locales con incidencias abiertas; ordenados por count desc)
  const incidentsByLocation = useMemo(() => {
    const map = new Map<string, number>()
    openIncidents.forEach(inc => {
      map.set(inc.location_id, (map.get(inc.location_id) ?? 0) + 1)
    })
    return activeLocations
      .map(l => ({ location: l, count: map.get(l.id) ?? 0 }))
      .sort((a, b) => b.count - a.count)
  }, [openIncidents, activeLocations])

  // Si es multi-local (más de 1), mostramos desglose en la card de incidencias
  const isMultiLocal = activeLocations.length > 1

  // ---------- KPIs ----------
  const stats: KpiCard[] = [
    {
      key: 'locations',
      label: 'Locales activos',
      val: activeLocations.length,
      color: 'bg-success-bg text-success',
    },
    {
      key: 'employees',
      label: 'Empleados activos',
      val: staff.filter(e => e.active).length,
      color: 'bg-success-bg text-success',
    },
    {
      key: 'working',
      label: 'Trabajando ahora',
      val: working,
      color: 'bg-accent-bg text-accent',
    },
    {
      key: 'tasks',
      label: 'Tareas pendientes',
      val: pending,
      color: pending > 0 ? 'bg-warning-bg text-warning' : 'bg-page text-text-secondary',
    },
    {
      key: 'incidents',
      label: 'Incidencias abiertas',
      val: openInc,
      color: openInc > 0 ? 'bg-danger-bg text-danger' : 'bg-page text-text-secondary',
      loading: loadingInc,
      breakdown: isMultiLocal && openInc > 0
        ? incidentsByLocation
            .filter(b => b.count > 0)
            .map(b => ({ label: b.location.name, count: b.count }))
        : undefined,
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-display text-text-primary">Dashboard</h1>
        <p className="text-sm text-text-secondary">Resumen general de tu negocio</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map(s => <KpiCardView key={s.key} card={s} />)}
      </div>

      {/* Si es multi-local con más de 1 local activo, mostramos también un panel
          ampliado con TODOS los locales y su métrica (incluso los que están a 0). */}
      {isMultiLocal && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-text-primary">
              Incidencias abiertas por local
            </h2>
            {loadingInc && (
              <span className="text-xs text-text-secondary">Actualizando…</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {incidentsByLocation.map(({ location, count }) => (
              <div
                key={location.id}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border ${
                  count > 0
                    ? 'bg-danger-bg/40 border-danger/20'
                    : 'bg-page border-border-default'
                }`}
              >
                <span className="text-sm font-medium text-text-primary truncate">
                  {location.name}
                </span>
                <span
                  className={`text-lg font-bold tabular-nums shrink-0 ${
                    count > 0 ? 'text-danger' : 'text-text-secondary'
                  }`}
                >
                  {count}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {locations.length === 0 && (
        <Card className="p-6">
          <p className="font-medium text-text-primary">Empieza creando un local</p>
          <p className="text-sm text-text-secondary mt-1">
            Ve a Locales en el menú para añadir tu primer local.
          </p>
        </Card>
      )}
    </div>
  )
}

// ============================================================
// KPI CARD
// ============================================================

interface KpiCard {
  key: string
  label: string
  val: number
  color: string
  loading?: boolean
  /** Mini-desglose opcional bajo el número grande */
  breakdown?: { label: string; count: number }[]
}

function KpiCardView({ card }: { card: KpiCard }) {
  return (
    <div className={`p-4 rounded-lg border border-border-default ${card.color}`}>
      <p className="text-3xl font-bold tabular-nums">
        {card.loading ? '…' : card.val}
      </p>
      <p className="text-xs mt-1">{card.label}</p>
      {card.breakdown && card.breakdown.length > 0 && (
        <div className="mt-2 pt-2 border-t border-current/10 space-y-0.5">
          {card.breakdown.map(b => (
            <div key={b.label} className="flex items-center justify-between text-xs">
              <span className="truncate opacity-80">{b.label}</span>
              <span className="font-semibold tabular-nums shrink-0 ml-2">{b.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
