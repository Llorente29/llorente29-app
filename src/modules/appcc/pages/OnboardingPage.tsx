// src/modules/appcc/pages/OnboardingPage.tsx
// Wizard de configuración inicial APPCC para un local.
// 3 pasos: (1) local + horarios, (2) plantillas, (3) horas individuales.
// Al guardar, crea todos los schedules en bulk via bulkCreateSchedules().

import { useEffect, useMemo, useState } from 'react'
import type { Location } from '@/types'
import { useApp } from '@/context/AppContext'
import { supabase } from '@/lib/supabase'
import * as schedulesService from '@/modules/appcc/services/schedulesService'
import * as templatesService from '@/modules/appcc/services/templatesService'
import type {
  AppccTemplate,
  AppccPlan,
} from '@/modules/appcc/types'
import { ArrowLeft, ArrowRight, Check, AlertCircle, Save } from 'lucide-react'

const ACCOUNT_ID_FOODINT = '00000000-0000-0000-0000-000000000001'

interface OnboardingPageProps {
  /** Local preseleccionado (opcional). Si viene, salta el paso 1 al cargar. */
  initialLocationId?: string | null
  /** Callback al terminar (cancelar o guardar) — el padre decide a dónde ir. */
  onFinish: (result: { saved: boolean; locationId: string | null }) => void
}

type WizardStep = 1 | 2 | 3

// Item de plantilla en el step 2 con el estado de selección
interface TemplateRow {
  template: AppccTemplate
  plan: AppccPlan | undefined
  selected: boolean
  isEssential: boolean
}

export default function OnboardingPage({ initialLocationId, onFinish }: OnboardingPageProps) {
  const { locations } = useApp()

  const activeLocations = useMemo<Location[]>(
    () => locations.filter(l => l.active),
    [locations]
  )

  // === ESTADO DEL WIZARD ===
  const [step, setStep] = useState<WizardStep>(1)
  const [locationId, setLocationId] = useState<string | null>(initialLocationId ?? null)
  const [openingTime, setOpeningTime] = useState<string>('12:30')
  const [closingTime, setClosingTime] = useState<string>('23:30')

  // Catálogo
  const [templates, setTemplates] = useState<AppccTemplate[]>([])
  const [plans, setPlans] = useState<AppccPlan[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(true)

  // Selección de plantillas (key: templateId, value: selected)
  const [selected, setSelected] = useState<Map<string, boolean>>(new Map())
  // Horas individuales (key: templateId, value: 'HH:MM' o null)
  const [scheduleTimes, setScheduleTimes] = useState<Map<string, string | null>>(new Map())

  // Estado del guardado
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  // Anti-duplicación: schedules ya existentes para el local seleccionado
  const [existingCount, setExistingCount] = useState<number>(0)
  const [loadingExisting, setLoadingExisting] = useState(false)

  // === EFECTOS ===

  // Si no hay local preseleccionado y solo hay uno activo, seleccionarlo automáticamente
  useEffect(() => {
    if (!locationId && activeLocations.length === 1) {
      setLocationId(activeLocations[0].id)
    }
  }, [activeLocations, locationId])

  // Detectar si el local ya tiene schedules activos (anti-duplicación)
  useEffect(() => {
    if (!locationId) { setExistingCount(0); return }
    let cancel = false
    setLoadingExisting(true)
    schedulesService.countActiveSchedules(locationId)
      .then(n => { if (!cancel) setExistingCount(n) })
      .catch(() => { if (!cancel) setExistingCount(0) })
      .finally(() => { if (!cancel) setLoadingExisting(false) })
    return () => { cancel = true }
  }, [locationId])

  // Cargar catálogo (plantillas + planes)
  useEffect(() => {
    setLoadingCatalog(true)
    Promise.all([
      templatesService.listTemplates(),
      templatesService.listPlans(),
    ]).then(([tpls, pls]) => {
      setTemplates(tpls)
      setPlans(pls)
      // Preseleccionar las 8 esenciales
      const essentialCodes = new Set(
        schedulesService.ESSENTIAL_TEMPLATE_PRESETS.map(p => p.templateCode)
      )
      const initialSelection = new Map<string, boolean>()
      tpls.forEach(t => {
        initialSelection.set(t.id, essentialCodes.has(t.code))
      })
      setSelected(initialSelection)
    }).catch(err => {
      console.error('[OnboardingPage] Error cargando catálogo', err)
    }).finally(() => setLoadingCatalog(false))
  }, [])

  // Obtener el user_id actual
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
  }, [])

  // Cuando cambian las horas de apertura/cierre o la selección, recalcular horas sugeridas
  useEffect(() => {
    if (templates.length === 0) return

    setScheduleTimes(prev => {
      const next = new Map(prev)
      templates.forEach(t => {
        const isSelected = selected.get(t.id) === true
        if (!isSelected) {
          next.delete(t.id)
          return
        }
        if (!next.has(t.id)) {
          const preset = schedulesService.ESSENTIAL_TEMPLATE_PRESETS.find(
            p => p.templateCode === t.code
          )
          if (preset) {
            const suggested = schedulesService.computeSuggestedTime(
              preset,
              openingTime,
              closingTime,
            )
            next.set(t.id, suggested)
          } else {
            next.set(t.id, null)
          }
        }
      })
      return next
    })
  }, [openingTime, closingTime, selected, templates])

  // === DERIVED ===

  const planById = useMemo(() => {
    const m = new Map<string, AppccPlan>()
    plans.forEach(p => m.set(p.id, p))
    return m
  }, [plans])

  const essentialCodes = useMemo(() =>
    new Set(schedulesService.ESSENTIAL_TEMPLATE_PRESETS.map(p => p.templateCode))
  , [])

  const templateRows: TemplateRow[] = useMemo(() => {
    return templates.map(t => ({
      template: t,
      plan: planById.get(t.plan_id),
      selected: selected.get(t.id) === true,
      isEssential: essentialCodes.has(t.code),
    }))
  }, [templates, planById, selected, essentialCodes])

  const selectedCount = useMemo(
    () => templateRows.filter(r => r.selected).length,
    [templateRows]
  )

  const selectedRows = useMemo(
    () => templateRows.filter(r => r.selected),
    [templateRows]
  )

  const currentLocation = useMemo(
    () => activeLocations.find(l => l.id === locationId) ?? null,
    [activeLocations, locationId]
  )

  // === VALIDACIONES ===

  const step1Valid = locationId !== null
    && /^\d{2}:\d{2}$/.test(openingTime)
    && /^\d{2}:\d{2}$/.test(closingTime)

  const step2Valid = selectedCount > 0
  const step3Valid = true

  function canGoNext(): boolean {
    if (step === 1) return step1Valid
    if (step === 2) return step2Valid
    return step3Valid
  }

  // === HANDLERS ===

  function toggleTemplate(templateId: string) {
    setSelected(prev => {
      const next = new Map(prev)
      next.set(templateId, !(next.get(templateId) === true))
      return next
    })
  }

  function setTimeForTemplate(templateId: string, time: string) {
    setScheduleTimes(prev => {
      const next = new Map(prev)
      next.set(templateId, time === '' ? null : time)
      return next
    })
  }

  function clearTimeForTemplate(templateId: string) {
    setScheduleTimes(prev => {
      const next = new Map(prev)
      next.set(templateId, null)
      return next
    })
  }

  async function handleSave() {
    if (!locationId || !userId) return
    if (selectedCount === 0) return

    // Si hay schedules existentes, confirmar reemplazo
    if (existingCount > 0) {
      const ok = confirm(
        `${currentLocation?.name || 'Este local'} ya tiene ${existingCount} controles APPCC activos.\n\n` +
        `¿Desactivar los existentes y reemplazar con la nueva configuración?`
      )
      if (!ok) return
    }

    setSaving(true)
    setSaveError(null)

    try {
      // Desactivar schedules existentes antes de crear los nuevos
      if (existingCount > 0) {
        const existing = await schedulesService.listActiveSchedules(locationId)
        for (const s of existing) {
          await schedulesService.deactivateSchedule(s.id)
        }
      }

      const items: schedulesService.CreateScheduleInput[] = selectedRows.map(row => ({
        accountId: ACCOUNT_ID_FOODINT,
        locationId,
        templateId: row.template.id,
        recurrenceType: 'daily',
        recurrenceConfig: {},
        scheduledTime: scheduleTimes.get(row.template.id) ?? null,
        createdBy: userId,
      }))

      await schedulesService.bulkCreateSchedules(items)

      onFinish({ saved: true, locationId })
    } catch (err) {
      console.error('[OnboardingPage] Error guardando', err)
      setSaveError(err instanceof Error ? err.message : 'Error al guardar la configuración')
    } finally {
      setSaving(false)
    }
  }

  // === RENDER ===

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          type="button"
          onClick={() => onFinish({ saved: false, locationId })}
          className="inline-flex items-center gap-1.5 text-base mb-3 text-text-secondary hover:text-text-primary transition-base min-h-touch"
        >
          <ArrowLeft size={16} /> Cancelar
        </button>
        <h1 className="text-4xl font-display text-text-primary mb-1">
          Configurar APPCC
        </h1>
        <p className="text-base text-text-secondary">
          Activa los controles diarios para empezar a usar el módulo.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map(n => {
          const isActive = step === n
          const isDone = step > n
          return (
            <div key={n} className="flex items-center gap-2 flex-1">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                  isActive || isDone
                    ? 'bg-accent text-text-on-accent'
                    : 'bg-accent-bg text-text-secondary'
                }`}
              >
                {isDone ? <Check size={16} /> : n}
              </div>
              <div className={`text-sm font-medium hidden sm:block ${
                isActive ? 'text-accent' : 'text-text-secondary'
              }`}>
                {n === 1 && 'Local'}
                {n === 2 && 'Plantillas'}
                {n === 3 && 'Horarios'}
              </div>
              {n < 3 && <div className="flex-1 h-px bg-border-default" />}
            </div>
          )
        })}
      </div>

      {/* PASO 1: LOCAL + HORARIOS */}
      {step === 1 && (
        <section className="space-y-6">
          <div>
            <h2 className="text-xl font-display text-text-primary mb-3">
              ¿Para qué local quieres configurar APPCC?
            </h2>
            {activeLocations.length === 0 ? (
              <p className="text-base text-text-secondary italic">
                No hay locales activos. Crea un local antes de configurar APPCC.
              </p>
            ) : (
              <div className="space-y-2">
                {activeLocations.map(loc => {
                  const isSelected = locationId === loc.id
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => setLocationId(loc.id)}
                      className={`w-full text-left p-4 rounded-lg border-2 transition-base min-h-[64px] ${
                        isSelected
                          ? 'bg-accent-bg border-accent'
                          : 'bg-card border-border-default hover:border-text-secondary'
                      }`}
                    >
                      <div className="font-medium text-base text-text-primary">{loc.name}</div>
                      {loc.address && (
                        <div className="text-sm text-text-secondary mt-0.5">{loc.address}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Warning: local ya configurado */}
          {locationId && !loadingExisting && existingCount > 0 && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-warning-bg border border-warning/30">
              <AlertCircle size={20} className="text-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-warning">
                  {currentLocation?.name || 'Este local'} ya tiene {existingCount} controles APPCC activos.
                </p>
                <p className="text-xs text-warning mt-1">
                  Si continúas y guardas, los controles existentes se desactivarán y se reemplazarán por los que configures aquí.
                </p>
              </div>
            </div>
          )}

          <div>
            <h2 className="text-xl font-display text-text-primary mb-3">
              ¿En qué horario trabaja este local?
            </h2>
            <p className="text-base text-text-secondary mb-4">
              Usaremos estas horas para sugerir cuándo realizar cada control.
              Después podrás ajustar cada uno individualmente.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <label className="flex-1">
                <span className="block text-sm font-semibold uppercase tracking-wider text-text-secondary mb-1">
                  Hora de apertura
                </span>
                <input
                  type="time"
                  value={openingTime}
                  onChange={e => setOpeningTime(e.target.value)}
                  className="w-full px-4 py-3 border border-border-default rounded-md text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent min-h-[48px]"
                />
              </label>
              <label className="flex-1">
                <span className="block text-sm font-semibold uppercase tracking-wider text-text-secondary mb-1">
                  Hora de cierre
                </span>
                <input
                  type="time"
                  value={closingTime}
                  onChange={e => setClosingTime(e.target.value)}
                  className="w-full px-4 py-3 border border-border-default rounded-md text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent min-h-[48px]"
                />
              </label>
            </div>
          </div>
        </section>
      )}

      {/* PASO 2: PLANTILLAS */}
      {step === 2 && (
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-display text-text-primary mb-1">
              ¿Qué controles APPCC quieres activar?
            </h2>
            <p className="text-base text-text-secondary">
              Recomendamos empezar con las <strong>8 esenciales</strong> ya preseleccionadas.
              Puedes desmarcar las que no apliquen o añadir más.
            </p>
            <p className="text-sm text-text-secondary mt-2">
              {selectedCount} seleccionada{selectedCount !== 1 ? 's' : ''}
            </p>
          </div>

          {loadingCatalog ? (
            <div className="py-12 text-center text-base text-text-secondary">Cargando catálogo...</div>
          ) : (
            <div className="space-y-2">
              {templateRows.map(row => (
                <button
                  key={row.template.id}
                  type="button"
                  onClick={() => toggleTemplate(row.template.id)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-base flex items-start gap-3 min-h-[64px] ${
                    row.selected
                      ? 'bg-accent-bg border-accent'
                      : 'bg-card border-border-default hover:border-text-secondary'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                      row.selected
                        ? 'bg-accent border-accent text-text-on-accent'
                        : 'bg-card border-border-default'
                    }`}
                  >
                    {row.selected && <Check size={14} strokeWidth={3} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-base text-text-primary">{row.template.name}</span>
                      {row.isEssential && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-warning-bg text-warning">
                          Esencial
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-text-secondary mt-0.5">
                      {row.plan?.name ?? 'Plan APPCC'}
                      {row.template.estimated_minutes ? ` · ~${row.template.estimated_minutes} min` : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* PASO 3: HORARIOS INDIVIDUALES */}
      {step === 3 && (
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-display text-text-primary mb-1">
              Repasa los horarios
            </h2>
            <p className="text-base text-text-secondary">
              Hemos sugerido una hora para cada control en base a tu horario
              ({openingTime} – {closingTime}). Ajústalo o déjalo en blanco para "cualquier momento del día".
            </p>
          </div>

          <div className="space-y-2">
            {selectedRows.map(row => {
              const time = scheduleTimes.get(row.template.id)
              return (
                <div
                  key={row.template.id}
                  className="p-4 rounded-lg border border-border-default bg-card flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-base text-text-primary">{row.template.name}</div>
                    <div className="text-sm text-text-secondary mt-0.5">
                      {row.plan?.name ?? 'Plan APPCC'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="time"
                      value={time ?? ''}
                      onChange={e => setTimeForTemplate(row.template.id, e.target.value)}
                      className="w-32 px-3 py-2.5 border border-border-default rounded-md text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
                    />
                    {time && (
                      <button
                        type="button"
                        onClick={() => clearTimeForTemplate(row.template.id)}
                        title="Quitar hora (cualquier momento del día)"
                        className="text-sm px-3 py-2 rounded-md text-text-secondary hover:bg-page transition-base min-h-touch"
                      >
                        Sin hora
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-6 p-4 rounded-md text-base bg-accent-bg text-text-primary border border-border-default">
            <strong className="text-accent">Resumen:</strong> Vas a activar {selectedCount} control{selectedCount !== 1 ? 'es' : ''}
            {' '}APPCC en {currentLocation?.name ?? 'este local'}, con frecuencia diaria.
            Cada día aparecerán en "APPCC: Hoy" para que tu equipo los rellene.
          </div>

          {saveError && (
            <div className="mt-4 px-4 py-3 rounded-md bg-danger-bg border border-danger/30 text-base text-danger inline-flex items-start gap-2 w-full">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}
        </section>
      )}

      {/* NAVEGACIÓN ENTRE PASOS */}
      <div className="mt-8 flex items-center justify-between gap-3 flex-wrap">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((step - 1) as WizardStep)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-3 rounded-md text-base font-medium border border-border-default bg-card text-text-primary hover:bg-page min-h-[48px] disabled:opacity-50 transition-base"
          >
            <ArrowLeft size={16} /> Anterior
          </button>
        ) : <div />}

        {step < 3 && (
          <button
            type="button"
            onClick={() => setStep((step + 1) as WizardStep)}
            disabled={!canGoNext()}
            className="inline-flex items-center gap-1.5 px-6 py-3 rounded-md text-base font-medium bg-accent text-text-on-accent hover:bg-accent-hover transition-base disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
          >
            Siguiente <ArrowRight size={16} />
          </button>
        )}

        {step === 3 && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || selectedCount === 0}
            className="inline-flex items-center gap-1.5 px-6 py-3 rounded-md text-base font-semibold bg-accent text-text-on-accent hover:bg-accent-hover transition-base disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
          >
            {saving
              ? 'Guardando…'
              : <><Save size={16} /> Guardar y activar</>
            }
          </button>
        )}
      </div>
    </div>
  )
}
