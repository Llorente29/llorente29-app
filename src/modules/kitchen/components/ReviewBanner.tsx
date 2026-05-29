// src/modules/kitchen/components/ReviewBanner.tsx
//
// Banner de incidencia de revisión sobre un recipe_item.
// Dos variantes:
//   - warning ("Coste sospechoso"): hay reviewNotes (kind 'cost_suspect' u otro)
//     con diagnóstico contrastable (coste Folvy vs referencia, delta, muestras).
//   - danger suave ("Sin escandallo"): no hay reviewNotes y computedCost es null
//     → el plato no se puede costear porque no tiene escandallo cargado.
//
// Acción: "Descartar incidencia" abre un textarea inline para motivo. Al
// confirmar llama a dismissReview(id, motivo, actorId) y notifica a onDismissed.
//
// No renderiza nada si item.needsReview === false.

import { useState } from 'react'
import { AlertTriangle, AlertCircle, X } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { dismissReview } from '@/modules/kitchen/services/recipeItemService'
import type { RecipeItem } from '@/types/kitchen'

interface ReviewBannerProps {
  item: RecipeItem
  /** actorId opcional; si no se pasa, se toma de useApp().authUserId. */
  actorId?: string | null
  onDismissed?: () => void
}

function formatEur(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(1)}%`
}

export function ReviewBanner({ item, actorId, onDismissed }: ReviewBannerProps) {
  const { authUserId } = useApp()
  const resolvedActorId = actorId !== undefined ? actorId : authUserId

  const [dismissOpen, setDismissOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!item.needsReview) return null

  const hasReviewNotes = item.reviewNotes !== null && item.reviewNotes !== undefined
  const isMissingRecipe = !hasReviewNotes && item.computedCost === null

  // Si no hay reviewNotes ni se cumple el caso "sin escandallo", no hay nada
  // accionable que mostrar — evitamos un banner sin contenido.
  if (!hasReviewNotes && !isMissingRecipe) return null

  async function handleConfirmDismiss() {
    const trimmed = reason.trim()
    if (trimmed === '') {
      setError('Indica un motivo para descartar la incidencia.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await dismissReview(item.id, trimmed, resolvedActorId ?? null)
      setDismissOpen(false)
      setReason('')
      onDismissed?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
      setSubmitting(false)
      return
    }
    setSubmitting(false)
  }

  function handleCancelDismiss() {
    setDismissOpen(false)
    setReason('')
    setError(null)
  }

  if (isMissingRecipe) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger-bg p-4 text-sm text-danger">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">Sin escandallo</p>
            <p className="mt-1 text-text-secondary">
              Este plato no tiene escandallo cargado. Su coste no se puede calcular.
            </p>

            {!dismissOpen && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setDismissOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-danger/30 text-danger hover:bg-danger/10 transition-base"
                >
                  Descartar incidencia
                </button>
              </div>
            )}

            {dismissOpen && (
              <DismissForm
                reason={reason}
                onReasonChange={setReason}
                onConfirm={handleConfirmDismiss}
                onCancel={handleCancelDismiss}
                submitting={submitting}
                error={error}
                tone="danger"
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  // Warning variant — hasReviewNotes es true aquí.
  const notes = item.reviewNotes!

  return (
    <div className="rounded-md border border-warning/40 bg-warning-bg p-4 text-sm text-warning">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="font-medium">Coste sospechoso</p>
            {notes.diagnosedAt && (
              <span className="text-[11px] text-text-secondary">
                Diagnosticado {new Date(notes.diagnosedAt).toLocaleDateString('es-ES')}
              </span>
            )}
          </div>

          {notes.summary && (
            <p className="mt-1 text-text-secondary">{notes.summary}</p>
          )}

          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-text-secondary">Coste Folvy</dt>
              <dd className="tabular-nums text-text-primary">
                {formatEur(notes.costFolvy)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-text-secondary">
                Referencia
                {notes.referenceSource && (
                  <span className="ml-1 text-text-secondary/80">
                    ({notes.referenceSource})
                  </span>
                )}
              </dt>
              <dd className="tabular-nums text-text-primary">
                {formatEur(notes.costReference)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-text-secondary">Desviación</dt>
              <dd className="tabular-nums text-text-primary">
                {formatPct(notes.deltaPct)}
                {notes.deltaEur !== null && notes.deltaEur !== undefined && (
                  <span className="ml-1 text-text-secondary">
                    ({formatEur(notes.deltaEur)})
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-text-secondary">Muestras</dt>
              <dd className="tabular-nums text-text-primary">
                {notes.sampleCount ?? '—'}
              </dd>
            </div>
          </dl>

          {notes.locations && notes.locations.length > 0 && (
            <p className="mt-2 text-xs text-text-secondary">
              Centros: <span className="text-text-primary">{notes.locations.join(', ')}</span>
            </p>
          )}

          {!dismissOpen && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setDismissOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-warning/40 text-warning hover:bg-warning/10 transition-base"
              >
                Descartar incidencia
              </button>
            </div>
          )}

          {dismissOpen && (
            <DismissForm
              reason={reason}
              onReasonChange={setReason}
              onConfirm={handleConfirmDismiss}
              onCancel={handleCancelDismiss}
              submitting={submitting}
              error={error}
              tone="warning"
            />
          )}
        </div>
      </div>
    </div>
  )
}

interface DismissFormProps {
  reason: string
  onReasonChange: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
  submitting: boolean
  error: string | null
  tone: 'warning' | 'danger'
}

function DismissForm({
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  submitting,
  error,
  tone,
}: DismissFormProps) {
  const confirmClasses =
    tone === 'warning'
      ? 'bg-warning text-text-on-accent hover:opacity-90'
      : 'bg-danger text-text-on-accent hover:opacity-90'

  return (
    <div className="mt-3 space-y-2">
      <label className="block text-xs font-medium text-text-secondary">
        Motivo para descartar
      </label>
      <textarea
        value={reason}
        onChange={e => onReasonChange(e.target.value)}
        disabled={submitting}
        rows={2}
        placeholder="Ej: coste verificado con la última factura, todo correcto."
        className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
      />
      {error && (
        <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:bg-page transition-base disabled:opacity-50"
        >
          <X size={12} /> Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-base disabled:opacity-50 disabled:cursor-not-allowed ${confirmClasses}`}
        >
          {submitting ? 'Descartando...' : 'Confirmar descarte'}
        </button>
      </div>
    </div>
  )
}
