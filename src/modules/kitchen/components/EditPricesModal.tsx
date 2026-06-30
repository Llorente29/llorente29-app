// src/modules/kitchen/components/EditPricesModal.tsx
//
// FRENTE OVERRIDES — modal "Editar precios" de un producto.
// · Precio por defecto (base de la marca, menu_item.price, SIN IVA) → updateMenuItem.
// · Una fila por canal: precio propio (override, SIN IVA; vacío = hereda base) + 86.
// · MARGEN NETO EN VIVO desde el motor menu_item_channel_economics (preview con los
//   precios tecleados): la fórmula vive en el servidor, aquí solo se muestra.
//
// Convención de IVA idéntica a la ficha: se teclea PRECIO sin IVA, se muestra el PVP
// con IVA derivado. Sin doble criterio, sin deriva de céntimos.

import { useState, useEffect, useMemo } from 'react'
import { X, Loader2 } from 'lucide-react'
import {
  getMenuItemChannelEconomics,
  setMenuItemOverride,
  clearMenuItemOverride,
  type ChannelEconomics,
} from '@/modules/kitchen/services/menuOverrideService'
import { updateMenuItem } from '@/modules/kitchen/services/menuItemService'

interface EditPricesModalProps {
  menuItemId: string
  productName: string
  basePrice: number          // menu_item.price (SIN IVA)
  vatRate: number
  onClose: () => void
  onSaved: () => void
}

function fmtEur(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n)
}

// "9,90" | "9.90" | "" → number | null
function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export default function EditPricesModal({
  menuItemId, productName, basePrice, vatRate, onClose, onSaved,
}: EditPricesModalProps) {
  const [loading, setLoading] = useState(true)
  const [channels, setChannels] = useState<ChannelEconomics[]>([])
  const [defaultPrice, setDefaultPrice] = useState<string>(String(basePrice ?? 0))
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [avail, setAvail] = useState<Record<string, boolean>>({})
  const [live, setLive] = useState<ChannelEconomics[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Carga inicial: economía por canal en su estado guardado.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getMenuItemChannelEconomics(menuItemId)
      .then((rows) => {
        if (cancelled) return
        setChannels(rows)
        setLive(rows)
        const p: Record<string, string> = {}
        const a: Record<string, boolean> = {}
        for (const r of rows) {
          p[r.channelId] = r.priceSource === 'override' ? String(r.price) : ''
          a[r.channelId] = r.isAvailable
        }
        setPrices(p)
        setAvail(a)
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando precios') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [menuItemId])

  // Precio efectivo tecleado por canal (propio si lo hay, si no el por defecto).
  const previewKey = useMemo(() => {
    const map: Record<string, number> = {}
    const def = parseNum(defaultPrice)
    for (const ch of channels) {
      const own = parseNum(prices[ch.channelId] ?? '')
      const eff = own ?? def
      if (eff !== null) map[ch.channelId] = eff
    }
    return map
  }, [channels, prices, defaultPrice])

  // Margen en vivo: re-pregunta al motor con los precios tecleados (debounce).
  useEffect(() => {
    if (channels.length === 0) return
    const handle = setTimeout(() => {
      getMenuItemChannelEconomics(menuItemId, previewKey)
        .then(setLive)
        .catch(() => { /* mantener lo último bueno */ })
    }, 300)
    return () => clearTimeout(handle)
  }, [menuItemId, previewKey, channels.length])

  const liveByCh = useMemo(() => {
    const m: Record<string, ChannelEconomics> = {}
    for (const r of live) m[r.channelId] = r
    return m
  }, [live])

  const defNum = parseNum(defaultPrice)
  const defPvp = defNum !== null ? Math.round(defNum * (1 + (vatRate ?? 0) / 100) * 100) / 100 : null

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      // 1) Precio por defecto (solo si cambió y es válido)
      if (defNum !== null && defNum !== basePrice) {
        await updateMenuItem(menuItemId, { price: defNum })
      }
      // 2) Override por canal
      for (const ch of channels) {
        const p = parseNum(prices[ch.channelId] ?? '')   // null = hereda base
        const a = avail[ch.channelId] !== false
        if (p === null && a) {
          await clearMenuItemOverride({ menuItemId, channelId: ch.channelId })
        } else {
          await setMenuItemOverride({ menuItemId, channelId: ch.channelId, price: p, isAvailable: a })
        }
      }
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error guardando precios')
      setSaving(false)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl border border-gray-200 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Editar precios</h2>
            <p className="text-xs text-gray-500 mt-0.5">{productName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar"
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* Precio por defecto */}
              <div className="rounded-lg bg-stone-50 border border-stone-200 px-4 py-3 mb-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[13px] font-medium text-gray-800">Precio por defecto</div>
                    <div className="text-[11px] text-gray-500">Base de la marca · se aplica a los canales sin precio propio</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-[10px] text-gray-400 uppercase tracking-wide">PVP cliente</div>
                      <div className="font-mono text-sm text-gray-600">{fmtEur(defPvp)}</div>
                    </div>
                    <div className="relative">
                      <input
                        value={defaultPrice}
                        onChange={(e) => setDefaultPrice(e.target.value)}
                        inputMode="decimal"
                        className="w-28 px-3 py-1.5 text-right font-mono text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                      />
                      <span className="text-[10px] text-gray-400 block text-right mt-0.5">sin IVA</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Por canal */}
              {channels.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">No hay canales de venta configurados para esta marca.</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-1 text-[10px] uppercase tracking-wide text-gray-400">
                    <span>Canal</span>
                    <span className="text-right w-28">Precio</span>
                    <span className="text-right w-24">Margen neto</span>
                    <span className="text-right w-16">Disp.</span>
                  </div>
                  {channels.map((ch) => {
                    const lv = liveByCh[ch.channelId]
                    const a = avail[ch.channelId] !== false
                    const own = prices[ch.channelId] ?? ''
                    const inherits = own.trim() === ''
                    const margin = lv?.netMargin ?? null
                    const marginPct = lv?.netMarginPct ?? null
                    return (
                      <div key={ch.channelId}
                        className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-1 py-2 border-b border-gray-100 last:border-0">
                        {/* Canal */}
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[13px] font-medium text-gray-800 truncate">{ch.channelName}</span>
                          {ch.serviceType === 'own_delivery' && (lv?.orderCostsPerItem ?? 0) > 0 && (
                            <span className="text-[10px] text-gray-400">+canal est. {fmtEur(lv?.orderCostsPerItem)}</span>
                          )}
                        </div>
                        {/* Precio */}
                        <div className="w-28 text-right">
                          <input
                            value={own}
                            onChange={(e) => setPrices((p) => ({ ...p, [ch.channelId]: e.target.value }))}
                            placeholder={defNum !== null ? defNum.toFixed(2) : 'base'}
                            inputMode="decimal"
                            className="w-28 px-2.5 py-1.5 text-right font-mono text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                          />
                          <span className="text-[10px] text-gray-400 block mt-0.5">
                            {inherits ? 'hereda base' : `PVP ${fmtEur(lv?.priceWithVat)}`}
                          </span>
                        </div>
                        {/* Margen neto */}
                        <div className="w-24 text-right">
                          <div className={`font-mono text-sm font-medium ${margin == null ? 'text-gray-300' : margin >= 0 ? 'text-success' : 'text-danger'}`}>
                            {fmtEur(margin)}
                          </div>
                          <span className="text-[10px] text-gray-400 block">
                            {marginPct != null ? `${marginPct}%` : ''}{lv && !lv.costAvailable ? ' · sin coste' : ''}
                          </span>
                        </div>
                        {/* Disponibilidad (86) */}
                        <div className="w-16 flex justify-end">
                          <button type="button"
                            onClick={() => setAvail((s) => ({ ...s, [ch.channelId]: !a }))}
                            role="switch" aria-checked={a}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${a ? 'bg-success' : 'bg-stone-300'}`}>
                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${a ? 'translate-x-[1.15rem]' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  <p className="text-[11px] text-gray-400 pt-2">
                    El margen es el de contribución por plato menos los costes de pedido estimados (fija, rider, envío) en canales de reparto propio. Apagar la disponibilidad retira el plato de ese canal (86).
                  </p>
                </div>
              )}

              {error && <div className="mt-3 p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{error}</div>}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-3 py-1.5 text-sm rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving || loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
