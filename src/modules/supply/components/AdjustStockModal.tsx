// src/modules/supply/components/AdjustStockModal.tsx
//
// AL1 — Ajuste de stock con motivo.
// El usuario FIJA el conteo real (en formato de compra o unidad base); Folvy
// calcula la diferencia contra el saldo actual y la registra como movimiento
// 'ajuste' con un motivo OBLIGATORIO. Mecánica espejo de la merma.
//
// El stock es por LOCAL: este modal se abre desde el peek de Zonas, que ya
// trabaja sobre un local concreto. No hay selector de local (sería error en cocina).

import { useEffect, useMemo, useState } from 'react'
import { X, ArrowUp, ArrowDown, Loader2, Check } from 'lucide-react'
import { listFormatsByItem } from '@/modules/kitchen/services/purchaseFormatService'
import type { PurchaseFormat } from '@/types/kitchen'
import {
  registerAdjustment, ADJUST_REASONS, type AdjustmentResult,
} from '@/modules/supply/services/stockAdjustmentService'

const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

export interface AdjustStockTarget {
  recipeItemId: string
  name: string
  currentQtyBase: number   // saldo actual en unidad base
  unitAbbr: string | null
}

export default function AdjustStockModal({
  accountId, locationId, actorId, actorName, target, onClose, onDone,
}: {
  accountId: string
  locationId: string
  actorId: string | null
  actorName: string | null
  target: AdjustStockTarget
  onClose: () => void
  onDone: (r: AdjustmentResult) => void
}) {
  const [formats, setFormats] = useState<PurchaseFormat[]>([])
  const [loading, setLoading] = useState(true)
  const [countInput, setCountInput] = useState('')
  const [unitSel, setUnitSel] = useState<string>('base')   // 'base' | format.id
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unit = target.unitAbbr ?? ''

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listFormatsByItem(target.recipeItemId)
      .then(fs => {
        if (cancelled) return
        const usable = fs.filter(f => f.qtyInBase > 1)
        setFormats(usable)
        // Arranca en el formato de compra de referencia (mayor contenido),
        // que es como cuenta el cocinero; si no hay formatos, queda en base.
        if (usable.length > 0) {
          const ref = usable.reduce((a, b) => (b.qtyInBase > a.qtyInBase ? b : a))
          setUnitSel(ref.id)
        }
      })
      .catch(() => { if (!cancelled) setFormats([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [target.recipeItemId])

  const selFormat = useMemo(
    () => (unitSel === 'base' ? null : formats.find(f => f.id === unitSel) ?? null),
    [unitSel, formats],
  )

  // conteo real → unidad base
  const countedBase = useMemo(() => {
    const n = Number(countInput.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return null
    return selFormat ? n * selFormat.qtyInBase : n
  }, [countInput, selFormat])

  const delta = countedBase == null ? null : countedBase - target.currentQtyBase
  const canSave = countedBase != null && reason.length > 0 && !saving

  const curMain = selFormat
    ? `≈ ${nf1.format(target.currentQtyBase / selFormat.qtyInBase)} ${selFormat.name}`
    : `${nf2.format(target.currentQtyBase)} ${unit}`

  async function submit() {
    if (countedBase == null || reason.length === 0) return
    setSaving(true); setError(null)
    try {
      const r = await registerAdjustment({
        accountId, locationId, recipeItemId: target.recipeItemId,
        reasonCode: reason, countedBase,
        useUnitLabel: selFormat ? selFormat.name : null,
        useUnitFactor: selFormat ? selFormat.qtyInBase : null,
        useQty: selFormat ? Number(countInput.replace(',', '.')) : null,
        notes: notes.trim() || null,
        actorId, actorName,
      })
      onDone(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al registrar el ajuste')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md bg-card rounded-lg border border-border-default shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <span className="font-medium text-text-primary truncate pr-2">Ajustar stock · {target.name}</span>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-tertiary hover:text-text-primary shrink-0"><X size={18} /></button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <div className="flex justify-between text-[13px] text-text-secondary">
            <span>El sistema cree que hay</span>
            <span className="tabular-nums">{curMain}{selFormat ? ` · ${nf2.format(target.currentQtyBase)} ${unit}` : ''}</span>
          </div>

          <div>
            <div className="text-xs text-text-tertiary mb-1.5">Cantidad real contada</div>
            <div className="flex gap-2">
              <input type="text" inputMode="decimal" value={countInput} onChange={e => setCountInput(e.target.value)}
                placeholder="0" className="w-24 px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary" />
              <select value={unitSel} onChange={e => setUnitSel(e.target.value)} disabled={loading}
                className="flex-1 px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary">
                {formats.map(f => <option key={f.id} value={f.id}>{f.name} ({nf2.format(f.qtyInBase)} {unit})</option>)}
                <option value="base">{unit || 'unidad base'}</option>
              </select>
            </div>
            {delta != null && delta !== 0 && (
              <div className={`flex items-center gap-1.5 text-[13px] mt-2 ${delta < 0 ? 'text-warning' : 'text-success'}`}>
                {delta < 0 ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
                Ajuste de {delta > 0 ? '+' : ''}{nf2.format(delta)} {unit}
                {' '}({delta < 0 ? 'faltan' : 'sobran'} {nf2.format(Math.abs(delta))} {unit})
              </div>
            )}
            {delta === 0 && (
              <div className="text-[13px] text-text-tertiary mt-2">Coincide con el saldo actual — no se registrará movimiento.</div>
            )}
          </div>

          <div>
            <div className="text-xs text-text-tertiary mb-1.5">Motivo del ajuste</div>
            <div className="flex flex-wrap gap-1.5">
              {ADJUST_REASONS.map(r => {
                const on = reason === r.code
                return (
                  <button key={r.code} type="button" onClick={() => setReason(r.code)}
                    className={`text-[13px] rounded-md px-2.5 py-1 border transition-base ${on ? 'border-accent bg-accent/10 text-accent' : 'border-border-default text-text-secondary hover:text-text-primary'}`}>
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="text-xs text-text-tertiary mb-1.5">Nota (opcional)</div>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Detalle, lote, quién…" className="w-full px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary" />
          </div>

          {error && <div className="text-[13px] text-danger">{error}</div>}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border-default">
          <span className="text-xs text-text-tertiary">Queda registrado con fecha y autor</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-[13px] px-3 py-1.5 rounded-md border border-border-default text-text-secondary hover:text-text-primary">Cancelar</button>
            <button type="button" onClick={submit} disabled={!canSave}
              className="text-[13px] px-3 py-1.5 rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Registrar ajuste
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
