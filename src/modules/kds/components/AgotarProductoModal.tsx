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
//
// ENCARGO 86 (06/08): de un solo producto a MULTI-SELECCIÓN — buscar, marcar
// varios con checks, agotar todos de una vez con un motivo/vencimiento ÚNICO
// y UN SOLO empuje a canales en el servidor. Tope de selección: 50 (decisión
// de Julio). Combos incluidos en la búsqueda (agotar un combo NO agota sus
// componentes). El alcance de la confirmación es honesto: si un tramo
// (Last/HubRise) no se pudo calcular se pinta "—", nunca 0 como si fuera un
// hecho (Bloque C del encargo).

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, Search, X } from 'lucide-react'
import { themeCls, type Theme } from '../lib/theme'
import { endOfTodayIso } from '../lib/endOfToday'
import ReasonSelect from './ReasonSelect'
import { reasonCodeParam, type ReasonCode } from '../lib/reasonCode'

const MAX_SELECTION = 50

export interface ProductPick {
  menuItemId: string
  name: string
  externalId: string | null
  recipeItemId: string | null
  brands: number
  isCombo: boolean
}

/** Alcance honesto: null en un tramo = no se pudo calcular (se pinta "—", nunca 0). */
export interface ScopePreview {
  brands: number
  channelsLast: number | null
  brandsHubrise: number | null
}

export interface AgotarProductoAdapter {
  searchProducts: (query: string) => Promise<ProductPick[]>
  previewScopeBulk: (menuItemIds: string[]) => Promise<ScopePreview>
  /** Agota los productos seleccionados (availableUntil=null → indefinido; reasonCode=null → sin especificar). */
  agotarBulk: (menuItemIds: string[], availableUntil: string | null, reasonCode: ReasonCode | null) => Promise<void>
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
  const [selected, setSelected] = useState<Map<string, ProductPick>>(new Map())
  const [stage, setStage] = useState<'search' | 'confirm'>('search')
  const [scope, setScope] = useState<ScopePreview | null>(null)
  const [scopeLoading, setScopeLoading] = useState(false)
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

  const capReached = selected.size >= MAX_SELECTION

  const toggle = useCallback((p: ProductPick) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(p.menuItemId)) {
        next.delete(p.menuItemId)
      } else {
        if (next.size >= MAX_SELECTION) return prev
        next.set(p.menuItemId, p)
      }
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelected(new Map()), [])

  const goToConfirm = useCallback(async () => {
    if (selected.size === 0) return
    setError(null)
    setStage('confirm')
    setScope(null)
    setScopeLoading(true)
    const ids = [...selected.keys()]
    try {
      setScope(await adapter.previewScopeBulk(ids))
    } catch {
      setScope(null) // no se pudo calcular nada: se pinta "calculando…", nunca un número inventado
    } finally {
      setScopeLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const backToSearch = useCallback(() => {
    setStage('search')
    setScope(null)
    setError(null)
  }, [])

  const confirm = useCallback(async () => {
    if (selected.size === 0) return
    setBusy(true); setError(null)
    try {
      await adapter.agotarBulk([...selected.keys()], until === 'hoy' ? endOfTodayIso() : null, reasonCodeParam(reasonCode))
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo agotar')
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, until, reasonCode])

  const selectedList = [...selected.values()]
  const n = selected.size

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
          {stage === 'search' ? (
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

              {n > 0 && (
                <div className="mt-2.5 flex items-center justify-between">
                  <span className={`text-xs font-medium ${t.textSecondary}`}>{n} seleccionado{n === 1 ? '' : 's'}</span>
                  <button onClick={clearSelection} className={`text-xs font-medium underline ${t.textMuted}`}>
                    Quitar selección
                  </button>
                </div>
              )}
              {capReached && (
                <div className="mt-1.5 text-xs text-danger">Máximo {MAX_SELECTION} productos por operación.</div>
              )}

              <div className="mt-2.5 max-h-64 overflow-y-auto flex flex-col gap-1">
                {searching && <div className={`text-sm py-2 px-1 ${t.textMuted}`}>Buscando…</div>}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <div className={`text-sm py-2 px-1 ${t.textMuted}`}>Sin resultados.</div>
                )}
                {results.map((p) => {
                  const isSelected = selected.has(p.menuItemId)
                  const disabled = !isSelected && capReached
                  return (
                    <button
                      key={p.menuItemId}
                      onClick={() => toggle(p)}
                      disabled={disabled}
                      className={`text-left px-3 py-2 rounded-lg flex items-center gap-2.5 disabled:opacity-40 ${t.hoverBg}`}
                    >
                      <span
                        className={`w-4 h-4 rounded shrink-0 flex items-center justify-center border ${
                          isSelected ? 'bg-accent border-accent text-text-on-accent' : `${t.border} bg-transparent`
                        }`}
                      >
                        {isSelected && <Check size={12} strokeWidth={3} />}
                      </span>
                      <span className={`flex-1 min-w-0 text-sm truncate ${t.textPrimary}`}>{p.name}</span>
                      {p.isCombo && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-medium leading-none">
                          Combo
                        </span>
                      )}
                      <span className={`shrink-0 text-xs ${t.textMuted}`}>{p.brands} marca{p.brands === 1 ? '' : 's'}</span>
                    </button>
                  )
                })}
              </div>

              {error && <div className="mt-3 text-sm text-danger">{error}</div>}

              <div className="mt-5 flex gap-2 justify-end">
                <button
                  onClick={onClose}
                  className={`px-3.5 py-2.5 rounded-lg text-sm font-medium ${t.chipNeutral}`}
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void goToConfirm()}
                  disabled={n === 0}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 ${t.ctaWarning}`}
                >
                  Continuar ({n})
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`rounded-lg p-3 ${dark ? 'bg-amber-500/10 ring-1 ring-amber-500/30' : 'border border-warning bg-warning-bg'}`}>
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={18} className={`shrink-0 mt-0.5 ${dark ? 'text-amber-400' : 'text-warning'}`} />
                  <div className={`text-sm ${dark ? 'text-amber-100' : 'text-stone-800'}`}>
                    ¿Agotar <strong>{n} producto{n === 1 ? '' : 's'}</strong> en {locationLabel}?
                    <div className={`mt-1 ${dark ? 'text-amber-200/90' : 'text-stone-600'}`}>
                      Se apagará <strong>AHORA, en producción</strong>, en{' '}
                      {scopeLoading || !scope ? 'calculando alcance…' : (
                        <strong>
                          {scope.brands} marca{scope.brands === 1 ? '' : 's'}
                          {' · '}Last: {scope.channelsLast ?? '—'} canal{scope.channelsLast === 1 ? '' : 'es'}
                          {' · '}HubRise: {scope.brandsHubrise ?? '—'} marca{scope.brandsHubrise === 1 ? '' : 's'}
                        </strong>
                      )}.
                    </div>
                    {allLocations && (
                      <p className={`mt-1.5 font-semibold ${dark ? 'text-amber-100' : 'text-stone-800'}`}>
                        Atención: lo apagas en TODOS los locales.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 max-h-24 overflow-y-auto flex flex-wrap gap-1.5">
                {selectedList.map((p) => (
                  <span key={p.menuItemId} className={`text-[11px] px-2 py-1 rounded-full ${t.chipNeutral}`}>{p.name}</span>
                ))}
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
                <span className={`text-xs ${t.textMuted}`}>Motivo (opcional, uno para toda la selección):</span>
                <ReasonSelect value={reasonCode} onChange={setReasonCode} theme={theme} />
              </div>

              {error && <div className="mt-3 text-sm text-danger">{error}</div>}

              <div className="mt-5 flex gap-2 justify-end">
                <button
                  onClick={backToSearch}
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
                  Sí, agotar {n} producto{n === 1 ? '' : 's'} en {locationLabel}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
