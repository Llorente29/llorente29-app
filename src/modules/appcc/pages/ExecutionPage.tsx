// src/modules/appcc/pages/ExecutionPage.tsx
// Pantalla de ejecución de un checklist APPCC.
// El usuario rellena los items, se auto-guarda cada respuesta (con debounce),
// y al final firma para completar la ejecución.
//
// BLOQUE C Fases 2-3 (17/05/2026):
//   - Props `executionId` y `onBack` ahora OPCIONALES. Doble modo de uso:
//     • Router (gestor): URL con :executionId → useParams; onBack=undefined → navigate.
//     • TrabajadorApp: pasa props explícitas; se usan tal cual.
//   - Fallback a useNavigate hacia appcc_today cuando no llegan props.
//   - Si la URL llega sin executionId válido Y no hay prop, se redirige a appcc_today.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { pageToRoute } from '@/routes'
import * as executionsService from '@/modules/appcc/services/executionsService'
import * as templatesService from '@/modules/appcc/services/templatesService'
import FieldRenderer, { type FieldValue } from '@/modules/appcc/components/FieldRenderer'
import type {
  AppccExecution,
  AppccExecutionResponse,
  AppccTemplateWithItems,
} from '@/modules/appcc/types'
import { ArrowLeft, Check, Circle, AlertCircle, AlertTriangle, CheckCircle2, Download, Eye } from 'lucide-react'
import { generateChecklistPdf } from '@/modules/appcc/services/pdfExportService'
import type { PdfPreviewResult } from '@/modules/appcc/services/pdfExportService'
import ReportPreviewModal from '@/components/ReportPreviewModal'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface ExecutionPageProps {
  /** Si llega por prop (TrabajadorApp), se usa; sino se lee de la URL. */
  executionId?: string
  /** Si llega por prop, se invoca; sino se navega a appcc_today con useNavigate. */
  onBack?: () => void
}

export default function ExecutionPage({ executionId: propExecutionId, onBack: propOnBack }: ExecutionPageProps = {}) {
  const params = useParams<{ executionId: string }>()
  const navigate = useNavigate()
  const { activeAccount } = useActiveAccount()
  const slug = activeAccount?.slug ?? 'folvy'

  // Resolución de executionId: prop tiene prioridad sobre useParams.
  const executionId = propExecutionId ?? params.executionId

  // Si la URL no trae executionId Y no hay prop, volver a Hoy con replace.
  // Solo aplica al caso router; cuando hay propOnBack, asumimos que el padre
  // gestiona su propio routing y no debemos navegar.
  useEffect(() => {
    if (!executionId && !propOnBack) {
      navigate(pageToRoute('appcc_today', slug), { replace: true })
    }
  }, [executionId, propOnBack, navigate, slug])

  function goBack() {
    if (propOnBack) {
      propOnBack()
    } else {
      navigate(pageToRoute('appcc_today', slug))
    }
  }

  const [execution, setExecution] = useState<AppccExecution | null>(null)
  const [template, setTemplate] = useState<AppccTemplateWithItems | null>(null)
  const [responses, setResponses] = useState<Map<string, AppccExecutionResponse>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<Map<string, SaveStatus>>(new Map())
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState<'preview' | 'download' | null>(null)
  const [preview, setPreview] = useState<PdfPreviewResult | null>(null)

  const saveTimers = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (!executionId) return
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)

        if (!supabase) throw new Error('Supabase no disponible')
        const { data: userData } = await supabase.auth.getUser()
        if (!userData.user) throw new Error('No hay sesión activa')

        const execData = await executionsService.getExecution(executionId!)
        if (!execData) throw new Error('Ejecución no encontrada')

        const tplData = await templatesService.getTemplateWithItems(execData.execution.template_id)
        if (!tplData) throw new Error('Plantilla no encontrada')

        const respMap = new Map<string, AppccExecutionResponse>()
        execData.responses.forEach(r => respMap.set(r.item_id, r))

        let finalExecution = execData.execution
        if (execData.execution.status === 'pending') {
          finalExecution = await executionsService.startExecution(executionId!, userData.user.id)
        }

        if (!cancelled) {
          setUserId(userData.user.id)
          setExecution(finalExecution)
          setTemplate(tplData)
          setResponses(respMap)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[ExecutionPage] load error', err)
          setError(err instanceof Error ? err.message : 'Error cargando ejecución')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [executionId])

  useEffect(() => {
    return () => {
      saveTimers.current.forEach(t => window.clearTimeout(t))
      saveTimers.current.clear()
    }
  }, [])

  function handleChange(itemId: string, fieldType: string, next: FieldValue) {
    if (!userId) return
    if (!executionId) return
    if (execution?.status === 'completed') return

    const prevTimer = saveTimers.current.get(itemId)
    if (prevTimer) window.clearTimeout(prevTimer)

    const debounceMs = (fieldType === 'text' || fieldType === 'numeric') ? 600 : 0

    setResponses(prev => {
      const m = new Map(prev)
      const existing = m.get(itemId)
      const merged: AppccExecutionResponse = {
        id: existing?.id ?? '',
        execution_id: executionId,
        item_id: itemId,
        numeric_value: next.numeric_value ?? null,
        boolean_value: next.boolean_value ?? null,
        text_value: next.text_value ?? null,
        date_value: next.date_value ?? null,
        selected_option_id: next.selected_option_id ?? null,
        is_out_of_range: existing?.is_out_of_range ?? false,
        answered_at: existing?.answered_at ?? new Date().toISOString(),
        answered_by: userId,
      }
      m.set(itemId, merged)
      return m
    })

    setSaveStatus(prev => {
      const m = new Map(prev)
      m.set(itemId, 'saving')
      return m
    })

    const doSave = async () => {
      try {
        const saved = await executionsService.saveResponse(executionId, itemId, next, userId)
        setResponses(prev => {
          const m = new Map(prev)
          m.set(itemId, saved)
          return m
        })
        setSaveStatus(prev => {
          const m = new Map(prev)
          m.set(itemId, 'saved')
          return m
        })
        window.setTimeout(() => {
          setSaveStatus(prev => {
            const m = new Map(prev)
            if (m.get(itemId) === 'saved') m.delete(itemId)
            return m
          })
        }, 2000)
      } catch (err) {
        console.error('[ExecutionPage] save error', err)
        setSaveStatus(prev => {
          const m = new Map(prev)
          m.set(itemId, 'error')
          return m
        })
      }
    }

    if (debounceMs === 0) {
      doSave()
    } else {
      const t = window.setTimeout(doSave, debounceMs)
      saveTimers.current.set(itemId, t)
    }
  }

  function getNumericWarning(item: AppccTemplateWithItems['items'][0], value: FieldValue | null): string | null {
    if (item.field_type !== 'numeric') return null
    const v = value?.numeric_value
    if (v === null || v === undefined) return null
    if (item.numeric_min !== null && v < item.numeric_min) {
      return `Por debajo del mínimo (${item.numeric_min}${item.numeric_unit ?? ''})`
    }
    if (item.numeric_max !== null && v > item.numeric_max) {
      return `Por encima del máximo (${item.numeric_max}${item.numeric_unit ?? ''})`
    }
    return null
  }

  const missingRequired = useMemo(() => {
    if (!template) return []
    return template.items
      .filter(i => i.is_required)
      .filter(i => {
        const r = responses.get(i.id)
        if (!r) return true
        return !(
          r.numeric_value !== null ||
          r.boolean_value !== null ||
          (r.text_value !== null && r.text_value !== '') ||
          r.date_value !== null ||
          r.selected_option_id !== null
        )
      })
  }, [template, responses])

  async function handleComplete() {
    if (!userId || !execution || !template || !executionId) return
    if (missingRequired.length > 0) return

    const hasOutOfRange = Array.from(responses.values()).some(r => r.is_out_of_range)
    if (hasOutOfRange) {
      const confirmed = window.confirm(
        'Hay respuestas fuera de rango que han generado incidencias.\n\n' +
        '¿Confirmas el cierre del checklist?'
      )
      if (!confirmed) return
    }

    setCompleting(true)
    setCompleteError(null)
    try {
      const completed = await executionsService.completeExecution(executionId, userId, {})
      setExecution(completed)
    } catch (err) {
      console.error('[ExecutionPage] complete error', err)
      setCompleteError(err instanceof Error ? err.message : 'Error al completar')
    } finally {
      setCompleting(false)
    }
  }

  // Guard: sin executionId, no renderizar nada (el useEffect ya redirigió
  // si era el modo router; si era TrabajadorApp con propOnBack, este caso no
  // debería producirse porque el padre solo monta el componente con id válido).
  if (!executionId) {
    return null
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <div className="py-12 text-center text-base text-text-secondary">Cargando checklist...</div>
      </div>
    )
  }

  if (error || !execution || !template) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1.5 text-base mb-4 text-text-secondary hover:text-text-primary transition-base min-h-touch"
        >
          <ArrowLeft size={16} /> Volver
        </button>
        <div className="py-4 px-4 rounded-md border border-danger/30 bg-danger-bg text-danger text-base inline-flex items-start gap-2 w-full">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>{error ?? 'No se pudo cargar la ejecución.'}</span>
        </div>
      </div>
    )
  }

  // VISTA DE ÉXITO
  if (execution.status === 'completed') {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <div className="rounded-xl p-6 sm:p-8 text-center border border-border-default bg-accent-bg">
          <CheckCircle2 size={64} className="text-success mx-auto mb-3" />
          <h1 className="text-4xl font-display text-text-primary mb-2">
            Checklist completado y firmado
          </h1>
          <p className="text-base text-text-secondary mb-4">{template.name}</p>

          {execution.has_failures && execution.failure_count > 0 ? (
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md mb-6 text-base bg-warning-bg text-warning border border-warning/30">
              <AlertTriangle size={16} />
              {execution.failure_count} incidencia{execution.failure_count > 1 ? 's' : ''} abierta{execution.failure_count > 1 ? 's' : ''} pendiente{execution.failure_count > 1 ? 's' : ''} de gestión
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md mb-6 text-base bg-success-bg text-success border border-success/30">
              <Check size={16} /> Sin incidencias
            </div>
          )}

          <div className="text-sm text-text-secondary mb-6">
            Firmado el {execution.completed_at ? new Date(execution.completed_at).toLocaleString('es-ES') : '—'}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={goBack}
              className="px-6 py-3 rounded-md text-base font-medium bg-accent text-text-on-accent hover:bg-accent-hover transition-base min-h-[48px]"
            >
              Volver a Hoy
            </button>
            <button
              type="button"
              disabled={!!pdfLoading}
              onClick={async () => {
                setPdfLoading('preview')
                try {
                  let locationName = 'Local'
                  let locationAddress = ''
                  if (supabase && execution.location_id) {
                    const { data: loc } = await supabase.from('locations').select('name, address').eq('id', execution.location_id).maybeSingle()
                    if (loc) { locationName = loc.name; locationAddress = loc.address ?? '' }
                  }
                  const result = await generateChecklistPdf(
                    executionId,
                    { name: locationName, address: locationAddress },
                    { mode: 'preview' },
                  )
                  if (result) setPreview(result)
                } catch (err) {
                  console.error('[ExecutionPage] preview error', err)
                  alert('Error generando vista previa: ' + (err instanceof Error ? err.message : 'desconocido'))
                } finally {
                  setPdfLoading(null)
                }
              }}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-md text-base font-medium border-2 border-accent text-accent bg-card hover:bg-accent-bg transition-base min-h-[48px] disabled:opacity-50"
            >
              <Eye size={16} /> {pdfLoading === 'preview' ? 'Generando…' : 'Vista previa'}
            </button>
            <button
              type="button"
              disabled={!!pdfLoading}
              onClick={async () => {
                setPdfLoading('download')
                try {
                  let locationName = 'Local'
                  let locationAddress = ''
                  if (supabase && execution.location_id) {
                    const { data: loc } = await supabase.from('locations').select('name, address').eq('id', execution.location_id).maybeSingle()
                    if (loc) { locationName = loc.name; locationAddress = loc.address ?? '' }
                  }
                  await generateChecklistPdf(executionId, { name: locationName, address: locationAddress })
                } catch (err) {
                  console.error('[ExecutionPage] PDF error', err)
                  alert('Error generando PDF: ' + (err instanceof Error ? err.message : 'desconocido'))
                } finally {
                  setPdfLoading(null)
                }
              }}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-md text-base font-medium border-2 border-accent text-accent bg-card hover:bg-accent-bg transition-base min-h-[48px] disabled:opacity-50"
            >
              <Download size={16} /> {pdfLoading === 'download' ? 'Generando…' : 'Descargar PDF'}
            </button>
          </div>
        </div>

        {preview && (
          <ReportPreviewModal
            preview={preview}
            title="Certificado del checklist"
            onClose={() => setPreview(null)}
          />
        )}

        <details className="mt-6">
          <summary className="text-base text-text-secondary cursor-pointer hover:text-text-primary py-2 transition-base">
            Ver respuestas registradas
          </summary>
          <div className="mt-3 space-y-2">
            {template.items.map(item => {
              const r = responses.get(item.id)
              return (
                <div key={item.id} className="p-4 bg-card rounded-md border border-border-default text-base">
                  <div className="font-medium text-text-primary">{item.label}</div>
                  <div className="text-sm text-text-secondary mt-1">
                    {r?.numeric_value !== null && r?.numeric_value !== undefined && `${r.numeric_value} ${item.numeric_unit ?? ''}`}
                    {r?.boolean_value === true && '✓ Sí'}
                    {r?.boolean_value === false && '✗ No'}
                    {r?.text_value && r.text_value}
                    {r?.date_value && r.date_value}
                    {!r && <span className="italic">Sin respuesta</span>}
                    {r?.is_out_of_range && <span className="text-danger ml-2 inline-flex items-center gap-1"><AlertTriangle size={12} /> Fuera de rango</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </details>
      </div>
    )
  }

  // VISTA DE EJECUCIÓN
  const totalRequired = template.items.filter(i => i.is_required).length
  const answeredRequired = totalRequired - missingRequired.length
  const progressPct = totalRequired === 0
    ? 100
    : Math.round((answeredRequired / totalRequired) * 100)

  const allRequiredAnswered = missingRequired.length === 0

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-1.5 text-base mb-4 text-text-secondary hover:text-text-primary py-2 min-h-touch transition-base"
      >
        <ArrowLeft size={16} /> Volver a Hoy
      </button>

      <header className="mb-6">
        <div className="text-sm text-text-secondary mb-1">{template.plan.name}</div>
        <h1 className="text-4xl font-display text-text-primary mb-2">
          {template.name}
        </h1>
        {template.description && (
          <p className="text-base text-text-secondary">{template.description}</p>
        )}
      </header>

      <div className="mb-6 p-4 sm:p-5 rounded-lg bg-accent-bg border border-border-default">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <span className="text-sm font-semibold uppercase tracking-wider text-accent">
            Progreso
          </span>
          <span className="text-sm font-medium text-accent">
            {answeredRequired} / {totalRequired} obligatorios ({progressPct}%)
          </span>
        </div>
        <div className="h-3 bg-card rounded-full overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <section className="space-y-3 mb-6">
        {template.items.map(item => {
          const resp = responses.get(item.id) ?? null
          const respValue: FieldValue | null = resp
            ? {
                numeric_value: resp.numeric_value,
                boolean_value: resp.boolean_value,
                text_value: resp.text_value,
                date_value: resp.date_value,
                selected_option_id: resp.selected_option_id,
              }
            : null
          const answered = resp !== null && (
            resp.numeric_value !== null ||
            resp.boolean_value !== null ||
            (resp.text_value !== null && resp.text_value !== '') ||
            resp.date_value !== null ||
            resp.selected_option_id !== null
          )
          const status = saveStatus.get(item.id) ?? 'idle'
          const warning = getNumericWarning(item, respValue)

          return (
            <div
              key={item.id}
              className="p-4 sm:p-5 bg-card rounded-lg border border-border-default"
            >
              <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {answered
                    ? <Check size={20} className="text-success shrink-0 mt-0.5" />
                    : <Circle size={20} className="text-text-secondary shrink-0 mt-0.5" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-medium text-text-primary">
                      {item.label}
                      {item.is_required && <span className="text-danger ml-1">*</span>}
                    </div>
                    {item.help_text && (
                      <div className="text-sm text-text-secondary mt-0.5">{item.help_text}</div>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-sm">
                  {status === 'saving' && <span className="text-text-secondary">Guardando…</span>}
                  {status === 'saved' && <span className="text-success inline-flex items-center gap-1"><Check size={12} /> Guardado</span>}
                  {status === 'error' && <span className="text-danger inline-flex items-center gap-1"><AlertCircle size={12} /> Error</span>}
                </div>
              </div>

              <FieldRenderer
                item={item}
                value={respValue}
                onChange={(v) => handleChange(item.id, item.field_type, v)}
                disabled={completing}
                warning={warning}
                responseId={resp?.id ?? null}
                userId={userId}
              />
            </div>
          )
        })}
      </section>

      {!allRequiredAnswered && (
        <div className="mb-4 px-4 py-3 rounded-md bg-warning-bg border border-warning/30 text-base text-warning inline-flex items-start gap-2 w-full">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span>Faltan {missingRequired.length} respuesta{missingRequired.length > 1 ? 's' : ''} obligatoria{missingRequired.length > 1 ? 's' : ''} por rellenar.</span>
        </div>
      )}

      {completeError && (
        <div className="mb-4 px-4 py-3 rounded-md bg-danger-bg border border-danger/30 text-base text-danger inline-flex items-start gap-2 w-full">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>{completeError}</span>
        </div>
      )}

      <button
        type="button"
        disabled={!allRequiredAnswered || completing}
        onClick={handleComplete}
        className="w-full py-4 sm:py-5 rounded-lg text-lg font-semibold bg-accent text-text-on-accent hover:bg-accent-hover transition-base disabled:opacity-50 disabled:cursor-not-allowed min-h-[56px] inline-flex items-center justify-center gap-2"
      >
        {completing
          ? 'Firmando…'
          : allRequiredAnswered
            ? <><Check size={20} /> Completar y firmar checklist</>
            : `Completa los ${missingRequired.length} obligatorios pendientes`}
      </button>

      <p className="text-sm text-text-secondary mt-3 text-center">
        Al firmar quedará registrada tu identidad y la hora exacta. Firma electrónica simple según eIDAS UE 910/2014.
      </p>
    </div>
  )
}
