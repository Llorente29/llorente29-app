// src/modules/kitchen/components/FamilyReviewPanel.tsx
//
// Panel de revisión y aprobación de las familias que la IA propuso para los
// ingredientes (paso 3c). Modal a pantalla casi completa (mismo lenguaje visual
// que el modal de alta de KitchenItemsPage).
//
// Flujo "IA propone -> humano aprueba":
//   - Carga las propuestas (mapping_proposal recipe_item->recipe_family) vía
//     ingredientFamilyService. Las needs_review se muestran arriba (son las que
//     piden ojo); las auto_confirmed debajo (alta confianza).
//   - Cada fila: ingrediente + selector de familia (precargado con la propuesta,
//     corregible entre las 15 + "Sin clasificar") + confianza.
//   - "Aplicar las N seguras" aprueba en bloque las auto_confirmed.
//   - Aprobar (individual o en bloque) escribe recipe_item.family_id y marca la
//     propuesta. Al terminar, onApplied() refresca la página.

import { useEffect, useMemo, useState } from 'react'
import { X, AlertTriangle, Check, Sparkles } from 'lucide-react'
import {
  listIngredientFamilies,
  listFamilyProposals,
  approveFamilyProposal,
  approveAllAuto,
  type IngredientFamily,
  type FamilyProposal,
} from '@/modules/kitchen/services/ingredientFamilyService'

const NO_FAMILY = '__none__'  // valor del selector para "sin clasificar"

function confLabel(conf: number | null): string {
  if (conf === null || conf === undefined) return '—'
  return `${Math.round(conf * 100)}%`
}

export default function FamilyReviewPanel({
  accountId,
  onClose,
  onApplied,
}: {
  accountId: string
  onClose: () => void
  onApplied: () => void
}) {
  const [families, setFamilies] = useState<IngredientFamily[]>([])
  const [proposals, setProposals] = useState<FamilyProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Selección de familia por propuesta (corregible). Clave = proposalId.
  const [choice, setChoice] = useState<Record<string, string>>({})
  // Filas ya aplicadas en esta sesión (para marcarlas y no repetir).
  const [done, setDone] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)  // proposalId en curso, o 'all'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([listIngredientFamilies(accountId), listFamilyProposals(accountId)])
      .then(([fams, props]) => {
        if (cancelled) return
        setFamilies(fams)
        setProposals(props)
        // Precargar cada selector con la familia propuesta (o "sin clasificar").
        const init: Record<string, string> = {}
        props.forEach(p => { init[p.proposalId] = p.proposedFamilyId ?? NO_FAMILY })
        setChoice(init)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando propuestas')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId])

  // needs_review primero (las que piden ojo), luego auto_confirmed, luego el resto.
  const ordered = useMemo(() => {
    const rank = (s: string) => (s === 'needs_review' ? 0 : s === 'auto_confirmed' ? 1 : 2)
    return [...proposals].sort((a, b) => rank(a.status) - rank(b.status))
  }, [proposals])

  const pending = ordered.filter(p => !done.has(p.proposalId))
  const autoCount = pending.filter(p => p.status === 'auto_confirmed').length
  const reviewCount = pending.filter(p => p.status === 'needs_review').length

  async function applyOne(p: FamilyProposal) {
    const sel = choice[p.proposalId] ?? NO_FAMILY
    const familyId = sel === NO_FAMILY ? null : sel
    setBusy(p.proposalId)
    setError(null)
    try {
      await approveFamilyProposal(p.proposalId, p.itemId, familyId)
      setDone(prev => new Set(prev).add(p.proposalId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error aplicando la familia')
    } finally {
      setBusy(null)
    }
  }

  async function applyAllAuto() {
    setBusy('all')
    setError(null)
    try {
      await approveAllAuto(accountId)
      // Marcar como hechas todas las auto_confirmed pendientes en la vista.
      setDone(prev => {
        const next = new Set(prev)
        pending.filter(p => p.status === 'auto_confirmed').forEach(p => next.add(p.proposalId))
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error aplicando en bloque')
    } finally {
      setBusy(null)
    }
  }

  function handleClose() {
    // Si se aplicó algo, avisar a la página para que refresque lista + banner.
    if (done.size > 0) onApplied()
    else onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="family-review-title"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={handleClose}
    >
      <div
        className="bg-card w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-accent" />
            <h3 id="family-review-title" className="text-base font-medium text-text-primary">
              Revisar familias propuestas
            </h3>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={handleClose}
            className="text-text-secondary hover:text-text-primary transition-base"
          >
            <X size={18} />
          </button>
        </div>

        {/* Barra de acción en bloque */}
        {!loading && !error && pending.length > 0 && (
          <div className="px-4 py-3 border-b border-border-default bg-page flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-text-secondary">
              {reviewCount > 0 && (
                <span className="text-warning font-medium">{reviewCount} para revisar</span>
              )}
              {reviewCount > 0 && autoCount > 0 && <span> · </span>}
              {autoCount > 0 && <span>{autoCount} con alta confianza</span>}
            </p>
            {autoCount > 0 && (
              <button
                type="button"
                onClick={applyAllAuto}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base"
              >
                <Check size={15} />
                {busy === 'all' ? 'Aplicando…' : `Aplicar las ${autoCount} seguras`}
              </button>
            )}
          </div>
        )}

        {/* Cuerpo */}
        <div className="px-4 py-3 overflow-y-auto space-y-2">
          {loading && (
            <p className="py-8 text-center text-sm text-text-secondary">Cargando propuestas…</p>
          )}
          {!loading && error && (
            <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
              {error}
            </div>
          )}
          {!loading && !error && pending.length === 0 && (
            <div className="py-8 text-center">
              <Check size={28} className="mx-auto text-success mb-2" />
              <p className="text-sm text-text-secondary">
                No quedan propuestas por revisar. Todo clasificado.
              </p>
            </div>
          )}

          {!loading && !error && pending.map(p => (
            <ProposalRow
              key={p.proposalId}
              proposal={p}
              families={families}
              value={choice[p.proposalId] ?? NO_FAMILY}
              busy={busy === p.proposalId}
              disabled={busy !== null}
              onChange={(v) => setChoice(prev => ({ ...prev, [p.proposalId]: v }))}
              onApply={() => applyOne(p)}
            />
          ))}
        </div>

        {/* Pie */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={handleClose}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base"
          >
            {done.size > 0 ? 'Cerrar y refrescar' : 'Cerrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Una fila de propuesta ──
function ProposalRow({
  proposal,
  families,
  value,
  busy,
  disabled,
  onChange,
  onApply,
}: {
  proposal: FamilyProposal
  families: IngredientFamily[]
  value: string
  busy: boolean
  disabled: boolean
  onChange: (v: string) => void
  onApply: () => void
}) {
  const isReview = proposal.status === 'needs_review'
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border-default bg-card flex-wrap sm:flex-nowrap">
      {/* Ingrediente + estado */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-text-primary break-words">{proposal.itemName}</span>
          {isReview ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning-bg text-warning inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              revisar
            </span>
          ) : (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent-bg text-accent">
              {confLabel(proposal.confidence)}
            </span>
          )}
        </div>
        {proposal.rationale && (
          <p className="text-[11px] text-text-secondary mt-0.5 truncate">{proposal.rationale}</p>
        )}
      </div>

      {/* Selector de familia (corregible) */}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 max-w-[12rem]"
      >
        <option value={NO_FAMILY}>Sin clasificar</option>
        {families.map(f => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>

      {/* Aplicar */}
      <button
        type="button"
        onClick={onApply}
        disabled={disabled}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm font-medium border border-accent text-accent hover:bg-accent-bg disabled:opacity-50 transition-base"
      >
        <Check size={15} />
        {busy ? '…' : 'Aplicar'}
      </button>
    </div>
  )
}
