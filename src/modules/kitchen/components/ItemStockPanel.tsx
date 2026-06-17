// src/modules/kitchen/components/ItemStockPanel.tsx
//
// AL1 — Sección "Stock por almacén" de la ficha del artículo, viva.
// Por cada local muestra el saldo (cantidad en formato + base + valor), el botón
// "Ajustar", y las casillas de MÍNIMO y PAR editables (frente ②: nivel por local).
// El nivel se edita aquí o en la pestaña Niveles del módulo Almacén — misma tabla
// stock_level, misma RPC set_stock_level (cero lógica duplicada). El stock y su
// nivel viven juntos porque son la misma conversación: cuánto tengo vs cuánto
// debería tener, en este local.

import { useEffect, useState } from 'react'
import { Loader2, SlidersHorizontal, Check } from 'lucide-react'
import { getItemStockByLocation, type ItemStockByLocation } from '@/modules/kitchen/services/itemStockService'
import { formatStockQty } from '@/modules/supply/services/storageZonesService'
import { getLevelsForItem, setStockLevel } from '@/modules/supply/services/stockLevelService'
import AdjustStockModal from '@/modules/supply/components/AdjustStockModal'

const eur = (v: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)

interface LevelEdit { min: string; par: string }

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
  // nivel actual por local (guardado) y ediciones en curso
  const [levels, setLevels] = useState<Record<string, { min: number | null; par: number | null }>>({})
  const [edits, setEdits] = useState<Record<string, LevelEdit>>({})
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      getItemStockByLocation(accountId, recipeItemId),
      getLevelsForItem(accountId, recipeItemId).catch(() => []),
    ])
      .then(([stock, lvls]) => {
        if (cancelled) return
        setData(stock)
        const map: Record<string, { min: number | null; par: number | null }> = {}
        for (const l of lvls) map[l.locationId] = { min: l.minQty, par: l.parQty }
        setLevels(map)
        setEdits({})
      })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, recipeItemId, reloadTick])

  function val(locationId: string, field: 'min' | 'par'): string {
    const e = edits[locationId]
    if (e) return field === 'min' ? e.min : e.par
    const lv = levels[locationId]
    const v = lv ? (field === 'min' ? lv.min : lv.par) : null
    return v == null ? '' : String(v)
  }
  function setVal(locationId: string, field: 'min' | 'par', value: string) {
    setEdits(prev => {
      const lv = levels[locationId]
      const cur = prev[locationId] ?? {
        min: lv?.min == null ? '' : String(lv.min),
        par: lv?.par == null ? '' : String(lv.par),
      }
      return { ...prev, [locationId]: { ...cur, [field]: value } }
    })
  }
  function parseNum(s: string): number | null {
    const t = s.trim().replace(',', '.')
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  async function save(locationId: string) {
    const e = edits[locationId]
    if (!e) return
    setSaving(locationId)
    try {
      await setStockLevel({
        accountId, locationId, recipeItemId,
        minQty: parseNum(e.min), parQty: parseNum(e.par),
        userId: actorId, userName: actorName,
      })
      setReloadTick(t => t + 1)
    } catch {
      setSaving(null)
    }
  }

  if (loading) return <div className="flex items-center gap-2 text-text-secondary text-sm py-2"><Loader2 size={14} className="animate-spin" /> Cargando stock…</div>
  if (!data || data.locations.length === 0) return <p className="text-sm text-text-tertiary">Sin locales con stock para este artículo.</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-text-tertiary pb-1 border-b border-border-default">
        <span className="flex-1">Local</span>
        <span className="w-24 text-right">Stock</span>
        <span className="w-16 text-right">Valor</span>
        <span className="w-16 text-right">Mínimo</span>
        <span className="w-16 text-right">Par</span>
        <span className="w-[68px]"></span>
      </div>

      {data.locations.map(loc => {
        const d = formatStockQty(loc.qty, data.unitAbbr, data.buyFormatName, data.buyFormatQtyInBase, loc.valueEur)
        const dirty = !!edits[loc.locationId]
        const minNum = parseNum(val(loc.locationId, 'min'))
        const belowMin = minNum != null && loc.qty < minNum
        return (
          <div key={loc.locationId} className={`flex items-center gap-3 py-1.5 px-1 rounded-md ${belowMin ? 'bg-danger-bg' : ''}`}>
            <span className="flex-1 text-sm text-text-primary truncate">{loc.locationName}</span>
            <span className="w-24 text-right">
              <span className={`block text-sm tabular-nums ${belowMin ? 'text-danger font-medium' : d.counted ? 'text-text-primary font-medium' : 'text-text-tertiary'}`}>{d.main}</span>
              {d.sub && <span className="block text-[11px] text-text-tertiary tabular-nums">{d.sub}</span>}
            </span>
            <span className="w-16 text-right text-xs text-text-secondary tabular-nums">{loc.valueEur > 0 ? eur(loc.valueEur) : '—'}</span>
            <span className="w-16 text-right">
              <input value={val(loc.locationId, 'min')} onChange={e => setVal(loc.locationId, 'min', e.target.value)} placeholder="—" inputMode="decimal"
                className="w-14 h-7 px-1.5 text-xs text-right rounded-md border border-border-default bg-card tabular-nums" />
            </span>
            <span className="w-16 text-right">
              <input value={val(loc.locationId, 'par')} onChange={e => setVal(loc.locationId, 'par', e.target.value)} placeholder="—" inputMode="decimal"
                className="w-14 h-7 px-1.5 text-xs text-right rounded-md border border-border-default bg-card tabular-nums" />
            </span>
            <span className="w-[68px] flex items-center justify-end gap-1">
              {dirty ? (
                <button type="button" onClick={() => save(loc.locationId)} disabled={saving === loc.locationId}
                  className="text-accent hover:opacity-70 disabled:opacity-40 p-1" aria-label="Guardar nivel">
                  {saving === loc.locationId ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}
                </button>
              ) : (
                <button type="button" onClick={() => setAdjust({ locationId: loc.locationId, qty: loc.qty })}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border-default text-text-secondary hover:text-text-primary transition-base" aria-label="Ajustar stock">
                  <SlidersHorizontal size={13} />
                </button>
              )}
            </span>
          </div>
        )
      })}

      <p className="text-[11px] text-text-tertiary pt-1">Mínimo y par por local: escribe el valor y pulsa el check. También se gestionan en Almacén → Niveles. El icono ajusta el stock real.</p>

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
