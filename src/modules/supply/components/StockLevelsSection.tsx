// src/modules/supply/components/StockLevelsSection.tsx
//
// Frente ② — NIVELES de stock (base del MRP II). Lista los ingredientes con su
// stock actual vs mínimo/par; lo que está bajo mínimo sube arriba con su "repón
// hasta el par". Edición inline de mínimo y par (el cocinero define gestos
// simples). El par alimenta el "To Par" del order builder. El punto de pedido /
// lead time / safety quedan en la tabla, listos para el MRP II (no en esta UI).

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Check, Search } from 'lucide-react'
import { getStockLevelsOverview, setStockLevel, type StockLevelItem } from '@/modules/supply/services/stockLevelService'

type Filter = 'below' | 'with' | 'without' | 'all'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'below', label: 'Bajo mínimo' }, { key: 'with', label: 'Con nivel' },
  { key: 'without', label: 'Sin nivel' }, { key: 'all', label: 'Todos' },
]

const fmtQty = (v: number | null) => v == null ? '—' : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)

export default function StockLevelsSection({
  accountId, locationId, actorId, actorName, onError, onFlash,
}: {
  accountId: string
  locationId: string
  actorId?: string | null
  actorName?: string | null
  onError: (m: string) => void
  onFlash: (m: string) => void
}) {
  const [items, setItems] = useState<StockLevelItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('below')
  const [q, setQ] = useState('')
  // edición inline: { [recipeItemId]: { min, par } } strings en curso
  const [edits, setEdits] = useState<Record<string, { min: string; par: string }>>({})
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    if (!accountId || !locationId) { setItems([]); setLoading(false); return }
    setLoading(true)
    try {
      const data = await getStockLevelsOverview({ accountId, locationId })
      setItems(data)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error cargando niveles.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [accountId, locationId]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    below: items.filter(i => i.belowMin).length,
    withLevel: items.filter(i => i.hasLevel).length,
    without: items.filter(i => !i.hasLevel).length,
  }), [items])

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return items.filter(i => {
      if (term && !i.itemName.toLowerCase().includes(term)) return false
      switch (filter) {
        case 'below': return i.belowMin
        case 'with': return i.hasLevel
        case 'without': return !i.hasLevel
        case 'all': return true
      }
    })
  }, [items, filter, q])

  function editVal(it: StockLevelItem, field: 'min' | 'par'): string {
    const e = edits[it.recipeItemId]
    if (e) return field === 'min' ? e.min : e.par
    const v = field === 'min' ? it.minQty : it.parQty
    return v == null ? '' : String(v)
  }
  function setEdit(it: StockLevelItem, field: 'min' | 'par', value: string) {
    setEdits(prev => {
      const cur = prev[it.recipeItemId] ?? { min: it.minQty == null ? '' : String(it.minQty), par: it.parQty == null ? '' : String(it.parQty) }
      return { ...prev, [it.recipeItemId]: { ...cur, [field]: value } }
    })
  }
  function parseNum(s: string): number | null {
    const t = s.trim().replace(',', '.')
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  async function save(it: StockLevelItem) {
    const e = edits[it.recipeItemId]
    if (!e) return
    const min = parseNum(e.min), par = parseNum(e.par)
    setSaving(it.recipeItemId)
    try {
      await setStockLevel({
        accountId, locationId, recipeItemId: it.recipeItemId,
        minQty: min, parQty: par, userId: actorId ?? null, userName: actorName ?? null,
      })
      onFlash(`Nivel guardado: ${it.itemName}`)
      setEdits(prev => { const n = { ...prev }; delete n[it.recipeItemId]; return n })
      await load()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo guardar el nivel.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-3">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg p-3 bg-danger-bg">
          <div className="text-xs text-danger">Bajo mínimo</div>
          <div className="text-2xl font-medium text-danger tabular-nums">{counts.below}</div>
        </div>
        <div className="rounded-lg p-3 bg-card border border-border-default">
          <div className="text-xs text-text-secondary">Con nivel definido</div>
          <div className="text-2xl font-medium tabular-nums">{counts.withLevel}</div>
        </div>
        <div className="rounded-lg p-3 bg-card border border-border-default">
          <div className="text-xs text-text-secondary">Sin definir</div>
          <div className="text-2xl font-medium text-text-tertiary tabular-nums">{counts.without}</div>
        </div>
      </div>

      {/* Filtros + buscar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)}
            className={`text-xs rounded-md px-2.5 py-1 border transition-base ${filter === f.key ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
            {f.label}
          </button>
        ))}
        <div className="relative flex-1 min-w-[140px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar artículo…"
            className="w-full h-8 pl-8 pr-2 text-sm rounded-md border border-border-default bg-card" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Cargando niveles…</div>
      ) : shown.length === 0 ? (
        <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
          {filter === 'below' ? 'Nada bajo mínimo. Todo en orden.' : 'No hay artículos que mostrar con este filtro.'}
        </div>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="flex items-center gap-2.5 px-3.5 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary">
            <span className="flex-1">Artículo</span>
            <span className="w-24 text-right">Stock</span>
            <span className="w-20 text-right">Mínimo</span>
            <span className="w-20 text-right">Par</span>
            <span className="w-28 text-right">Estado</span>
            <span className="w-9"></span>
          </div>
          {shown.map(it => {
            const dirty = !!edits[it.recipeItemId]
            return (
              <div key={it.recipeItemId}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 border-t border-border-default ${it.belowMin ? 'bg-danger-bg' : ''}`}>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-text-primary truncate">{it.itemName}</span>
                  {it.familyName && <span className="block text-[11px] text-text-tertiary truncate">{it.familyName}</span>}
                </span>
                <span className={`w-24 text-right text-sm tabular-nums ${it.belowMin ? 'text-danger font-medium' : 'text-text-secondary'}`}>
                  {fmtQty(it.qtyOnHand)}{it.unitAbbr ? ` ${it.unitAbbr}` : ''}
                </span>
                <span className="w-20 text-right">
                  <input value={editVal(it, 'min')} onChange={e => setEdit(it, 'min', e.target.value)} placeholder="—" inputMode="decimal"
                    className="w-[68px] h-7 px-1.5 text-xs text-right rounded-md border border-border-default bg-card tabular-nums" />
                </span>
                <span className="w-20 text-right">
                  <input value={editVal(it, 'par')} onChange={e => setEdit(it, 'par', e.target.value)} placeholder="—" inputMode="decimal"
                    className="w-[68px] h-7 px-1.5 text-xs text-right rounded-md border border-border-default bg-card tabular-nums" />
                </span>
                <span className="w-28 text-right">
                  {it.belowMin ? (
                    <span className="text-[11px] bg-danger text-text-on-accent px-2 py-0.5 rounded">repón {fmtQty(it.toParQty)}</span>
                  ) : it.hasLevel ? (
                    <span className="text-[11px] text-success inline-flex items-center gap-0.5"><Check size={12} /> ok</span>
                  ) : (
                    <span className="text-[11px] text-text-tertiary">sin definir</span>
                  )}
                </span>
                <span className="w-9 text-right">
                  {dirty && (
                    <button type="button" onClick={() => save(it)} disabled={saving === it.recipeItemId}
                      className="text-accent hover:opacity-70 disabled:opacity-40" aria-label="Guardar nivel">
                      {saving === it.recipeItemId ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />}
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-text-tertiary leading-relaxed">
        El mínimo dispara la alerta de reposición; el par es el objetivo al que reponer (par − stock = lo que pides). Escribe el valor y pulsa el check para guardar. El par alimentará el pedido "To Par".
      </p>
    </div>
  )
}
