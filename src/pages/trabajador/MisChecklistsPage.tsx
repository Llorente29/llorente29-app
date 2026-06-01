// src/pages/trabajador/MisChecklistsPage.tsx
// Vista APPCC del trabajador: muestra los checklists del día para su local.
// Por ahora muestra todos los del local; en Sprint 3c se filtrará por asignación.

import { useEffect, useState } from 'react'
import { ArrowLeft, Leaf, Check, Clock, AlertTriangle, ChevronRight } from 'lucide-react'
import type { Employee } from '../../types'
import { supabase } from '../../lib/supabase'
import type { AppccExecution } from '../../modules/appcc/types'

interface Props {
  employee: Employee
  onBack?: () => void
  onOpenExecution: (executionId: string) => void
}

interface ChecklistItem {
  execution: AppccExecution
  templateName: string
  planName: string
  scheduledTime: string | null
}

export default function MisChecklistsPage({ employee, onBack, onOpenExecution }: Props) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase || !employee.locationId) return
    let cancel = false

    async function load() {
      setLoading(true)
      try {
        const today = new Date().toISOString().slice(0, 10)

        // Obtener executions del día para este local
        const { data: rawExecutions, error: execErr } = await supabase!
          .from('appcc_executions')
          .select('*')
          .eq('location_id', employee.locationId)
          .eq('scheduled_date', today)
          .in('status', ['pending', 'in_progress', 'completed'])
          .order('scheduled_time', { ascending: true, nullsFirst: false })

        if (execErr) throw execErr
        if (!rawExecutions || rawExecutions.length === 0) {
          if (!cancel) { setItems([]); setLoading(false) }
          return
        }

        // FIX: cast a AppccExecution[] al bloque entero (BBDD devuelve status como
        // string genérico, no como union literal AppccExecutionStatus).
        // Esto permite que los callbacks subsiguientes infieran el tipo correcto.
        const allExecutions = rawExecutions as unknown as AppccExecution[]

        // Filtrar: solo los asignados a este empleado O los sin asignar
        const executions = allExecutions.filter(e =>
          e.assigned_to === employee.id || e.assigned_to === null
        )

        // Obtener templates para nombres
        const templateIds = [...new Set(executions.map(e => e.template_id))]
        const { data: templates } = await supabase!
          .from('appcc_templates')
          .select('id, name, plan_id')
          .in('id', templateIds)

        // Obtener plans para nombres
        const planIds = [...new Set((templates ?? []).map((t: { plan_id: string }) => t.plan_id))]
        const { data: plans } = await supabase!
          .from('appcc_plans')
          .select('id, name')
          .in('id', planIds)

        const tplMap = new Map((templates ?? []).map((t: { id: string; name: string; plan_id: string }) => [t.id, t]))
        const planMap = new Map((plans ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))

        const result: ChecklistItem[] = executions.map(e => {
          const tpl = tplMap.get(e.template_id)
          return {
            execution: e,
            templateName: tpl?.name ?? 'Checklist',
            planName: tpl ? (planMap.get(tpl.plan_id) ?? '') : '',
            scheduledTime: e.scheduled_time,
          }
        })

        if (!cancel) setItems(result)
      } catch (err) {
        console.error('[MisChecklistsPage] load error', err)
      } finally {
        if (!cancel) setLoading(false)
      }
    }

    load()
    return () => { cancel = true }
  }, [employee.locationId, employee.id])

  const pending = items.filter(i => i.execution.status === 'pending' || i.execution.status === 'in_progress')
  const completed = items.filter(i => i.execution.status === 'completed')

  function statusIcon(status: string) {
    switch (status) {
      case 'completed': return <Check size={18} className="text-success" />
      case 'in_progress': return <Clock size={18} className="text-warning" />
      default: return <Clock size={18} className="text-text-secondary" />
    }
  }

  function statusLabel(status: string) {
    switch (status) {
      case 'completed': return 'Completado'
      case 'in_progress': return 'En curso'
      default: return 'Pendiente'
    }
  }

  return (
    <div className="min-h-screen bg-page pb-8">
      {/* Header */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base"
              aria-label="Volver"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-secondary uppercase tracking-wide">APPCC</p>
            <p className="font-display text-xl text-accent">Controles de hoy</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
            <Leaf size={20} className="text-emerald-600" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="px-4">
          <div className="bg-card border border-border-default rounded-xl p-8 text-center">
            <p className="text-sm text-text-secondary">Cargando controles...</p>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="px-4">
          <div className="bg-card border border-border-default rounded-xl p-8 text-center">
            <div className="flex justify-center mb-3">
              <Check size={48} className="text-success" />
            </div>
            <p className="font-semibold text-text-primary">Sin controles para hoy</p>
            <p className="text-xs text-text-secondary mt-1">No hay checklists APPCC programados para tu local hoy</p>
          </div>
        </div>
      ) : (
        <div className="px-4 space-y-4">
          {/* Pendientes */}
          {pending.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 px-1">
                Pendientes ({pending.length})
              </p>
              <div className="space-y-2">
                {pending.map(item => (
                  <button
                    key={item.execution.id}
                    onClick={() => onOpenExecution(item.execution.id)}
                    className="w-full bg-card border-2 border-border-default hover:border-accent rounded-xl p-4 text-left transition-base active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-3">
                      {statusIcon(item.execution.status)}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-text-primary text-sm">{item.templateName}</p>
                        <p className="text-xs text-text-secondary mt-0.5">
                          {item.planName}
                          {item.scheduledTime && ` · ${item.scheduledTime.slice(0, 5)}`}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        item.execution.status === 'in_progress'
                          ? 'bg-warning-bg text-warning'
                          : 'bg-page text-text-secondary'
                      }`}>
                        {statusLabel(item.execution.status)}
                      </span>
                      <ChevronRight size={16} className="text-text-secondary" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Completados */}
          {completed.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 px-1">
                Completados ({completed.length})
              </p>
              <div className="space-y-2">
                {completed.map(item => (
                  <button
                    key={item.execution.id}
                    onClick={() => onOpenExecution(item.execution.id)}
                    className="w-full bg-card border border-border-default rounded-xl p-4 text-left transition-base active:scale-[0.98] opacity-70"
                  >
                    <div className="flex items-center gap-3">
                      <Check size={18} className="text-success" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-text-primary text-sm">{item.templateName}</p>
                        <p className="text-xs text-text-secondary mt-0.5">{item.planName}</p>
                      </div>
                      <span className="text-xs px-2 py-1 rounded-full bg-success-bg text-success font-medium">
                        Completado
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Resumen */}
          {pending.length === 0 && completed.length > 0 && (
            <div className="bg-success-bg border border-success/30 rounded-xl p-4 text-center">
              <div className="flex justify-center mb-2">
                <Check size={32} className="text-success" />
              </div>
              <p className="font-semibold text-success">¡Todo completado!</p>
              <p className="text-xs text-success/80 mt-1">Has completado todos los controles de hoy</p>
            </div>
          )}

          {pending.length > 0 && (
            <div className="flex items-center gap-2 px-1 text-xs text-text-secondary">
              <AlertTriangle size={12} />
              <span>Los controles pendientes deben completarse antes del fin del día</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
