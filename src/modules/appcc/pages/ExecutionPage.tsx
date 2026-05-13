// src/modules/appcc/pages/ExecutionPage.tsx
// Pantalla de ejecución de un checklist APPCC.
// El usuario rellena los items, se auto-guarda cada respuesta,
// y al final firma para completar la ejecución.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import * as executionsService from '@/modules/appcc/services/executionsService'
import * as templatesService from '@/modules/appcc/services/templatesService'
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

export default function ExecutionPage({ executionId, onBack }: ExecutionPageProps) {
  const [execution, setExecution] = useState<AppccExecution | null>(null)
  const [template, setTemplate] = useState<AppccTemplateWithItems | null>(null)
  const [responses, setResponses] = useState<Map<string, AppccExecutionResponse>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  // Carga inicial: execution + template + respuestas existentes + user_id
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)

        // 1. Obtener usuario actual
        if (!supabase) throw new Error('Supabase no disponible')
        const { data: userData } = await supabase.auth.getUser()
        if (!userData.user) throw new Error('No hay sesión activa')

        // 2. Cargar execution + responses ya guardadas
        const execData = await executionsService.getExecution(executionId)
        if (!execData) throw new Error('Ejecución no encontrada')

        // 3. Cargar template completo con items y opciones
        const tplData = await templatesService.getTemplateWithItems(execData.execution.template_id)
        if (!tplData) throw new Error('Plantilla no encontrada')

        // 4. Construir mapa de respuestas por item_id
        const respMap = new Map<string, AppccExecutionResponse>()
        execData.responses.forEach(r => respMap.set(r.item_id, r))

        // 5. Si la execution está en 'pending', marcarla en 'in_progress'
        let finalExecution = execData.execution
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

  // Loading
  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="py-12 text-center text-gray-500">Cargando checklist...</div>
      </div>
    )
  }

  // Error
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

  // Resumen de progreso
  const totalRequired = template.items.filter(i => i.is_required).length
  const answeredRequired = template.items
    .filter(i => i.is_required)
    .filter(i => responses.has(i.id))
    .length
  const progressPct = totalRequired === 0
    ? 0
    : Math.round((answeredRequired / totalRequired) * 100)

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Botón volver */}
      <button
        type="button"
        onClick={onBack}
        className="text-sm mb-4 text-gray-500 hover:text-gray-700"
      >
        ← Volver a Hoy
      </button>

      {/* Cabecera */}
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

      {/* Barra de progreso */}
      <div
        className="mb-6 p-4 rounded-lg"
        style={{ backgroundColor: BEIGE }}
      >
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

      {/* Items: por ahora solo lista, sin inputs (vienen en paso 3) */}
      <section className="space-y-2 mb-6">
        {template.items.map(item => {
          const resp = responses.get(item.id)
          const answered = resp !== undefined
          return (
            <div
              key={item.id}
              className="p-3 bg-white rounded-lg border border-gray-200 flex items-center gap-3"
            >
              <span className="text-lg">{answered ? '✓' : '○'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  {item.label}
                  {item.is_required && <span className="text-red-500 ml-1">*</span>}
                </div>
                <div className="text-xs text-gray-500">
                  {item.field_type}
                  {item.numeric_min !== null && item.numeric_max !== null &&
                    ` · rango ${item.numeric_min} a ${item.numeric_max} ${item.numeric_unit ?? ''}`}
                  {item.incident_severity && ` · severidad ${item.incident_severity}`}
                </div>
              </div>
            </div>
          )
        })}
      </section>

      {/* Placeholder para botones finales (paso 5) */}
      <div className="text-xs text-gray-400 italic">
        userId: {userId?.slice(0, 8) ?? '—'} · executionId: {executionId.slice(0, 8)}
        <br />
        (Los inputs se añadirán en el siguiente paso. Los botones de completar también.)
      </div>
    </div>
  )
}