// src/modules/kitchen/pages/KitchenAvailabilityPage.tsx
//
// FRENTE 86 / DISPONIBILIDAD — panel de oficina (Carta).
// Lista lo agotado por LOCAL, reactiva, y agota productos con confirmación de
// alcance real ("se apaga AHORA en producción en N marcas · N canales de [LOCAL]").
// La cascada cross-brand + el empuje por local los hace la RPC en el servidor.
//
// C2 (31/07): envoltorio fino sobre AvailabilityBoard (layout compartido con
// TabletAvailabilityTab) + AgotarProductoModal (unificado con el de tablet).
// Cero cambio de comportamiento: mismas RPC, mismos flujos — solo tokens del
// sistema de diseño en vez del hex a medida que había antes, y estructura
// compartida.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, RefreshCw, Loader2, Clock, X } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listLocations, listSoldOut, searchProducts, previewScope, setProductAvailability,
  type LocationOption, type SoldOutRow,
} from '@/modules/kitchen/services/availabilityService'
import AvailabilityBoard from '@/modules/kds/components/AvailabilityBoard'
import AgotarProductoModal, { type AgotarProductoAdapter } from '@/modules/kds/components/AgotarProductoModal'
import BusinessHoursEditor from '@/modules/multitenancy/components/hours/BusinessHoursEditor'

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
  const [showHours, setShowHours] = useState(false)

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
      <div className="mb-6">
        <h1 className="text-lg font-medium text-stone-800">Disponibilidad</h1>
        <p className="text-[13px] text-stone-500 mt-0.5">Lo que está cerrado o agotado ahora mismo</p>
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
        <button
          onClick={() => setShowHours(true)}
          disabled={!locationId}
          title={locationId ? `Horario de ${locName}` : 'Elige un local para ver su horario'}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-40"
        >
          <Clock size={16} /> Horarios
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-bg p-3 text-[13px] text-danger">{error}</div>
      )}

      <AvailabilityBoard
        theme="light"
        accountId={activeAccountId}
        locationId={locationId}
        productsTitle={`Productos agotados en ${locName}`}
        productsCount={loading ? null : visible.length}
        productsAction={
          <button
            onClick={() => setShowAgotar(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-text-on-accent text-sm font-medium hover:bg-accent-hover"
          >
            <Plus size={18} /> Agotar producto
          </button>
        }
      >
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
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-text-on-accent font-medium leading-none">Folvy</span>
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
                    ? <span className="text-warning">hasta {new Date(row.availableUntil).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                    : <span className="text-stone-400">indefinido</span>}
                </p>
                <div className="mt-auto flex flex-col gap-1.5">
                  {row.sourceLast && (
                    <div
                      className="w-full text-center py-1.5 rounded-md bg-stone-100 text-stone-500 text-[11px] font-medium"
                      title="Este artículo viene de Last: Folvy ya no escribe ahí. Reactívalo desde Last."
                    >
                      Gestionar en Last
                    </div>
                  )}
                  {(!row.sourceLast || row.sourceFolvy) && (
                    <button
                      onClick={() => handleReactivate(row)}
                      disabled={busyRow === row.id || !row.representativeMenuItemId}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-success text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-40"
                    >
                      {busyRow === row.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      {row.sourceLast ? 'Reactivar en Folvy' : 'Reactivar'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </AvailabilityBoard>

      {showAgotar && activeAccountId && (
        <AgotarProductoModal
          theme="light"
          locationLabel={locName}
          allLocations={locationId === null}
          adapter={{
            searchProducts: (q) => searchProducts(activeAccountId, q),
            previewScope: (menuItemId) => previewScope(activeAccountId, menuItemId, locationId),
            agotar: async (menuItemId, until, reasonCode) => {
              await setProductAvailability(menuItemId, false, locationId, 'manual', until, reasonCode)
            },
          } satisfies AgotarProductoAdapter}
          onClose={() => setShowAgotar(false)}
          onDone={async () => { setShowAgotar(false); await reload() }}
        />
      )}

      {showHours && activeAccountId && locationId && (
        <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4" onClick={() => setShowHours(false)}>
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-medium text-stone-800">Horario de {locName}</h2>
              <button onClick={() => setShowHours(false)} className="text-stone-400 hover:text-stone-600"><X size={18} /></button>
            </div>
            <BusinessHoursEditor accountId={activeAccountId} locationId={locationId} brandId={null} />
          </div>
        </div>
      )}
    </div>
  )
}
