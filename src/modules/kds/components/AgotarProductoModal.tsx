// src/modules/kds/components/AgotarProductoModal.tsx
//
// DISPONIBILIDAD · C2 — modal ÚNICO "Agotar producto". Antes había dos casi
// idénticos (KitchenAvailabilityPage y TabletAvailabilityTab): mismo flujo
// (buscar → confirmar alcance real → agotar), con solo el tema y la puerta
// de autenticación (sesión|token) distintos. Se fusionan aquí parametrizado
// por tema + un adapter fino que cada envoltorio construye con su propio
// servicio (availabilityService en web, tabletAvailabilityService en
// tablet) — cero cambio de las RPC ni de los flujos, solo de dónde vive el
// JSX.

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Search, X } from 'lucide-react'
import { themeCls, type Theme } from '../lib/theme'
import { endOfTodayIso } from '../lib/endOfToday'
import ReasonSelect from './ReasonSelect'
import { reasonCodeParam, type ReasonCode } from '../lib/reasonCode'

export interface ProductPick {
  menuItemId: string
  name: string
  externalId: string | null
  recipeItemId: string | null
  brands: number
}

export interface ScopePreview {
  brands: number
  channels: number
}

export interface AgotarProductoAdapter {
  searchProducts: (query: string) => Promise<ProductPick[]>
  previewScope: (menuItemId: string) => Promise<ScopePreview>
  /** Agota el producto (availableUntil=null → indefinido; reasonCode=null → sin especificar). */
  agotar: (menuItemId: string, availableUntil: string | null, reasonCode: ReasonCode | null) => Promise<void>
}

interface Props {
  theme: Theme
  adapter: AgotarProductoAdapter
  locationLabel: string
  /** true = el 86 va a TODOS los locales (web, sin local seleccionado). */
  allLocations?: boolean
  onClose: () => void
  onDone: () => void
}

export default function AgotarProductoModal({ theme, adapter, locationLabel, allLocations, onClose, onDone }: Props) {
  const t = themeCls(theme)
  const dark = theme === 'dark'

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductPick[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<ProductPick | null>(null)
  const [scope, setScope] = useState<ScopePreview | null>(null)
  const [until, setUntil] = useState<'indefinido' | 'hoy'>('indefinido')
  const [reasonCode, setReasonCode] = useState<ReasonCode | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounce = useRef<number | null>(null)

  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current)
    if (query.trim().length < 2) { setResults([]); return }
    setSearching(true)
    debounce.current = window.setTimeout(() => {
      adapter.searchProducts(query)
        .then(setResults)
        .catch((e) => setError(e instanceof Error ? e.message : 'Error buscando'))
        .finally(() => setSearching(false))
    }, 300)
    return () => { if (debounce.current) window.clearTimeout(debounce.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const pick = useCallback(async (p: ProductPick) => {
    setPicked(p); setScope(null); setError(null)
    try {
      setScope(await adapter.previewScope(p.menuItemId))
    } catch {
      setScope({ brands: p.brands, channels: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const confirm = useCallback(async () => {
    if (!picked) return
    setBusy(true); setError(null)
    try {
      await adapter.agotar(picked.menuItemId, until === 'hoy' ? endOfTodayIso() : null, reasonCodeParam(reasonCode))
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo agotar')
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, until, reasonCode])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`w-full max-w-md rounded-xl overflow-hidden ${t.panel}`} onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-5 py-3.5 border-b ${t.border}`}>
          <h2 className={`text-base font-semibold ${t.textPrimary}`}>Agotar producto</h2>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${t.iconButton}`}>
            <X size={20} />
          </button>
        </div>

        <div className="p-5">
          {!picked ? (
            <>
              <div className="relative">
                <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${t.textMuted}`} />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar producto a agotar"
                  className={`w-full pl-9 pr-3 py-2.5 rounded-lg text-sm ${t.input} ${t.textPrimary}`}
                />
              </div>
              <div className="mt-3 max-h-72 overflow-y-auto flex flex-col gap-1">
                {searching && <div className={`text-sm py-2 px-1 ${t.textMuted}`}>Buscando…</div>}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <div className={`text-sm py-2 px-1 ${t.textMuted}`}>Sin resultados.</div>
                )}
                {results.map((p) => (
                  <button
                    key={p.menuItemId}
                    onClick={() => void pick(p)}
                    className={`text-left px-3 py-2 rounded-lg flex items-center justify-between ${t.hoverBg}`}
                  >
                    <span className={`text-sm ${t.textPrimary}`}>{p.name}</span>
                    <span className={`text-xs ${t.textMuted}`}>{p.brands} marca{p.brands === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className={`rounded-lg p-3 ${dark ? 'bg-amber-500/10 ring-1 ring-amber-500/30' : 'border border-warning bg-warning-bg'}`}>
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={18} className={`shrink-0 mt-0.5 ${dark ? 'text-amber-400' : 'text-warning'}`} />
                  <div className={`text-sm ${dark ? 'text-amber-100' : 'text-stone-800'}`}>
                    ¿Agotar <strong>“{picked.name}”</strong> en {locationLabel}?
                    <div className={`mt-1 ${dark ? 'text-amber-200/90' : 'text-stone-600'}`}>
                      Se apagará <strong>AHORA, en producción</strong>, en{' '}
                      {scope ? (
                        <strong>{scope.brands} marca{scope.brands === 1 ? '' : 's'} · {scope.channels} canal{scope.channels === 1 ? '' : 'es'}</strong>
                      ) : 'calculando alcance…'} de Glovo / Uber / JustEat.
                    </div>
                    {allLocations && (
                      <p className={`mt-1.5 font-semibold ${dark ? 'text-amber-100' : 'text-stone-800'}`}>
                        Atención: lo apagas en TODOS los locales.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className={`flex gap-4 mt-4 text-sm ${t.textSecondary}`}>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={until === 'indefinido'} onChange={() => setUntil('indefinido')} />
                  Indefinido
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={until === 'hoy'} onChange={() => setUntil('hoy')} />
                  Solo hoy (reactiva a medianoche)
                </label>
              </div>

              <div className="mt-3 flex items-center gap-1.5">
                <span className={`text-xs ${t.textMuted}`}>Motivo (opcional):</span>
                <ReasonSelect value={reasonCode} onChange={setReasonCode} theme={theme} />
              </div>

              {error && <div className="mt-3 text-sm text-danger">{error}</div>}

              <div className="mt-5 flex gap-2 justify-end">
                <button
                  onClick={() => { setPicked(null); setScope(null) }}
                  disabled={busy}
                  className={`px-3.5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 ${t.chipNeutral}`}
                >
                  Atrás
                </button>
                <button
                  onClick={() => void confirm()}
                  disabled={busy}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5 ${t.ctaWarning}`}
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  Sí, agotar en {locationLabel}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
