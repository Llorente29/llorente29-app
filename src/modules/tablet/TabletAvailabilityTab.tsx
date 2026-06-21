// src/modules/tablet/TabletAvailabilityTab.tsx
//
// Pestaña DISPONIBILIDAD (86) de la Estación de Tablet. Panel completo por token,
// estilo oscuro y táctil (botones grandes). Opción (a): mantiene la confirmación
// de alcance ("N marcas · N canales") antes de agotar, porque afecta a la venta
// real en plataformas.
//
// Flujo: lista de agotados (reactivar) + botón "Agotar producto" (buscar →
// confirmar alcance → agotar). El local es el del dispositivo (no hay selector).

import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleOff, Plus, Search, RefreshCw, X, Loader2, AlertTriangle } from 'lucide-react'
import {
  listSoldOut, searchProducts, previewScope, setProductAvailability,
  type SoldOutRow, type ProductPick, type ScopePreview,
} from './services/tabletAvailabilityService'

interface Props {
  token: string
  locationName: string
}

export default function TabletAvailabilityTab({ token, locationName }: Props) {
  const [rows, setRows] = useState<SoldOutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showAgotar, setShowAgotar] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await listSoldOut(token)
      setRows(data)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando agotados')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { setLoading(true); void refresh() }, [refresh])

  const handleReactivar = useCallback(async (row: SoldOutRow) => {
    if (!row.representativeMenuItemId) return
    setBusyId(row.id)
    try {
      await setProductAvailability(token, row.representativeMenuItemId, true)
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo reactivar')
    } finally {
      setBusyId(null)
    }
  }, [token, refresh])

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-100">
      {/* Cabecera de la pestaña */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 text-zinc-300">
          <CircleOff size={20} className="text-amber-400" />
          <span className="text-base font-semibold">Disponibilidad</span>
          <span className="text-sm text-zinc-500">· {locationName}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => { void refresh() }}
            className="p-2.5 rounded-lg bg-zinc-900 ring-1 ring-zinc-800 text-zinc-400 hover:text-zinc-100"
            title="Actualizar"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowAgotar(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#D67442] text-[#1a1208] font-bold hover:bg-[#e0824f]"
          >
            <Plus size={18} /> Agotar producto
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-3 rounded-lg bg-red-500/15 text-red-200 ring-1 ring-red-500/40 px-3 py-2 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Lista de agotados */}
      <div className="flex-1 overflow-y-auto p-5">
        <p className="text-sm text-zinc-500 mb-3">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-2 align-middle" />
          Agotados ahora · {rows.length}
        </p>

        {loading && rows.length === 0 ? (
          <div className="grid place-items-center h-[40vh] text-zinc-600">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center h-[40vh] text-center text-zinc-600">
            <div>
              <p className="text-2xl font-semibold text-zinc-400">Todo disponible</p>
              <p className="text-sm mt-1">No hay productos agotados en {locationName}.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
            {rows.map((row) => (
              <div key={`${row.id}`} className="bg-zinc-900 ring-1 ring-zinc-800 rounded-xl p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2.5">
                  {row.photoUrl ? (
                    <img src={row.photoUrl} alt="" className="w-11 h-11 rounded-full object-cover ring-1 ring-zinc-700" />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-zinc-800 grid place-items-center text-zinc-500 font-semibold">
                      {row.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-100 truncate">{row.name}</p>
                    <p className="text-xs text-zinc-500">
                      {row.brands} {row.brands === 1 ? 'marca' : 'marcas'}
                      <span className={`ml-2 px-1.5 py-px rounded text-[10px] font-bold ${row.sourceFolvy ? 'bg-[#D67442]/20 text-[#e0a884]' : 'bg-zinc-800 text-zinc-500'}`}>
                        {row.sourceFolvy ? 'Folvy' : 'Last'}
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => void handleReactivar(row)}
                  disabled={busyId === row.id || !row.representativeMenuItemId}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busyId === row.id ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  Reactivar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAgotar && (
        <AgotarModal
          token={token}
          locationName={locationName}
          onClose={() => setShowAgotar(false)}
          onDone={() => { setShowAgotar(false); void refresh() }}
        />
      )}
    </div>
  )
}

// ── Modal: buscar → confirmar alcance → agotar ───────────────────────────────

function AgotarModal({
  token, locationName, onClose, onDone,
}: { token: string; locationName: string; onClose: () => void; onDone: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductPick[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<ProductPick | null>(null)
  const [scope, setScope] = useState<ScopePreview | null>(null)
  const [until, setUntil] = useState<'indef' | 'today'>('indef')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounce = useRef<number | null>(null)

  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current)
    if (query.trim().length < 2) { setResults([]); return }
    setSearching(true)
    debounce.current = window.setTimeout(async () => {
      try {
        const r = await searchProducts(token, query)
        setResults(r)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Error buscando')
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [query, token])

  const pick = useCallback(async (p: ProductPick) => {
    setPicked(p)
    setScope(null)
    try {
      const s = await previewScope(token, p.menuItemId)
      setScope(s)
    } catch { setScope({ brands: p.brands, channels: 0 }) }
  }, [token])

  const confirmAgotar = useCallback(async () => {
    if (!picked) return
    setBusy(true)
    try {
      const untilTs = until === 'today'
        ? new Date(new Date().setHours(23, 59, 59, 0)).toISOString()
        : null
      await setProductAvailability(token, picked.menuItemId, false, 'manual', untilTs)
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo agotar')
      setBusy(false)
    }
  }, [picked, until, token, onDone])

  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
      <div className="w-full max-w-lg bg-zinc-900 rounded-2xl ring-1 ring-zinc-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-100">Agotar producto</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800">
            <X size={20} />
          </button>
        </div>

        <div className="p-5">
          {!picked ? (
            <>
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar producto…"
                  autoFocus
                  className="w-full rounded-xl bg-zinc-950 ring-1 ring-zinc-700 pl-10 pr-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-base"
                />
              </div>
              <div className="mt-3 max-h-72 overflow-y-auto flex flex-col gap-1">
                {searching && <div className="text-zinc-500 text-sm py-2 px-1">Buscando…</div>}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <div className="text-zinc-500 text-sm py-2 px-1">Sin resultados.</div>
                )}
                {results.map((p) => (
                  <button
                    key={p.menuItemId}
                    onClick={() => void pick(p)}
                    className="text-left px-4 py-3 rounded-xl hover:bg-zinc-800 flex items-center justify-between"
                  >
                    <span className="font-medium text-zinc-100">{p.name}</span>
                    <span className="text-xs text-zinc-500">{p.brands} {p.brands === 1 ? 'marca' : 'marcas'}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl bg-amber-500/10 ring-1 ring-amber-500/30 p-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-100">
                    ¿Agotar <b>"{picked.name}"</b> en <b>{locationName}</b>?
                    <div className="mt-1 text-amber-200/90">
                      Se apagará <b>AHORA, en producción</b>
                      {scope ? <> en <b>{scope.brands} {scope.brands === 1 ? 'marca' : 'marcas'}</b> · <b>{scope.channels} {scope.channels === 1 ? 'canal' : 'canales'}</b></> : <> (calculando alcance…)</>}.
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-4 text-sm">
                <label className="flex items-center gap-2 text-zinc-300">
                  <input type="radio" checked={until === 'indef'} onChange={() => setUntil('indef')} /> Indefinido
                </label>
                <label className="flex items-center gap-2 text-zinc-300">
                  <input type="radio" checked={until === 'today'} onChange={() => setUntil('today')} /> Solo hoy (reactiva a medianoche)
                </label>
              </div>

              {error && <div className="mt-3 text-red-300 text-sm">{error}</div>}

              <div className="mt-5 flex gap-2 justify-end">
                <button
                  onClick={() => { setPicked(null); setScope(null) }}
                  className="px-4 py-2.5 rounded-lg bg-zinc-800 text-zinc-300 font-medium hover:bg-zinc-700"
                >
                  Atrás
                </button>
                <button
                  onClick={() => void confirmAgotar()}
                  disabled={busy}
                  className="px-5 py-2.5 rounded-lg bg-[#D67442] text-[#1a1208] font-bold hover:bg-[#e0824f] disabled:opacity-50 flex items-center gap-2"
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  Sí, agotar en {locationName}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
