// src/modules/tablet/TabletAvailabilityTab.tsx
//
// Pestaña DISPONIBILIDAD (86) de la Estación de Tablet. Panel completo por token,
// estilo oscuro y táctil (botones grandes). Opción (a): mantiene la confirmación
// de alcance ("N marcas · N canales") antes de agotar, porque afecta a la venta
// real en plataformas.
//
// Flujo: lista de agotados (reactivar) + botón "Agotar producto" (buscar →
// confirmar alcance → agotar). El local es el del dispositivo (no hay selector).
//
// C2 (31/07): cuerpo (Local y marcas + Productos) sobre AvailabilityBoard,
// compartido con KitchenAvailabilityPage (web) — misma jerarquía, mismo orden.
// La barra superior (título, refrescar, cerrar marca, agotar) se queda IGUAL
// que hoy, según el encargo. El hex a medida que había antes se sustituye por
// ámbar de Tailwind (mismo tono, ya usado en esta pantalla para avisos).

import { useCallback, useEffect, useState } from 'react'
import { CircleOff, Plus, RefreshCw, Loader2 } from 'lucide-react'
import {
  listSoldOut, searchProducts, previewScopeBulk, setProductAvailability, setProductsAvailabilityBulk,
  type SoldOutRow,
} from './services/tabletAvailabilityService'
import AvailabilityBoard from '@/modules/kds/components/AvailabilityBoard'
import AgotarProductoModal, { type AgotarProductoAdapter } from '@/modules/kds/components/AgotarProductoModal'
import BrandCloseControl from '@/modules/kds/components/BrandCloseControl'

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

  const agotarAdapter: AgotarProductoAdapter = {
    searchProducts: (q) => searchProducts(token, q),
    previewScopeBulk: (menuItemIds) => previewScopeBulk(token, menuItemIds),
    agotarBulk: async (menuItemIds, until, reasonCode) => {
      const result = await setProductsAvailabilityBulk(token, menuItemIds, false, 'manual', until, reasonCode)
      if (result.failed.length > 0) {
        throw new Error(
          `${result.failed.length} de ${menuItemIds.length} no se pudieron agotar: ${result.failed.map((f) => f.error).join('; ')}`,
        )
      }
    },
  }

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
          <BrandCloseControl token={token} dark />
          <button
            onClick={() => setShowAgotar(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 text-zinc-950 font-bold hover:bg-amber-400"
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

      {/* Local y marcas + Productos (layout compartido con web) */}
      <div className="flex-1 overflow-y-auto p-5">
        <AvailabilityBoard
          theme="dark"
          token={token}
          locationId={null}
          productsTitle="Productos agotados ahora"
          productsCount={loading ? null : rows.length}
        >
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
                        <span className={`ml-2 px-1.5 py-px rounded text-[10px] font-bold ${row.sourceFolvy ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-800 text-zinc-500'}`}>
                          {row.sourceFolvy ? 'Folvy' : 'Last'}
                        </span>
                      </p>
                    </div>
                  </div>
                  {row.sourceLast && (
                    <div className="w-full text-center py-2 rounded-lg bg-zinc-800 text-zinc-400 text-xs font-semibold">
                      Gestionar en Last
                    </div>
                  )}
                  {(!row.sourceLast || row.sourceFolvy) && (
                    <button
                      onClick={() => void handleReactivar(row)}
                      disabled={busyId === row.id || !row.representativeMenuItemId}
                      className="w-full py-2.5 rounded-lg bg-success text-white font-bold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {busyId === row.id ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      {row.sourceLast ? 'Reactivar en Folvy' : 'Reactivar'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </AvailabilityBoard>
      </div>

      {showAgotar && (
        <AgotarProductoModal
          theme="dark"
          locationLabel={locationName}
          adapter={agotarAdapter}
          onClose={() => setShowAgotar(false)}
          onDone={() => { setShowAgotar(false); void refresh() }}
        />
      )}
    </div>
  )
}
