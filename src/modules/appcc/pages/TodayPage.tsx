// src/modules/appcc/pages/TodayPage.tsx
// Página "Checklists APPCC de hoy".
// Muestra las ejecuciones pendientes/en curso del día para un local seleccionado.
// Permite también arrancar checklists ad-hoc desde el catálogo de plantillas.

import { useEffect, useMemo, useState } from 'react'
import type { Location } from '@/types'
import { useApp } from '@/context/AppContext'
import * as executionsService from '@/modules/appcc/services/executionsService'
import * as templatesService from '@/modules/appcc/services/templatesService'
import type {
  AppccExecution,
  AppccExecutionStatus,
  AppccTemplate,
  AppccPlan,
} from '@/modules/appcc/types'

// Colores del branding Foodint
const GRANATE = '#7C1A1A'
const BEIGE = '#F5E9D9'

const STATUS_LABELS: Record<AppccExecutionStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  completed: 'Completado',
  overdue: 'Vencido',
  skipped: 'Saltado',
}

const STATUS_COLORS: Record<AppccExecutionStatus, string> = {
  pending: '#6b7280',
  in_progress: '#2563eb',
  completed: '#16a34a',
  overdue: '#dc2626',
  skipped: '#9ca3af',
}

interface TodayPageProps {
  /** Callback que invoca el padre cuando el usuario pulsa "Abrir" en un checklist. */
  onOpenExecution?: (executionId: string) => void
}

export default function TodayPage({ onOpenExecution }: TodayPageProps) {
  const { locations } = useApp()

  // Solo locales activos, en orden estable
  const activeLocations = useMemo<Location[]>(
    () => locations.filter(l => l.active),
    [locations]
  )

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [executions, setExecutions] = useState<AppccExecution[]>([])
  const [plans, setPlans] = useState<AppccPlan[]>([])
  const [templates, setTemplates] = useState<AppccTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCatalog, setShowCatalog] = useState(false)

  // Al cargar, seleccionar el primer local activo
  useEffect(() => {
    if (!selectedLocationId && activeLocations.length > 0) {
      setSelectedLocationId(activeLocations[0].id)
    }
  }, [activeLocations, selectedLocationId])

  // Cargar ejecuciones de hoy cuando cambia el local seleccionado
  useEffect(() => {
    if (!selectedLocationId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    executionsService
      .listTodayExecutions(selectedLocationId)
      .then(data => { if (!cancelled) setExecutions(data) })
      .catch(err => { if (!cancelled) setError(err.message || 'Error cargando checklists') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedLocationId])

  // Cargar catálogo (planes + plantillas) una sola vez
  useEffect(() => {
    Promise.all([
      templatesService.listPlans(),
      templatesService.listTemplates(),
    ]).then(([pls, tpls]) => {
      setPlans(pls)
      setTemplates(tpls)
    }).catch(err => {
      console.error('[TodayPage] Error cargando catálogo', err)
    })
  }, [])

  // Mapa plan_id -> plan
  const planById = useMemo(() => {
    const m = new Map<string, AppccPlan>()
    plans.forEach(p => m.set(p.id, p))
    return m
  }, [plans])

  // Mapa template_id -> template
  const templateById = useMemo(() => {
    const m = new Map<string, AppccTemplate>()
    templates.forEach(t => m.set(t.id, t))
    return m
  }, [templates])

  async function handleStartChecklist(templateId: string) {
    if (!selectedLocationId) return
    const template = templates.find(t => t.id === templateId)
    if (!template) return

    try {
      const accountId = '00000000-0000-0000-0000-000000000001'
      const newExec = await executionsService.createExecution(
        accountId,
        selectedLocationId,
        templateId
      )
      // Refrescar lista
      const fresh = await executionsService.listTodayExecutions(selectedLocationId)
      setExecutions(fresh)
      setShowCatalog(false)
      console.log('[TodayPage] Checklist creado:', newExec.id)
      // Y abrirlo inmediatamente si tenemos callback
      onOpenExecution?.(newExec.id)
    } catch (err) {
      console.error('[TodayPage] Error creando checklist', err)
      setError('No se pudo crear el checklist')
    }
  }

  function handleOpen(executionId: string) {
    if (onOpenExecution) {
      onOpenExecution(executionId)
    } else {
      console.warn('[TodayPage] onOpenExecution no proporcionado por el padre')
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1
            className="text-3xl mb-1"
            style={{ fontFamily: '"Instrument Serif", serif', color: GRANATE }}
          >
            Checklists APPCC de hoy
          </h1>
          <p className="text-sm text-gray-600">
            {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCatalog(v => !v)}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: GRANATE, color: BEIGE }}
        >
          {showCatalog ? '× Cerrar catálogo' : '+ Arrancar checklist'}
        </button>
      </div>

      {/* Selector de local */}
      {activeLocations.length > 1 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {activeLocations.map(loc => {
            const active = loc.id === selectedLocationId
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => setSelectedLocationId(loc.id)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition"
                style={{
                  backgroundColor: active ? GRANATE : '#fff',
                  color: active ? BEIGE : GRANATE,
                  border: `1px solid ${GRANATE}`,
                }}
              >
                {loc.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Catálogo desplegable para arrancar checklist ad-hoc */}
      {showCatalog && (
        <div
          className="mb-6 rounded-xl p-5 border"
          style={{ backgroundColor: BEIGE, borderColor: GRANATE }}
        >
          <h2 className="text-lg font-semibold mb-3" style={{ color: GRANATE }}>
            Arrancar un checklist
          </h2>
          <p className="text-sm text-gray-700 mb-4">
            Elige una plantilla para iniciar ahora una ejecución en este local.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {templates.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleStartChecklist(t.id)}
                className="text-left px-3 py-2 rounded-lg bg-white hover:bg-gray-50 border border-gray-200 transition"
              >
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-gray-500">
                  {planById.get(t.plan_id)?.name ?? 'Plan APPCC'}
                  {t.estimated_minutes ? ` · ~${t.estimated_minutes} min` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Estado: cargando, error, o lista */}
      {loading && (
        <div className="py-12 text-center text-gray-500">Cargando checklists...</div>
      )}

      {error && (
        <div className="py-4 px-4 mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && executions.length === 0 && (
        <div
          className="py-12 text-center rounded-xl border-2 border-dashed"
          style={{ borderColor: GRANATE, backgroundColor: BEIGE }}
        >
          <div className="text-4xl mb-3">📋</div>
          <h3 className="text-lg font-semibold mb-1" style={{ color: GRANATE }}>
            No hay checklists pendientes
          </h3>
          <p className="text-sm text-gray-700">
            Pulsa "+ Arrancar checklist" para iniciar uno ahora.
          </p>
        </div>
      )}

      {!loading && !error && executions.length > 0 && (
        <div className="space-y-2">
          {executions.map(exec => {
            const tpl = templateById.get(exec.template_id)
            const plan = tpl ? planById.get(tpl.plan_id) : undefined
            return (
              <div
                key={exec.id}
                className="flex items-center gap-4 p-4 bg-white rounded-lg border border-gray-200 hover:shadow-sm transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    {tpl?.name ?? 'Checklist sin nombre'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {plan?.name ?? 'Plan APPCC'}
                    {exec.scheduled_time ? ` · ${exec.scheduled_time.slice(0, 5)}` : ''}
                  </div>
                </div>
                <span
                  className="text-xs px-2 py-1 rounded-full font-medium"
                  style={{
                    backgroundColor: STATUS_COLORS[exec.status] + '20',
                    color: STATUS_COLORS[exec.status],
                  }}
                >
                  {STATUS_LABELS[exec.status]}
                </span>
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-opacity hover:opacity-90"
                  style={{ backgroundColor: GRANATE, color: BEIGE }}
                  onClick={() => handleOpen(exec.id)}
                >
                  Abrir →
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}