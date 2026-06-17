// src/modules/supply/components/ItemPeekPanel.tsx
//
// AL1 — Vista rápida (peek) de un artículo, panel lateral derecho.
// Al pinchar una fila se abre sin salir de Zonas. Muestra:
//   - "En stock ahora": la cantidad desglosada por cada formato del artículo.
//   - "Calculadora": convierte una cantidad entre formatos y unidad base.
//   - "Ver ficha completa" → salta a KitchenItemDetailPage (embebida en InventoryPage).
//
// El árbol de formatos se carga bajo demanda (listFormatsByItem), no viaja en
// las RPC de la lista. Si el artículo no tiene formatos, solo se ve la base.

import { useEffect, useMemo, useState } from 'react'
import { X, ExternalLink, Package, Calculator, Loader2 } from 'lucide-react'
import { listFormatsByItem } from '@/modules/kitchen/services/purchaseFormatService'
import type { PurchaseFormat } from '@/types/kitchen'

export interface PeekItem {
  recipeItemId: string
  name: string
  valueEur?: number | null
  qty?: number | null
  unitAbbr?: string | null
  familyName?: string | null
}

const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
}

export default function ItemPeekPanel({
  item,
  onOpenFull,
  onClose,
}: {
  item: PeekItem
  onOpenFull: (recipeItemId: string) => void
  onClose: () => void
}) {
  const [formats, setFormats] = useState<PurchaseFormat[]>([])
  const [loading, setLoading] = useState(true)

  // calculadora: cantidad + unidad de origen ('base' o id de formato)
  const [calcQty, setCalcQty] = useState('1')
  const [calcUnit, setCalcUnit] = useState<string>('base')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listFormatsByItem(item.recipeItemId)
      .then(fs => { if (!cancelled) setFormats(fs.filter(f => f.qtyInBase > 0)) })
      .catch(() => { if (!cancelled) setFormats([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [item.recipeItemId])

  // formatos de mayor a menor contenido (caja → bolsa → …)
  const sorted = useMemo(
    () => [...formats].sort((a, b) => b.qtyInBase - a.qtyInBase),
    [formats],
  )
  const unit = item.unitAbbr ?? ''
  const qtyBase = Number(item.qty)
  const hasStock = Number.isFinite(qtyBase) && qtyBase > 0

  // base resultante de la calculadora
  const calcBase = useMemo(() => {
    const n = Number(calcQty.replace(',', '.'))
    if (!Number.isFinite(n)) return null
    if (calcUnit === 'base') return n
    const f = formats.find(x => x.id === calcUnit)
    return f ? n * f.qtyInBase : null
  }, [calcQty, calcUnit, formats])

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-sm h-full bg-card border-l border-border-default shadow-lg flex flex-col">
        <div className="px-5 py-3 border-b border-border-default flex items-center justify-between">
          <h3 className="text-base font-medium text-text-primary truncate pr-2">{item.name}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-tertiary hover:text-text-primary shrink-0"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-5 overflow-y-auto flex-1">
          {item.familyName && (
            <div>
              <span className="block text-[11px] uppercase tracking-wide text-text-tertiary">Familia</span>
              <span className="text-sm text-text-primary">{item.familyName}</span>
            </div>
          )}

          {/* En stock ahora */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] uppercase tracking-wide text-text-tertiary">En stock ahora</span>
              <span className="text-[11px] text-text-tertiary">{fmtEur(item.valueEur)}</span>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-text-secondary text-sm py-2"><Loader2 size={14} className="animate-spin" /> Cargando formatos…</div>
            ) : !hasStock ? (
              <p className="text-sm text-text-tertiary">Sin contar todavía.</p>
            ) : (
              <div className="space-y-1">
                {sorted.filter(f => f.qtyInBase > 1).map(f => (
                  <div key={f.id} className="flex justify-between text-sm">
                    <span className="text-text-secondary">{f.name} <span className="text-text-tertiary">({nf2.format(f.qtyInBase)} {unit})</span></span>
                    <span className="tabular-nums">≈ {nf1.format(qtyBase / f.qtyInBase)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm pt-1 border-t border-border-default">
                  <span className="text-text-secondary">Base</span>
                  <span className="tabular-nums font-medium">{nf2.format(qtyBase)} {unit}</span>
                </div>
              </div>
            )}
          </div>

          {/* Calculadora de formatos */}
          {!loading && sorted.some(f => f.qtyInBase > 1) && (
            <div>
              <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-tertiary mb-1.5">
                <Calculator size={13} /> Calculadora
              </span>
              <div className="flex items-center gap-2">
                <input type="text" inputMode="decimal" value={calcQty} onChange={e => setCalcQty(e.target.value)}
                  className="w-20 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary" />
                <select value={calcUnit} onChange={e => setCalcUnit(e.target.value)}
                  className="flex-1 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary">
                  {sorted.filter(f => f.qtyInBase > 1).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  <option value="base">{unit || 'base'}</option>
                </select>
              </div>
              {calcBase != null && (
                <div className="mt-2 text-sm text-text-secondary">
                  = <span className="text-text-primary font-medium tabular-nums">{nf2.format(calcBase)} {unit}</span>
                  {sorted.filter(f => f.qtyInBase > 1 && f.id !== calcUnit).map(f => (
                    <span key={f.id} className="text-text-tertiary"> · {nf1.format(calcBase / f.qtyInBase)} {f.name.toLowerCase()}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-text-tertiary flex items-center gap-1.5">
            <Package size={13} /> La ficha completa tiene coste, proveedores, alérgenos y más.
          </p>
        </div>

        <div className="px-5 py-3 border-t border-border-default">
          <button type="button" onClick={() => onOpenFull(item.recipeItemId)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base">
            <ExternalLink size={15} /> Ver ficha completa
          </button>
        </div>
      </div>
    </div>
  )
}
