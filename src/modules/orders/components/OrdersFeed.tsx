// src/modules/orders/components/OrdersFeed.tsx
//
// El FEED de pedidos (lente "por pedido"). Rebrand 30/06/2026 — tema CLARO
// (gestión moderna tipo Otter/Deliverect): panel blanco, filtros en píldoras de
// tinta, contadores en Space Grotesk, kanban claro.
//
//   - Toggle CUADRÍCULA / POR ESTADO (kanban), filtros, contadores, polling + realtime.
//   - Sonido al entrar cualquier pedido nuevo accionable.
//   - RUTA COMPLETA: avanza el pedido vía advanceOrder (set_order_status). El empuje
//     al canal lo dispara el trigger trg_sale_push_status.
//   - ESCANDALLO: pulsar un plato con receta abre el Cook Mode (panel del KDS).
//   - MARCAR LÍNEA: check por plato (kds_mark_line, compartido con el KDS).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, Columns3, RefreshCw, Volume2, VolumeX } from 'lucide-react'
import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { playNewTicketSound } from '@/modules/kds/kdsUtils'
import { markLine as kdsMarkLine } from '@/modules/kds/services/kdsService'
import CookModePanel from '@/modules/kds/components/CookModePanel'
import {
  getOrdersFeed, advanceOrder, reprintOrder, isTerminalStatus,
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

// Semáforo de columnas kanban (marca nueva): verde fresco / ámbar en curso / tinta por aceptar.
const KANBAN: { key: string; label: string; dot: string; match: (s: OrderStatus) => boolean }[] = [
  { key: 'new',   label: 'Por aceptar',      dot: '#15171A', match: s => ['new','received'].includes(s) },
  { key: 'prep',  label: 'En preparación',   dot: '#C2890F', match: s => ['accepted','in_preparation'].includes(s) },
  { key: 'ready', label: 'Listos / reparto', dot: '#1F9D6B', match: s => ['awaiting_collection','awaiting_shipment','in_delivery'].includes(s) },
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

  const advance = useCallback(async (saleId: string, next: OrderStatus) => {
    try {
      await advanceOrder(saleId, next, token)
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el pedido')
    }
  }, [refresh])

  // Reimpresión: encola los tickets del pedido a las impresoras del local. Con
  // token (Estación) sale por la puerta by-token. Devuelve el nº de jobs (0 = el
  // local no tiene impresoras). No refresca: no cambia el estado del pedido.
  const reprint = useCallback(async (saleId: string): Promise<number> => {
    return reprintOrder(saleId, token)
  }, [token])

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
      <div className="rounded-2xl overflow-hidden border border-default bg-card text-text-primary flex flex-col h-[calc(100vh-9rem)] min-h-[520px]">
        {/* Cabecera */}
        <div className="flex items-center gap-4 px-5 py-3.5 border-b border-default">
          <div className="flex items-baseline gap-3 flex-1 min-w-0">
            <h1 className="font-display font-semibold text-[22px] leading-none tracking-tight">Pedidos</h1>
          </div>
          <div className="hidden sm:flex gap-4 text-text-secondary">
            <span className="flex items-baseline gap-1.5"><b className="font-display text-[19px] tabular-nums text-text-primary">{counts.nuevos}</b><span className="text-[11px] uppercase tracking-wide">nuevos</span></span>
            <span className="flex items-baseline gap-1.5"><b className="font-display text-[19px] tabular-nums text-text-primary">{counts.curso}</b><span className="text-[11px] uppercase tracking-wide">en curso</span></span>
            {counts.incidencias > 0 && (
              <span className="flex items-baseline gap-1.5"><b className="font-display text-[19px] tabular-nums text-danger">{counts.incidencias}</b><span className="text-[11px] uppercase tracking-wide">incidencias</span></span>
            )}
          </div>
          <button
            onClick={toggleSound}
            title={soundOn ? 'Sonido activado · tocar para silenciar' : 'Sonido silenciado · tocar para activar'}
            className={`p-2 rounded-lg border ${soundOn ? 'bg-page text-text-primary border-default' : 'bg-card text-text-secondary border-default'}`}
          >
            {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button onClick={() => void refresh()} title="Actualizar" className="p-2 rounded-lg bg-card text-text-secondary border border-default hover:text-text-primary hover:bg-page">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="flex bg-accent-bg rounded-xl p-0.5 gap-0.5">
            <button onClick={() => setView('grid')} className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 ${view === 'grid' ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary'}`}><LayoutGrid size={15} /> Cuadrícula</button>
            <button onClick={() => setView('kanban')} className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 ${view === 'kanban' ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary'}`}><Columns3 size={15} /> Por estado</button>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-1.5 px-5 py-3 border-b border-default overflow-x-auto">
          {(Object.keys(FILTERS) as FilterKey[]).map(k => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3.5 py-2 rounded-full text-[13.5px] font-bold whitespace-nowrap flex items-center gap-2 ${filter === k ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:text-text-primary'}`}
            >
              {FILTER_LABEL[k]}
              <span className={`text-[11px] font-extrabold px-1.5 py-px rounded-full tabular-nums ${filter === k ? 'bg-white/20 text-text-on-accent' : 'bg-accent-bg text-text-secondary'}`}>{filterCount(k)}</span>
            </button>
          ))}
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto p-5 bg-page">
          {error && (
            <div className="text-danger bg-danger-bg border border-danger/30 rounded-xl px-4 py-3 text-sm mb-4">{error}</div>
          )}

          {loading && orders.length === 0 ? (
            <div className="grid place-items-center h-[50vh] text-text-secondary">Cargando pedidos…</div>
          ) : filtered.length === 0 ? (
            <div className="grid place-items-center h-[50vh] text-center text-text-secondary">
              <div>
                <div className="font-display text-[22px] text-text-primary mb-2">Sin pedidos ahora mismo</div>
                <div className="text-sm">Entran solos en cuanto lleguen. Los nuevos sin aceptar aparecen arriba.</div>
              </div>
            </div>
          ) : view === 'grid' ? (
            <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
              {filtered.map(o => <OrderCard key={o.sale_id} order={o} allowGrow onAdvance={advance} onOpenRecipe={openRecipe} onMarkLine={markLineHandler} onReprint={reprint} />)}
            </div>
          ) : (
            <div className="grid gap-4 h-full" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {KANBAN.map(col => {
                const list = filtered.filter(o => col.match(o.order_status))
                return (
                  <div key={col.key} className="bg-card border border-default rounded-2xl flex flex-col min-h-0">
                    <div className="px-4 py-3 border-b border-default flex items-center gap-2.5 font-extrabold text-[14px] text-text-primary">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.dot }} />
                      {col.label}
                      <span className="ml-auto bg-accent-bg text-text-secondary text-[12px] font-extrabold px-2 py-px rounded-full tabular-nums">{list.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 bg-page">
                      {list.map(o => <OrderCard key={o.sale_id} order={o} allowGrow={false} onAdvance={advance} onOpenRecipe={openRecipe} onMarkLine={markLineHandler} onReprint={reprint} />)}
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
