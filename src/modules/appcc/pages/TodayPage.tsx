// src/modules/appcc/pages/TodayPage.tsx
// Página "Checklists APPCC de hoy".
// Muestra las ejecuciones pendientes/en curso del día para un local seleccionado.
// Permite también arrancar checklists ad-hoc desde el catálogo de plantillas.
//
// LAZY GENERATION:
// Al entrar en la página (o al cambiar de local), revisa los schedules activos
// que aplican hoy y crea automáticamente las executions pendientes que falten.
// De este modo, abrir APPCC: Hoy es la "alarma operativa" del día.
//
// BLOQUE C Fases 2-3 (17/05/2026):
//   - Eliminada prop `onOpenExecution`.
//   - Navegación a ejecución vía useNavigate + pageToRoute('appcc_execution', ...).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Location } from '@/types'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { pageToRoute } from '@/routes'
import * as executionsService from '@/modules/appcc/services/executionsService'
import * as schedulesService from '@/modules/appcc/services/schedulesService'
import * as templatesService from '@/modules/appcc/services/templatesService'
import * as assignmentService from '@/modules/appcc/services/assignmentService'
import type {
  AppccExecution,
  AppccExecutionStatus,
  AppccTemplate,
  AppccPlan,
} from '@/modules/appcc/types'
import { Plus, X, ClipboardList, ArrowRight, AlertCircle } from 'lucide-react'

const STATUS_LABELS: Record<AppccExecutionStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  completed: 'Completado',
  overdue: 'Vencido',
  skipped: 'Saltado',
}

// Clases tailwind por status (usan tokens del sistema)
const STATUS_BADGE: Record<AppccExecutionStatus, string> = {
  pending: 'bg-accent-bg text-text-secondary',
  in_progress: 'bg-accent-bg text-accent',
  completed: 'bg-success-bg text-success',
  overdue: 'bg-danger-bg text-danger',
  skipped: 'bg-page text-text-secondary',
}

export default function TodayPage() {
  const { locations } = useApp()
  // BLOQUE B-5b (17/05/2026): migrado de const local ACCOUNT_ID_FOLVY a
  // useActiveAccount(). activeAccountId para el useEffect de lazy-generation
  // (guard sin throw), requireActiveAccountId para el handler manual.
  const { activeAccount, activeAccountId, requireActiveAccountId } = useActiveAccount()
  const navigate = useNavigate()
  const slug = activeAccount?.slug ?? 'folvy'

  const activeLocations = useMemo<Location[]>(
    () => locations.filter(l => l.active),
    [locations]
  )

  const { resolvedLocationId } = useLocationScope()
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [executions, setExecutions] = useState<AppccExecution[]>([])
  const [plans, setPlans] = useState<AppccPlan[]>([])
  const [templates, setTemplates] = useState<AppccTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCatalog, setShowCatalog] = useState(false)

  // El selector global de local manda cuando hay uno concreto; en consolidado
  // (resolvedLocationId null) cae a la auto-selección del primer local activo,
  // porque esta es una pantalla operativa de un solo local (no agrega).
  useEffect(() => {
    if (resolvedLocationId) setSelectedLocationId(resolvedLocationId)
  }, [resolvedLocationId])

  useEffect(() => {
    if (!selectedLocationId && activeLocations.length > 0) {
      setSelectedLocationId(activeLocations[0].id)
    }
  }, [activeLocations, selectedLocationId])

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

  /**
   * Lazy generation + listado de executions del día.
   * Espera a tener activeAccountId resuelto para evitar escribir en cuenta
   * incorrecta durante el arranque.
   */
  useEffect(() => {
    if (!selectedLocationId || !activeAccountId) return
    let cancelled = false
    // Captura local del id para que TS sepa que no es null dentro del closure.
    const accountIdLocal = activeAccountId

    async function loadAndEnsure() {
      setLoading(true)
      setError(null)

      try {
        const locationId = selectedLocationId!
        const today = new Date().toISOString().slice(0, 10)

        const schedulesToday = await schedulesService.getSchedulesForDate(locationId, today)

        if (schedulesToday.length > 0) {
          const existingExecs = await executionsService.listExecutionsForDate(locationId, today)

          const existingScheduleIds = new Set<string>()
          for (const e of existingExecs) {
            if (e.schedule_id) existingScheduleIds.add(e.schedule_id)
          }

          const toCreate = schedulesToday.filter(s => !existingScheduleIds.has(s.id))

          if (toCreate.length > 0) {
            console.log(
              `[TodayPage] Lazy generation: creando ${toCreate.length} executions pending`
            )
            for (const schedule of toCreate) {
              if (cancelled) return
              // Asignación v2: por momento del control (apertura/cierre/hora
              // fija/cualquiera) cruzado con horario vivo + vacaciones + equidad.
              const assignedTo = await assignmentService.resolveAssignment({
                templateId: schedule.template_id,
                locationId,
                date: today,
                scheduledTime: schedule.scheduled_time,
              })
              await executionsService.createExecution(
                accountIdLocal,
                locationId,
                schedule.template_id,
                {
                  scheduleId: schedule.id,
                  scheduledDate: today,
                  scheduledTime: schedule.scheduled_time,
                  assignedTo,
                }
              )
            }
          }
        }

        if (cancelled) return
        const data = await executionsService.listTodayExecutions(locationId)
        if (!cancelled) setExecutions(data)
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Error cargando checklists'
          setError(msg)
          console.error('[TodayPage] loadAndEnsure error', err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAndEnsure()
    return () => { cancelled = true }
  }, [selectedLocationId, activeAccountId])

  const planById = useMemo(() => {
    const m = new Map<string, AppccPlan>()
    plans.forEach(p => m.set(p.id, p))
    return m
  }, [plans])

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
      const newExec = await executionsService.createExecution(
        requireActiveAccountId(),
        selectedLocationId,
        templateId
      )
      const fresh = await executionsService.listTodayExecutions(selectedLocationId)
      setExecutions(fresh)
      setShowCatalog(false)
      console.log('[TodayPage] Checklist manual creado:', newExec.id)
      navigate(pageToRoute('appcc_execution', slug, { executionId: newExec.id }))
    } catch (err) {
      console.error('[TodayPage] Error creando checklist', err)
      setError('No se pudo crear el checklist')
    }
  }

  function handleOpen(executionId: string) {
    navigate(pageToRoute('appcc_execution', slug, { executionId }))
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-4xl font-display text-text-primary mb-1">
            Checklists APPCC de hoy
          </h1>
          <p className="text-base text-text-secondary">
            {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCatalog(v => !v)}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md text-base font-medium bg-accent text-text-on-accent hover:bg-accent-hover transition-base min-h-touch shrink-0"
        >
          {showCatalog
            ? <><X size={18} /> Cerrar catálogo</>
            : <><Plus size={18} /> Arrancar checklist</>
          }
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
                className={`px-4 py-2.5 rounded-md text-base font-medium transition-base min-h-touch border ${
                  active
                    ? 'bg-accent text-text-on-accent border-accent'
                    : 'bg-card text-text-primary border-border-default hover:border-accent'
                }`}
              >
                {loc.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Catálogo desplegable */}
      {showCatalog && (
        <div className="mb-6 rounded-lg p-5 border border-border-default bg-accent-bg">
          <h2 className="text-xl font-display text-text-primary mb-2">
            Arrancar un checklist
          </h2>
          <p className="text-base text-text-secondary mb-4">
            Elige una plantilla para iniciar ahora una ejecución en este local.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {templates.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleStartChecklist(t.id)}
                className="text-left px-4 py-3 rounded-md bg-card hover:bg-page border border-border-default transition-base min-h-[60px]"
              >
                <div className="font-medium text-base text-text-primary">{t.name}</div>
                <div className="text-sm text-text-secondary mt-0.5">
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
        <div className="py-12 text-center text-base text-text-secondary">Cargando checklists...</div>
      )}

      {error && (
        <div className="py-4 px-4 mb-4 rounded-md border border-danger/30 bg-danger-bg text-danger text-base inline-flex items-start gap-2 w-full">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && executions.length === 0 && (
        <div className="py-12 px-4 text-center rounded-lg border-2 border-dashed border-border-default bg-accent-bg">
          <ClipboardList size={48} className="text-accent mx-auto mb-3" />
          <h3 className="text-xl font-display text-text-primary mb-1">
            No hay checklists pendientes
          </h3>
          <p className="text-base text-text-secondary">
            Pulsa "Arrancar checklist" para iniciar uno ahora.
          </p>
        </div>
      )}

      {!loading && !error && executions.length > 0 && (
        <div className="space-y-3">
          {executions.map(exec => {
            const tpl = templateById.get(exec.template_id)
            const plan = tpl ? planById.get(tpl.plan_id) : undefined
            return (
              <div
                key={exec.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 sm:p-5 bg-card rounded-lg border border-border-default hover:shadow-sm transition-base"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-base text-text-primary">
                    {tpl?.name ?? 'Checklist sin nombre'}
                  </div>
                  <div className="text-sm text-text-secondary mt-0.5">
                    {plan?.name ?? 'Plan APPCC'}
                    {exec.scheduled_time ? ` · ${exec.scheduled_time.slice(0, 5)}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs px-2.5 py-1 rounded-sm font-medium ${STATUS_BADGE[exec.status]}`}>
                    {STATUS_LABELS[exec.status]}
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-base px-4 py-2.5 rounded-md bg-accent text-text-on-accent font-medium hover:bg-accent-hover transition-base min-h-touch"
                    onClick={() => handleOpen(exec.id)}
                  >
                    Abrir <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
