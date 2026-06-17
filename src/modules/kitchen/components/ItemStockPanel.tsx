// src/modules/kitchen/components/ItemStockPanel.tsx
//
// AL1 — Sección "Stock por almacén" de la ficha del artículo, viva.
// Muestra el saldo del artículo en cada local (cantidad en formato + base + valor)
// y un botón "Ajustar" por local (cada fila ES un local → sin selector manual).
// Reusa formatStockQty (AL1) y AdjustStockModal.

import { useEffect, useState } from 'react'
import { Loader2, SlidersHorizontal } from 'lucide-react'
import { getItemStockByLocation, type ItemStockByLocation } from '@/modules/kitchen/services/itemStockService'
import { formatStockQty } from '@/modules/supply/services/storageZonesService'
import AdjustStockModal from '@/modules/supply/components/AdjustStockModal'

const eur = (v: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)

export default function ItemStockPanel({
  accountId, recipeItemId, itemName, actorId, actorName,
}: {
  accountId: string
  recipeItemId: string
  itemName: string
  actorId: string | null
  actorName: string | null
}) {
  const [data, setData] = useState<ItemStockByLocation | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadTick, setReloadTick] = useState(0)
  const [adjust, setAdjust] = useState<{ locationId: string; qty: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getItemStockByLocation(accountId, recipeItemId)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, recipeItemId, reloadTick])

  if (loading) return <div className="flex items-center gap-2 text-text-secondary text-sm py-2"><Loader2 size={14} className="animate-spin" /> Cargando stock…</div>
  if (!data || data.locations.length === 0) return <p className="text-sm text-text-tertiary">Sin locales con stock para este artículo.</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm pb-1 border-b border-border-default">
        <span className="text-text-secondary">Total</span>
        <span className="text-text-primary font-medium tabular-nums">{eur(data.totalValue)}</span>
      </div>

      {data.locations.map(loc => {
        const d = formatStockQty(loc.qty, data.unitAbbr, data.buyFormatName, data.buyFormatQtyInBase, loc.valueEur)
        return (
          <div key={loc.locationId} className="flex items-center gap-3 py-1.5">
            <span className="flex-1 text-sm text-text-primary truncate">{loc.locationName}</span>
            <span className="text-right">
              <span className={`block text-sm tabular-nums ${d.counted ? 'text-text-primary font-medium' : 'text-text-tertiary'}`}>{d.main}</span>
              {d.sub && <span className="block text-[11px] text-text-tertiary tabular-nums">{d.sub}</span>}
            </span>
            <span className="w-20 text-right text-sm text-text-secondary tabular-nums">{loc.valueEur > 0 ? eur(loc.valueEur) : '—'}</span>
            <button type="button" onClick={() => setAdjust({ locationId: loc.locationId, qty: loc.qty })}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border-default text-text-secondary hover:text-text-primary transition-base">
              <SlidersHorizontal size={13} /> Ajustar
            </button>
          </div>
        )
      })}

      {adjust && (
        <AdjustStockModal
          accountId={accountId}
          locationId={adjust.locationId}
          actorId={actorId}
          actorName={actorName}
          target={{ recipeItemId, name: itemName, currentQtyBase: adjust.qty, unitAbbr: data.unitAbbr }}
          onClose={() => setAdjust(null)}
          onDone={() => { setAdjust(null); setReloadTick(t => t + 1) }}
        />
      )}
    </div>
  )
}
