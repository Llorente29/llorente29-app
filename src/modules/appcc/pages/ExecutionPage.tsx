// src/modules/appcc/pages/ExecutionPage.tsx
// Pantalla de ejecución de un checklist APPCC.
// El usuario rellena los items, se auto-guarda cada respuesta (con debounce),
// y al final firma para completar la ejecución.

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import * as executionsService from '@/modules/appcc/services/executionsService'
import * as templatesService from '@/modules/appcc/services/templatesService'
import FieldRenderer, { type FieldValue } from '@/modules/appcc/components/FieldRenderer'
import type {
  AppccExecution,
  AppccExecutionResponse,
  AppccTemplateWithItems,
} from '@/modules/appcc/types'

const GRANATE = '#7C1A1A'
const BEIGE = '#F5E9D9'

interface ExecutionPageProps {
  executionId: string
  onBack: () => void
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export default function ExecutionPage({ executionId, onBack }: ExecutionPageProps) {
  const [execution, setExecution] = useState<AppccExecution | null>(null)
  const [template, setTemplate] = useState<AppccTemplateWithItems | null>(null)
  const [responses, setResponses] = useState<Map<string, AppccExecutionResponse>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<Map<string, SaveStatus>>(new Map())
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)

  const saveTimers = useRef<Map<string, number>>(new Map())

  // Carga inicial
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)

        if (!supabase) throw new Error('Supabase no disponible')
        const { data: userData } = await supabase.auth.getUser()
        if (!userData.user) throw new Error('No hay sesión activa')

        const execData = await executionsService.getExecution(executionId)
        if (!execData) throw new Error('Ejecución no encontrada')

        const tplData = await templatesService.getTemplateWithItems(execData.execution.template_id)
        if (!tplData) throw new Error('Plantilla no encontrada')

        const respMap = new Map<string, AppccExecutionResponse>()
        execData.responses.forEach(r => respMap.set(r.item_id, r))

        let finalExecution = execData.execution
        // Solo pasar a in_progress si está en pending (no si ya está completed)
        if (execData.execution.status === 'pending') {
          finalExecution = await executionsService.startExecution(executionId, userData.user.id)
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

  // Limpiar timers al desmontar
  useEffect(() => {
    return () => {
      saveTimers.current.forEach(t => window.clearTimeout(t))
      saveTimers.current.clear()
    }
  }, [])

  function handleChange(itemId: string, fieldType: string, next: FieldValue) {
    if (!userId) return
    if (execution?.status === 'completed') return // read-only si ya completado

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

  // Lista de items obligatorios sin respuesta
  const missingRequired = useMemo(() => {
    if (!template) return []
    return template.items
      .filter(i => i.is_required)
      .filter(i => {
        const r = responses.get(i.id)
        if (!r) return true
        // Considerar respondido si hay algún valor (cualquiera de los tipos)
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
    if (!userId || !execution || !template) return
    if (missingRequired.length > 0) return // botón debería estar deshabilitado, pero por si acaso

    // Confirmación: si hay fuera de rango, avisar pero permitir continuar
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

  // === ESTADOS DE LA UI ===

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="py-12 text-center text-gray-500">Cargando checklist...</div>
      </div>
    )
  }

  if (error || !execution || !template) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button
          type="button"
          onClick={onBack}
          className="text-sm mb-4 text-gray-500 hover:text-gray-700"
        >
          ← Volver
        </button>
        <div className="py-4 px-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
          {error ?? 'No se pudo cargar la ejecución.'}
        </div>
      </div>
    )
  }

  // === VISTA DE ÉXITO (después de completar) ===
  if (execution.status === 'completed') {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div
          className="rounded-2xl p-8 text-center border"
          style={{ backgroundColor: BEIGE, borderColor: GRANATE }}
        >
          <div className="text-6xl mb-3">✓</div>
          <h1
            className="text-3xl mb-2"
            style={{ fontFamily: '"Instrument Serif", serif', color: GRANATE }}
          >
            Checklist completado y firmado
          </h1>
          <p className="text-sm text-gray-700 mb-4">{template.name}</p>

          {execution.has_failures && execution.failure_count > 0 ? (
            <div
              className="inline-block px-4 py-2 rounded-lg mb-6 text-sm"
              style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24' }}
            >
              ⚠️ {execution.failure_count} incidencia{execution.failure_count > 1 ? 's' : ''} abierta{execution.failure_count > 1 ? 's' : ''} pendiente{execution.failure_count > 1 ? 's' : ''} de gestión
            </div>
          ) : (
            <div
              className="inline-block px-4 py-2 rounded-lg mb-6 text-sm"
              style={{ backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #4ade80' }}
            >
              ✓ Sin incidencias
            </div>
          )}

          <div className="text-xs text-gray-500 mb-6">
            Firmado el {execution.completed_at ? new Date(execution.completed_at).toLocaleString('es-ES') : '—'}
          </div>

          <button
            type="button"
            onClick={onBack}
            className="px-6 py-3 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: GRANATE, color: BEIGE }}
          >
            Volver a Hoy
          </button>
        </div>

        {/* Resumen read-only abajo */}
        <details className="mt-6">
          <summary className="text-sm text-gray-500 cursor-pointer">Ver respuestas registradas</summary>
          <div className="mt-3 space-y-2">
            {template.items.map(item => {
              const r = responses.get(item.id)
              return (
                <div key={item.id} className="p-3 bg-white rounded-lg border border-gray-200 text-sm">
                  <div className="font-medium">{item.label}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {r?.numeric_value !== null && r?.numeric_value !== undefined && `${r.numeric_value} ${item.numeric_unit ?? ''}`}
                    {r?.boolean_value === true && '✓ Sí'}
                    {r?.boolean_value === false && '✗ No'}
                    {r?.text_value && r.text_value}
                    {r?.date_value && r.date_value}
                    {!r && <span className="italic">Sin respuesta</span>}
                    {r?.is_out_of_range && <span className="text-red-600 ml-2">⚠️ Fuera de rango</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </details>
      </div>
    )
  }

  // === VISTA DE EJECUCIÓN (rellenando) ===

  const totalRequired = template.items.filter(i => i.is_required).length
  const answeredRequired = totalRequired - missingRequired.length
  const progressPct = totalRequired === 0
    ? 100
    : Math.round((answeredRequired / totalRequired) * 100)

  const allRequiredAnswered = missingRequired.length === 0

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button
        type="button"
        onClick={onBack}
        className="text-sm mb-4 text-gray-500 hover:text-gray-700"
      >
        ← Volver a Hoy
      </button>

      <header className="mb-6">
        <div className="text-sm text-gray-500 mb-1">{template.plan.name}</div>
        <h1
          className="text-3xl mb-2"
          style={{ fontFamily: '"Instrument Serif", serif', color: GRANATE }}
        >
          {template.name}
        </h1>
        {template.description && (
          <p className="text-sm text-gray-600">{template.description}</p>
        )}
      </header>

      <div className="mb-6 p-4 rounded-lg" style={{ backgroundColor: BEIGE }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: GRANATE }}>
            Progreso
          </span>
          <span className="text-xs font-medium" style={{ color: GRANATE }}>
            {answeredRequired} / {totalRequired} obligatorios ({progressPct}%)
          </span>
        </div>
        <div className="h-2 bg-white rounded-full overflow-hidden">
          <div
            className="h-full transition-all"
            style={{ width: `${progressPct}%`, backgroundColor: GRANATE }}
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
              className="p-4 bg-white rounded-lg border border-gray-200"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="text-lg shrink-0 mt-0.5">{answered ? '✓' : '○'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {item.label}
                      {item.is_required && <span className="text-red-500 ml-1">*</span>}
                    </div>
                    {item.help_text && (
                      <div className="text-xs text-gray-500 mt-0.5">{item.help_text}</div>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-xs">
                  {status === 'saving' && <span className="text-gray-400">Guardando…</span>}
                  {status === 'saved' && <span className="text-green-600">✓ Guardado</span>}
                  {status === 'error' && <span className="text-red-600">⚠ Error</span>}
                </div>
              </div>

              <FieldRenderer
                item={item}
                value={respValue}
                onChange={(v) => handleChange(item.id, item.field_type, v)}
                disabled={completing}
                warning={warning}
              />
            </div>
          )
        })}
      </section>

      {/* Estado y botón de completar */}
      {!allRequiredAnswered && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          ⚠️ Faltan {missingRequired.length} respuesta{missingRequired.length > 1 ? 's' : ''} obligatoria{missingRequired.length > 1 ? 's' : ''} por rellenar.
        </div>
      )}

      {completeError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {completeError}
        </div>
      )}

      <button
        type="button"
        disabled={!allRequiredAnswered || completing}
        onClick={handleComplete}
        className="w-full py-4 rounded-xl text-base font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: GRANATE,
          color: BEIGE,
        }}
      >
        {completing
          ? 'Firmando…'
          : allRequiredAnswered
            ? '✓ Completar y firmar checklist'
            : `Completa los ${missingRequired.length} obligatorios pendientes`}
      </button>

      <p className="text-xs text-gray-500 mt-3 text-center">
        Al firmar quedará registrada tu identidad y la hora exacta. Firma electrónica simple según eIDAS UE 910/2014.
      </p>
    </div>
  )
}