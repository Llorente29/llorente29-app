// src/modules/kitchen/pages/KitchenAvailabilityPage.tsx
//
// FRENTE 86 / DISPONIBILIDAD — panel de oficina (Carta).
// Lista lo agotado por LOCAL, reactiva, y agota productos con confirmación de
// alcance real ("se apaga AHORA en producción en N marcas · N canales de [LOCAL]").
// La cascada cross-brand + el empuje por local los hace la RPC en el servidor.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, RefreshCw, AlertTriangle, X, Loader2 } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listLocations, listSoldOut, searchProducts, previewScope, setProductAvailability,
  type LocationOption, type SoldOutRow, type ProductPick, type ScopePreview,
} from '@/modules/kitchen/services/availabilityService'

const ACCENT = '#D67442'

function endOfTodayIso(): string {
  const d = new Date()
  d.setHours(23, 59, 0, 0)
  return d.toISOString()
}

export default function KitchenAvailabilityPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()

  const [locations, setLocations] = useState<LocationOption[]>([])
  const [locationId, setLocationId] = useState<string | null>(null) // null = todos
  const [rows, setRows] = useState<SoldOutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'az' | 'brands' | 'recent' | 'origin'>('az')
  const [brandFilter, setBrandFilter] = useState<string>('')  // '' = todas
  const [busyRow, setBusyRow] = useState<string | null>(null)

  const [showAgotar, setShowAgotar] = useState(false)

  const locName = useMemo(
    () => (locationId ? (locations.find((l) => l.id === locationId)?.name ?? 'local') : 'todos los locales'),
    [locationId, locations],
  )

  // cargar locales una vez
  useEffect(() => {
    if (!activeAccountId) return
    listLocations(activeAccountId)
      .then((locs) => {
        setLocations(locs)
        setLocationId(locs[0]?.id ?? null) // por defecto, el primer local
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Error cargando locales'))
  }, [activeAccountId])

  // cargar agotados al cambiar de local (con token anti-carrera)
  const reqRef = useRef(0)
  async function reload() {
    if (!activeAccountId) return
    const my = ++reqRef.current
    setLoading(true); setError(null)
    try {
      const data = await listSoldOut(activeAccountId, locationId)
      if (my !== reqRef.current) return // llegó una respuesta más nueva: descarto esta
      setRows(data)
    } catch (e) {
      if (my === reqRef.current) setError(e instanceof Error ? e.message : 'Error cargando agotados')
    } finally {
      if (my === reqRef.current) setLoading(false)
    }
  }
  useEffect(() => { if (activeAccountId) reload() /* eslint-disable-next-line */ }, [activeAccountId, locationId])

  // marcas disponibles (de los productos cargados) para el desplegable
  const brandOptions = useMemo(() => {
    const set = new Set<string>()
    rows.forEach((r) => r.brandNames.forEach((b) => set.add(b)))
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [rows])

  const visible = useMemo(() => {
    const t = search.trim().toLowerCase()
    let filtered = t ? rows.filter((r) => r.name.toLowerCase().includes(t)) : rows
    if (brandFilter) filtered = filtered.filter((r) => r.brandNames.includes(brandFilter))
    const arr = [...filtered]
    switch (sort) {
      case 'brands':
        arr.sort((a, b) => b.brands - a.brands || a.name.localeCompare(b.name))
        break
      case 'recent':
        arr.sort((a, b) => (b.setAt ?? '').localeCompare(a.setAt ?? '') || a.name.localeCompare(b.name))
        break
      case 'origin':
        // Folvy primero, luego Last
        arr.sort((a, b) => Number(b.sourceFolvy) - Number(a.sourceFolvy) || a.name.localeCompare(b.name))
        break
      default:
        arr.sort((a, b) => a.name.localeCompare(b.name))
    }
    return arr
  }, [rows, search, sort, brandFilter])

  async function handleReactivate(row: SoldOutRow) {
    if (!row.representativeMenuItemId) return
    setBusyRow(row.id); setError(null)
    try {
      await setProductAvailability(row.representativeMenuItemId, true, row.locationId)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error reactivando')
    } finally {
      setBusyRow(null)
    }
  }

  if (accountsLoading) {
    return <div className="p-8 text-stone-500">Cargando…</div>
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-stone-800">Disponibilidad</h1>
          <p className="text-[13px] text-stone-500 mt-0.5">Lo que está agotado ahora mismo</p>
        </div>
        <button
          onClick={() => setShowAgotar(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-sm font-medium"
          style={{ backgroundColor: ACCENT }}
        >
          <Plus size={18} /> Agotar producto
        </button>
      </div>

      <div className="flex gap-2.5 mb-5 flex-wrap items-center">
        <select
          value={locationId ?? ''}
          onChange={(e) => setLocationId(e.target.value || null)}
          className="min-w-[200px] border border-stone-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>Local: {l.name}</option>
          ))}
          <option value="">Todos los locales</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="min-w-[150px] border border-stone-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="az">Ordenar: A–Z</option>
          <option value="brands">Más marcas primero</option>
          <option value="recent">Más recientes</option>
          <option value="origin">Por origen</option>
        </select>
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="min-w-[150px] border border-stone-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">Marca: todas</option>
          {brandOptions.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[160px]">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto"
            className="w-full pl-8 pr-3 py-2 border border-stone-300 rounded-lg text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</div>
      )}

      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
        <span className="text-[13px] font-medium text-stone-500">
          Agotados en {locName} · {loading ? '…' : visible.length}
        </span>
      </div>

      {loading ? (
        <div className="py-10 text-center text-stone-400"><Loader2 size={20} className="animate-spin inline" /></div>
      ) : visible.length === 0 ? (
        <div className="py-10 text-center text-stone-400 text-sm">No hay productos agotados en {locName}.</div>
      ) : (
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
        >
          {visible.map((row) => (
            <div key={`${row.id}-${row.locationId ?? 'all'}`} className="bg-white border border-stone-200 rounded-lg px-3 py-2.5 flex flex-col">
              <div className="flex items-center justify-end mb-1.5">
                {row.sourceFolvy ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded text-white font-medium leading-none" style={{ backgroundColor: ACCENT }}>Folvy</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-medium leading-none">Last</span>
                )}
              </div>
              <div className="flex items-center gap-2 mb-1">
                {row.photoUrl ? (
                  <img src={row.photoUrl} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-stone-200" />
                ) : (
                  <div className="w-9 h-9 rounded-full flex-shrink-0 bg-stone-100 text-stone-400 flex items-center justify-center text-[13px] font-medium">
                    {row.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <p className="text-[13px] font-medium text-stone-800 leading-tight line-clamp-2 min-w-0" title={row.name}>{row.name}</p>
              </div>
              <p className="text-[11px] text-stone-500 mt-1">
                {row.brands} marca{row.brands === 1 ? '' : 's'}
              </p>
              {!locationId && row.locationName && (
                <p className="text-[11px] text-stone-400 truncate" title={row.locationName}>{row.locationName}</p>
              )}
              <p className="text-[11px] mt-0.5 mb-2">
                {row.availableUntil
                  ? <span className="text-amber-600">hasta {new Date(row.availableUntil).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                  : <span className="text-stone-400">indefinido</span>}
              </p>
              <button
                onClick={() => handleReactivate(row)}
                disabled={busyRow === row.id || !row.representativeMenuItemId}
                className="mt-auto w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-emerald-600 text-white text-[12px] font-medium hover:bg-emerald-700 disabled:opacity-40"
              >
                {busyRow === row.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Reactivar
              </button>
            </div>
          ))}
        </div>
      )}

      {showAgotar && activeAccountId && (
        <AgotarModal
          accountId={activeAccountId}
          locationId={locationId}
          locationName={locName}
          onClose={() => setShowAgotar(false)}
          onDone={async () => { setShowAgotar(false); await reload() }}
        />
      )}
    </div>
  )
}

// ─── Modal "Agotar producto" ──────────────────────────────────────────────────
function AgotarModal({ accountId, locationId, locationName, onClose, onDone }: {
  accountId: string
  locationId: string | null
  locationName: string
  onClose: () => void
  onDone: () => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<ProductPick[]>([])
  const [picked, setPicked] = useState<ProductPick | null>(null)
  const [scope, setScope] = useState<ScopePreview | null>(null)
  const [mode, setMode] = useState<'indefinido' | 'hoy'>('indefinido')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) { setResults([]); return }
      searchProducts(accountId, q).then(setResults).catch(() => setResults([]))
    }, 250)
    return () => clearTimeout(t)
  }, [q, accountId])

  async function pick(p: ProductPick) {
    setPicked(p); setScope(null); setErr(null)
    try {
      setScope(await previewScope(accountId, p.menuItemId, locationId))
    } catch {
      setScope({ brands: p.brands, channels: 0 })
    }
  }

  async function confirm() {
    if (!picked) return
    setSaving(true); setErr(null)
    try {
      await setProductAvailability(
        picked.menuItemId, false, locationId, 'manual',
        mode === 'hoy' ? endOfTodayIso() : null,
      )
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error agotando')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-medium text-stone-800">Agotar producto</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={18} /></button>
        </div>

        {!picked ? (
          <>
            <div className="relative mb-3">
              <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar producto a agotar"
                className="w-full pl-8 pr-3 py-2 border border-stone-300 rounded-lg text-sm" />
            </div>
            <div className="max-h-72 overflow-y-auto flex flex-col gap-1">
              {results.map((p) => (
                <button key={p.menuItemId} onClick={() => pick(p)}
                  className="text-left px-3 py-2 rounded-lg hover:bg-stone-50 border border-transparent hover:border-stone-200">
                  <span className="text-sm text-stone-800">{p.name}</span>
                  <span className="text-[12px] text-stone-400"> · {p.brands} marca{p.brands === 1 ? '' : 's'}</span>
                </button>
              ))}
              {q.trim().length >= 2 && results.length === 0 && (
                <p className="text-[13px] text-stone-400 px-3 py-2">Sin resultados.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 mb-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-amber-900">¿Agotar “{picked.name}” en {locationName}?</p>
                  <p className="text-amber-800 mt-0.5">
                    Se apagará <strong>AHORA, en producción</strong>, en{' '}
                    {scope ? <strong>{scope.brands} marca{scope.brands === 1 ? '' : 's'} · {scope.channels} canal{scope.channels === 1 ? '' : 'es'}</strong> : '…'} de Glovo / Uber / JustEat.
                  </p>
                  {locationId === null && (
                    <p className="text-amber-900 mt-1 font-medium">Atención: lo apagas en TODOS los locales.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mb-4 text-sm">
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={mode === 'indefinido'} onChange={() => setMode('indefinido')} />
                Indefinido
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={mode === 'hoy'} onChange={() => setMode('hoy')} />
                Solo hoy (reactiva a medianoche)
              </label>
            </div>

            {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-[13px] text-red-700">{err}</div>}

            <div className="flex gap-2 justify-end">
              <button onClick={() => { setPicked(null); setScope(null) }} disabled={saving}
                className="px-3 py-2 rounded-lg border border-stone-300 text-sm font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50">
                Atrás
              </button>
              <button onClick={confirm} disabled={saving}
                className="px-3 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
                style={{ backgroundColor: '#b45309' }}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                Sí, agotar en {locationName}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
