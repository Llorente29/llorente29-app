// src/modules/supply/components/ItemPeekPanel.tsx
//
// AL1 — Vista rápida (peek) de un artículo, en un panel lateral derecho.
// Al pinchar una fila (huérfano o artículo de una zona) se abre esto sin salir
// de la pantalla de zonas. "Ver ficha completa" salta a la ficha del ingrediente
// (KitchenItemDetailPage, embebida en InventoryPage) y "Atrás" vuelve aquí.

import { X, ExternalLink, Package } from 'lucide-react'

export interface PeekItem {
  recipeItemId: string
  name: string
  valueEur?: number | null
  qty?: number | null
  unitAbbr?: string | null
  familyName?: string | null
}

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
}
function fmtQty(v: number | null | undefined, unit?: string | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const n = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)
  return unit ? `${n} ${unit}` : n
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
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-sm h-full bg-card border-l border-border-default shadow-lg flex flex-col">
        <div className="px-5 py-3 border-b border-border-default flex items-center justify-between">
          <h3 className="text-base font-medium text-text-primary truncate pr-2">{item.name}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-tertiary hover:text-text-primary shrink-0"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {item.familyName && (
            <div>
              <span className="block text-[11px] uppercase tracking-wide text-text-tertiary">Familia</span>
              <span className="text-sm text-text-primary">{item.familyName}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-page rounded-md p-3">
              <span className="block text-[11px] uppercase tracking-wide text-text-tertiary">En stock</span>
              <span className="text-lg font-medium text-text-primary tabular-nums">{fmtQty(item.qty, item.unitAbbr)}</span>
            </div>
            <div className="bg-page rounded-md p-3">
              <span className="block text-[11px] uppercase tracking-wide text-text-tertiary">Valor</span>
              <span className="text-lg font-medium text-text-primary tabular-nums">{fmtEur(item.valueEur)}</span>
            </div>
          </div>
          <p className="text-xs text-text-tertiary flex items-center gap-1.5">
            <Package size={13} /> Vista rápida. La ficha completa tiene coste, proveedores, alérgenos y más.
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
