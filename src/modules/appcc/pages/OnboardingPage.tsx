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

const GRANATE = '#7C1A1A'
const BEIGE = '#F5E9D9'
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

  // === EFECTOS ===

  // Si no hay local preseleccionado y solo hay uno activo, seleccionarlo automáticamente
  useEffect(() => {
    if (!locationId && activeLocations.length === 1) {
      setLocationId(activeLocations[0].id)
    }
  }, [activeLocations, locationId])

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
  // para las plantillas seleccionadas que aún no tienen hora manual
  useEffect(() => {
    if (templates.length === 0) return

    setScheduleTimes(prev => {
      const next = new Map(prev)
      templates.forEach(t => {
        const isSelected = selected.get(t.id) === true
        if (!isSelected) {
          // Si se deseleccionó, eliminamos su hora del map
          next.delete(t.id)
          return
        }
        // Solo calculamos hora sugerida si NO hay valor manual previo
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
            // No es esencial, no hay preset → sin hora por defecto
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
  const step3Valid = true // siempre, las horas son opcionales

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

    setSaving(true)
    setSaveError(null)

    try {
      const items: schedulesService.CreateScheduleInput[] = selectedRows.map(row => ({
        accountId: ACCOUNT_ID_FOODINT,
        locationId,
        templateId: row.template.id,
        recurrenceType: 'daily',
        recurrenceConfig: {},
        scheduledTime: scheduleTimes.get(row.template.id) ?? null,
        createdBy: userId,
      }))

      const created = await schedulesService.bulkCreateSchedules(items)
      console.log('[OnboardingPage] schedules creados:', created.length)

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
          className="text-base mb-3 text-gray-500 hover:text-gray-700 min-h-[44px]"
        >
          ← Cancelar
        </button>
        <h1
          className="text-4xl mb-1"
          style={{ fontFamily: '"Instrument Serif", serif', color: GRANATE }}
        >
          Configurar APPCC
        </h1>
        <p className="text-base text-gray-600">
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
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
                style={{
                  backgroundColor: isActive || isDone ? GRANATE : '#e5e7eb',
                  color: isActive || isDone ? BEIGE : '#6b7280',
                }}
              >
                {isDone ? '✓' : n}
              </div>
              <div className="text-sm font-medium hidden sm:block" style={{ color: isActive ? GRANATE : '#6b7280' }}>
                {n === 1 && 'Local'}
                {n === 2 && 'Plantillas'}
                {n === 3 && 'Horarios'}
              </div>
              {n < 3 && <div className="flex-1 h-px bg-gray-200" />}
            </div>
          )
        })}
      </div>

      {/* PASO 1: LOCAL + HORARIOS */}
      {step === 1 && (
        <section className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-3" style={{ color: GRANATE }}>
              ¿Para qué local quieres configurar APPCC?
            </h2>
            {activeLocations.length === 0 ? (
              <p className="text-base text-gray-500 italic">
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
                      className="w-full text-left p-4 rounded-lg border-2 transition min-h-[64px]"
                      style={{
                        backgroundColor: isSelected ? BEIGE : '#fff',
                        borderColor: isSelected ? GRANATE : '#e5e7eb',
                      }}
                    >
                      <div className="font-medium text-base">{loc.name}</div>
                      {loc.address && (
                        <div className="text-sm text-gray-500 mt-0.5">{loc.address}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-3" style={{ color: GRANATE }}>
              ¿En qué horario trabaja este local?
            </h2>
            <p className="text-base text-gray-600 mb-4">
              Usaremos estas horas para sugerir cuándo realizar cada control.
              Después podrás ajustar cada uno individualmente.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <label className="flex-1">
                <span className="block text-sm font-semibold uppercase tracking-wider text-gray-500 mb-1">
                  Hora de apertura
                </span>
                <input
                  type="time"
                  value={openingTime}
                  onChange={e => setOpeningTime(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 min-h-[48px]"
                />
              </label>
              <label className="flex-1">
                <span className="block text-sm font-semibold uppercase tracking-wider text-gray-500 mb-1">
                  Hora de cierre
                </span>
                <input
                  type="time"
                  value={closingTime}
                  onChange={e => setClosingTime(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 min-h-[48px]"
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
            <h2 className="text-xl font-semibold mb-1" style={{ color: GRANATE }}>
              ¿Qué controles APPCC quieres activar?
            </h2>
            <p className="text-base text-gray-600">
              Recomendamos empezar con las <strong>8 esenciales</strong> ya preseleccionadas.
              Puedes desmarcar las que no apliquen o añadir más.
            </p>
            <p className="text-sm text-gray-500 mt-2">
              {selectedCount} seleccionada{selectedCount !== 1 ? 's' : ''}
            </p>
          </div>

          {loadingCatalog ? (
            <div className="py-12 text-center text-base text-gray-500">Cargando catálogo...</div>
          ) : (
            <div className="space-y-2">
              {templateRows.map(row => (
                <button
                  key={row.template.id}
                  type="button"
                  onClick={() => toggleTemplate(row.template.id)}
                  className="w-full text-left p-4 rounded-lg border-2 transition flex items-start gap-3 min-h-[64px]"
                  style={{
                    backgroundColor: row.selected ? BEIGE : '#fff',
                    borderColor: row.selected ? GRANATE : '#e5e7eb',
                  }}
                >
                  <span
                    className="w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      backgroundColor: row.selected ? GRANATE : '#fff',
                      borderColor: row.selected ? GRANATE : '#d1d5db',
                      color: BEIGE,
                    }}
                  >
                    {row.selected && <span className="text-sm leading-none">✓</span>}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-base">{row.template.name}</span>
                      {row.isEssential && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-semibold"
                          style={{ backgroundColor: GRANATE, color: BEIGE }}
                        >
                          Esencial
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
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
            <h2 className="text-xl font-semibold mb-1" style={{ color: GRANATE }}>
              Repasa los horarios
            </h2>
            <p className="text-base text-gray-600">
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
                  className="p-4 rounded-lg border border-gray-200 bg-white flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-base">{row.template.name}</div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      {row.plan?.name ?? 'Plan APPCC'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="time"
                      value={time ?? ''}
                      onChange={e => setTimeForTemplate(row.template.id, e.target.value)}
                      className="w-32 px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 min-h-[44px]"
                    />
                    {time && (
                      <button
                        type="button"
                        onClick={() => clearTimeForTemplate(row.template.id)}
                        title="Quitar hora (cualquier momento del día)"
                        className="text-sm px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-100 min-h-[44px]"
                      >
                        Sin hora
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div
            className="mt-6 p-4 rounded-lg text-base"
            style={{ backgroundColor: BEIGE, color: GRANATE }}
          >
            <strong>Resumen:</strong> Vas a activar {selectedCount} control{selectedCount !== 1 ? 'es' : ''}
            {' '}APPCC en {currentLocation?.name ?? 'este local'}, con frecuencia diaria.
            Cada día aparecerán en "APPCC: Hoy" para que tu equipo los rellene.
          </div>

          {saveError && (
            <div className="mt-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-base text-red-700">
              {saveError}
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
            className="px-5 py-3 rounded-lg text-base font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-[48px] disabled:opacity-50"
          >
            ← Anterior
          </button>
        ) : <div />}

        {step < 3 && (
          <button
            type="button"
            onClick={() => setStep((step + 1) as WizardStep)}
            disabled={!canGoNext()}
            className="px-6 py-3 rounded-lg text-base font-medium transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
            style={{ backgroundColor: GRANATE, color: BEIGE }}
          >
            Siguiente →
          </button>
        )}

        {step === 3 && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || selectedCount === 0}
            className="px-6 py-3 rounded-lg text-base font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
            style={{ backgroundColor: GRANATE, color: BEIGE }}
          >
            {saving ? 'Guardando…' : '✓ Guardar y activar'}
          </button>
        )}
      </div>
    </div>
  )
}