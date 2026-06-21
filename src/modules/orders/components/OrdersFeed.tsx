// src/modules/orders/components/OrdersFeed.tsx
//
// El FEED de pedidos (lente "por pedido"). Tablero navy con:
//   - Toggle CUADRÍCULA / POR ESTADO (kanban), filtros, contadores, polling + realtime.
//   - Sonido al entrar cualquier pedido nuevo accionable.
//   - RUTA COMPLETA: avanza el pedido vía advanceOrder (set_order_status). El empuje
//     al canal lo dispara el trigger trg_sale_push_status (vía única, también desde
//     cocina-kiosco).
//   - ESCANDALLO: pulsar un plato con receta abre el Cook Mode (panel del KDS).
//   - MARCAR LÍNEA: check por plato (kds_mark_line, compartido con el KDS).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, Columns3, RefreshCw, Volume2, VolumeX } from 'lucide-react'
import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { playNewTicketSound } from '@/modules/kds/kdsUtils'
import { markLine as kdsMarkLine } from '@/modules/kds/services/kdsService'
import CookModePanel from '@/modules/kds/components/CookModePanel'
import {
  getOrdersFeed, advanceOrder, isTerminalStatus,
  type OrderFeedItem, type OrderFeedLine, type OrderStatus,
} from '../services/ordersFeedService'
import OrderCard from './OrderCard'

const POLL_MS = 10_000

type FilterKey = 'activos' | 'nuevos' | 'curso' | 'cerrados' | 'incidencias'
type ViewKey = 'grid' | 'kanban'

interface CookTarget { menuItemId: string; qty: number; name: string }

const FILTERS: Record<FilterKey, (s: OrderStatus) => boolean> = {
  activos:     s => ['new','received','accepted','in_preparation','awaiting_collection','awaiting_shipment','in_delivery'].includes(s),
  nuevos:      s => ['new','received'].includes(s),
  curso:       s => ['accepted','in_preparation','awaiting_collection','awaiting_shipment','in_delivery'].includes(s),
  cerrados:    s => s === 'completed',
  incidencias: s => ['rejected','cancelled','delivery_failed'].includes(s),
}

const FILTER_LABEL: Record<FilterKey, string> = {
  activos: 'Activos', nuevos: 'Nuevos', curso: 'En curso', cerrados: 'Cerrados', incidencias: 'Incidencias',
}

const KANBAN: { key: string; label: string; dot: string; match: (s: OrderStatus) => boolean }[] = [
  { key: 'new',   label: 'Por aceptar',     dot: '#D67442', match: s => ['new','received'].includes(s) },
  { key: 'prep',  label: 'En preparación',  dot: '#e0a33e', match: s => ['accepted','in_preparation'].includes(s) },
  { key: 'ready', label: 'Listos / reparto', dot: '#3ba776', match: s => ['awaiting_collection','awaiting_shipment','in_delivery'].includes(s) },
]

function isNew(s: OrderStatus): boolean { return ['new','received'].includes(s) }

function sortOrders(a: OrderFeedItem, b: OrderFeedItem): number {
  const na = isNew(a.order_status) ? 0 : 1
  const nb = isNew(b.order_status) ? 0 : 1
  if (na !== nb) return na - nb
  return b.minutos - a.minutos
}

interface OrdersFeedProps { locationId: string; token?: string | null }

export default function OrdersFeed({ locationId, token }: OrdersFeedProps) {
  const [orders, setOrders] = useState<OrderFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewKey>('grid')
  const [filter, setFilter] = useState<FilterKey>('activos')
  const [soundOn, setSoundOn] = useState(true)
  const [cook, setCook] = useState<CookTarget | null>(null)
  const knownIds = useRef<Set<string>>(new Set())
  const firstLoad = useRef(true)
  const soundRef = useRef(true)
  soundRef.current = soundOn

  const refresh = useCallback(async () => {
    try {
      const res = await getOrdersFeed(locationId, token)
      const next = res.orders ?? []
      if (soundRef.current && !firstLoad.current) {
        const fresh = next.some(o => !knownIds.current.has(o.sale_id) && !isTerminalStatus(o.order_status))
        if (fresh) playNewTicketSound()
      }
      knownIds.current = new Set(next.map(o => o.sale_id))
      firstLoad.current = false
      setOrders(next)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando los pedidos')
    } finally {
      setLoading(false)
    }
  }, [locationId, token])

  // Avanza el estado interno; el empuje al canal lo dispara el trigger en BBDD.
  const advance = useCallback(async (saleId: string, next: OrderStatus) => {
    try {
      await advanceOrder(saleId, next, token)
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el pedido')
    }
  }, [refresh])

  const openRecipe = useCallback((line: OrderFeedLine) => {
    if (!line.menu_item_id) return
    setCook({ menuItemId: line.menu_item_id, qty: line.qty, name: line.name })
  }, [])

  const markLineHandler = useCallback(async (lineId: string) => {
    try {
      await kdsMarkLine(lineId, token)
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar la línea')
    }
  }, [refresh])

  useEffect(() => {
    firstLoad.current = true
    setLoading(true)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  useEffect(() => {
    const id = window.setInterval(() => { void refresh() }, POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (token) return
    if (!isSupabaseEnabled || !supabase) return
    const ch = supabase
      .channel(`orders-feed-${locationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale' }, () => { void refresh() })
      .subscribe()
    return () => { void supabase!.removeChannel(ch) }
  }, [locationId, token, refresh])

  const counts = useMemo(() => ({
    nuevos: orders.filter(o => FILTERS.nuevos(o.order_status)).length,
    curso: orders.filter(o => FILTERS.curso(o.order_status)).length,
    incidencias: orders.filter(o => FILTERS.incidencias(o.order_status)).length,
  }), [orders])

  const filtered = useMemo(
    () => orders.filter(o => FILTERS[filter](o.order_status)).sort(sortOrders),
    [orders, filter]
  )

  const filterCount = (k: FilterKey) => orders.filter(o => FILTERS[k](o.order_status)).length

  const toggleSound = () => {
    setSoundOn(prev => {
      const nv = !prev
      if (nv) playNewTicketSound()
      return nv
    })
  }

  return (
    <>
      <div className="rounded-2xl overflow-hidden ring-1 ring-[#243a48] bg-[#0e1820] text-[#f2efe9] flex flex-col h-[calc(100vh-9rem)] min-h-[520px]">
        {/* Cabecera */}
        <div className="flex items-center gap-4 px-5 py-3.5 border-b border-[#243a48]">
          <div className="flex items-baseline gap-3 flex-1 min-w-0">
            <h1 className="font-serif font-semibold text-[24px] leading-none" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>Pedidos</h1>
          </div>
          <div className="hidden sm:flex gap-4 text-[#93a6b3]">
            <span className="flex items-baseline gap-1.5"><b className="font-serif text-[19px] tabular-nums text-[#f2efe9]" style={{ fontFamily: 'Fraunces, serif' }}>{counts.nuevos}</b><span className="text-[11px] uppercase tracking-wide">nuevos</span></span>
            <span className="flex items-baseline gap-1.5"><b className="font-serif text-[19px] tabular-nums text-[#f2efe9]" style={{ fontFamily: 'Fraunces, serif' }}>{counts.curso}</b><span className="text-[11px] uppercase tracking-wide">en curso</span></span>
            {counts.incidencias > 0 && (
              <span className="flex items-baseline gap-1.5"><b className="font-serif text-[19px] tabular-nums text-[#f4999c]" style={{ fontFamily: 'Fraunces, serif' }}>{counts.incidencias}</b><span className="text-[11px] uppercase tracking-wide">incidencias</span></span>
            )}
          </div>
          <button
            onClick={toggleSound}
            title={soundOn ? 'Sonido activado · tocar para silenciar' : 'Sonido silenciado · tocar para activar'}
            className={`p-2 rounded-lg ring-1 ${soundOn ? 'bg-[#1d3242] text-[#f2efe9] ring-[#2c4a6e]' : 'bg-[#16242f] text-[#5f7280] ring-[#243a48]'}`}
          >
            {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button onClick={() => void refresh()} title="Actualizar" className="p-2 rounded-lg bg-[#16242f] text-[#93a6b3] ring-1 ring-[#243a48] hover:text-[#f2efe9]">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="flex bg-[#16242f] ring-1 ring-[#243a48] rounded-xl p-0.5 gap-0.5">
            <button onClick={() => setView('grid')} className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 ${view === 'grid' ? 'bg-[#1d3242] text-[#f2efe9]' : 'text-[#93a6b3]'}`}><LayoutGrid size={15} /> Cuadrícula</button>
            <button onClick={() => setView('kanban')} className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 ${view === 'kanban' ? 'bg-[#1d3242] text-[#f2efe9]' : 'text-[#93a6b3]'}`}><Columns3 size={15} /> Por estado</button>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-1.5 px-5 py-3 border-b border-[#243a48] overflow-x-auto">
          {(Object.keys(FILTERS) as FilterKey[]).map(k => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3.5 py-2 rounded-full text-[13.5px] font-bold whitespace-nowrap flex items-center gap-2 ${filter === k ? 'bg-[#1E3A5F] text-[#f2efe9] ring-1 ring-[#2c4a6e]' : 'text-[#93a6b3] hover:text-[#f2efe9]'}`}
            >
              {FILTER_LABEL[k]}
              <span className={`text-[11px] font-extrabold px-1.5 py-px rounded-full tabular-nums ${filter === k ? 'bg-[#D67442] text-[#1a1208]' : 'bg-[#1d3242] text-[#93a6b3]'}`}>{filterCount(k)}</span>
            </button>
          ))}
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="text-[#f4999c] bg-[#e5484d]/[0.12] border border-[#e5484d]/30 rounded-xl px-4 py-3 text-sm mb-4">{error}</div>
          )}

          {loading && orders.length === 0 ? (
            <div className="grid place-items-center h-[50vh] text-[#5f7280]">Cargando pedidos…</div>
          ) : filtered.length === 0 ? (
            <div className="grid place-items-center h-[50vh] text-center text-[#93a6b3]">
              <div>
                <div className="font-serif text-[22px] text-[#f2efe9] mb-2" style={{ fontFamily: 'Fraunces, serif' }}>Sin pedidos ahora mismo</div>
                <div className="text-sm">Entran solos en cuanto lleguen. Los nuevos sin aceptar aparecen arriba.</div>
              </div>
            </div>
          ) : view === 'grid' ? (
            <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
              {filtered.map(o => <OrderCard key={o.sale_id} order={o} allowGrow onAdvance={advance} onOpenRecipe={openRecipe} onMarkLine={markLineHandler} />)}
            </div>
          ) : (
            <div className="grid gap-4 h-full" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {KANBAN.map(col => {
                const list = filtered.filter(o => col.match(o.order_status))
                return (
                  <div key={col.key} className="bg-black/[0.18] ring-1 ring-[#243a48] rounded-2xl flex flex-col min-h-0">
                    <div className="px-4 py-3 border-b border-[#243a48] flex items-center gap-2.5 font-extrabold text-[14px]">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.dot }} />
                      {col.label}
                      <span className="ml-auto bg-[#1d3242] text-[#93a6b3] text-[12px] font-extrabold px-2 py-px rounded-full tabular-nums">{list.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
                      {list.map(o => <OrderCard key={o.sale_id} order={o} allowGrow={false} onAdvance={advance} onOpenRecipe={openRecipe} onMarkLine={markLineHandler} />)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Cook Mode (reusa el panel del KDS) — sesión, sin token */}
      <CookModePanel target={cook} onClose={() => setCook(null)} token={token} locationId={locationId} />
    </>
  )
}
