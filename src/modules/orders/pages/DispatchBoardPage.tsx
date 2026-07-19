// src/modules/orders/pages/DispatchBoardPage.tsx
//
// Board del dispatcher (reparto en vivo). Lente "por ENTREGA" del mismo feed que
// alimenta Pedidos (orders_feed). Foco de oficina: qué entregas necesitan acción
// (sin despachar / fallo / buscando repartidor) y cuáles están en curso, con el
// COSTE REAL de reparto a la vista (transport_price) — el foso: Onfleet mueve
// cajas sin saber si te dejan dinero; aquí se ve por pedido.
//
// Reutiliza: getOrdersFeed, deliveryView, isOwnDeliveryUndispatched, dispatchOrder.
// Mapa Mapbox opcional (riders en vivo desde rider_lat/lng del feed).

import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MapPin, RefreshCw, Bike, Phone, AlertTriangle } from 'lucide-react'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import {
  getOrdersFeed, deliveryView, isOwnDeliveryUndispatched, dispatchOrder, isTerminalStatus,
  type OrderFeedItem,
} from '../services/ordersFeedService'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const POLL_MS = 10_000

function eur(n: number | null | undefined): string { return n == null ? '—' : n.toFixed(2).replace('.', ',') + ' €' }
function code(o: OrderFeedItem): string { return o.pos_short_code || o.platform_order_code || o.external_tab_ref || o.external_ref || '—' }

// ¿Es una entrega que nos importa en el board? (reparto propio o con transportista).
function isDelivery(o: OrderFeedItem): boolean {
  const st = (o.service_type ?? '').toLowerCase()
  return !!o.carrier_code || st.includes('own_delivery') || (st.includes('delivery') && !st.includes('platform'))
}
// ¿Necesita acción del despachador?
function needsAttention(o: OrderFeedItem): boolean {
  if (isOwnDeliveryUndispatched(o)) return true
  if (o.dispatch_error) return true
  const ds = (o.delivery_state ?? '').toLowerCase()
  return ['matching', 'pending', 'searching', 'created'].includes(ds)
}
function vehEmoji(t: string | null): string {
  const v = (t ?? '').toLowerCase()
  if (v.includes('bici') || v.includes('bike')) return '\u{1F6B2}'
  if (v.includes('coche') || v.includes('car')) return '\u{1F697}'
  return '\u{1F6F5}'
}

export default function DispatchBoardPage() {
  const { resolvedLocationId, isConsolidated } = useLocationScope()
  if (isConsolidated || !resolvedLocationId) {
    return (
      <div className="grid place-items-center h-[60vh] text-center text-text-secondary">
        <div>
          <MapPin className="mx-auto mb-3 text-text-secondary" size={32} />
          <p className="text-lg font-medium text-text-primary">Selecciona un local</p>
          <p className="text-sm mt-1">El despacho es por local. Elige uno en el selector de arriba.</p>
        </div>
      </div>
    )
  }
  return <DispatchBoard locationId={resolvedLocationId} />
}

function DispatchBoard({ locationId }: { locationId: string }) {
  const [orders, setOrders] = useState<OrderFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())

  const refresh = useCallback(async () => {
    try {
      const res = await getOrdersFeed(locationId)
      setOrders((res.orders ?? []).filter(o => isDelivery(o) && !isTerminalStatus(o.order_status)))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando el despacho')
    } finally { setLoading(false) }
  }, [locationId])

  useEffect(() => { setLoading(true); void refresh() }, [refresh])
  useEffect(() => { const id = window.setInterval(() => void refresh(), POLL_MS); return () => window.clearInterval(id) }, [refresh])
  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) return
    const ch = supabase.channel(`dispatch-${locationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignment' }, () => void refresh())
      .subscribe()
    return () => { void supabase!.removeChannel(ch) }
  }, [locationId, refresh])

  // Mapa: riders en vivo (rider_lat/lng del feed).
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return
    const withPos = orders.filter(o => o.rider_lat != null && o.rider_lng != null)
    if (!mapRef.current) {
      const center: [number, number] = withPos.length ? [withPos[0].rider_lng!, withPos[0].rider_lat!] : [-3.70, 40.42]
      mapboxgl.accessToken = MAPBOX_TOKEN
      mapRef.current = new mapboxgl.Map({ container: containerRef.current, style: 'mapbox://styles/mapbox/streets-v12', center, zoom: 12 })
    }
    const map = mapRef.current
    const seen = new Set<string>()
    for (const o of withPos) {
      seen.add(o.sale_id)
      const lngLat: [number, number] = [o.rider_lng!, o.rider_lat!]
      const existing = markersRef.current.get(o.sale_id)
      if (existing) existing.setLngLat(lngLat)
      else {
        const el = document.createElement('div')
        el.style.cssText = 'width:30px;height:30px;border-radius:50%;background:#1F9D6B;display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.3);font-size:15px;border:2px solid #fff'
        el.textContent = vehEmoji(o.rider_transport_type)
        markersRef.current.set(o.sale_id, new mapboxgl.Marker(el).setLngLat(lngLat).addTo(map))
      }
    }
    for (const [id, mk] of markersRef.current) { if (!seen.has(id)) { mk.remove(); markersRef.current.delete(id) } }
    if (withPos.length) {
      const b = new mapboxgl.LngLatBounds()
      withPos.forEach(o => b.extend([o.rider_lng!, o.rider_lat!]))
      map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 500 })
    }
  }, [orders])
  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null }, [])

  const atencion = orders.filter(needsAttention)
  const enCurso = orders.filter(o => !needsAttention(o) && !!o.carrier_code)
  const costeEnCurso = enCurso.reduce((s, o) => s + (o.transport_price ?? 0), 0)

  return (
    <div className="rounded-2xl overflow-hidden border border-default bg-card text-text-primary flex flex-col h-[calc(100vh-9rem)] min-h-[520px]">
      <div className="flex items-center gap-4 px-5 py-3.5 border-b border-default">
        <h1 className="font-display font-semibold text-[22px] leading-none tracking-tight flex-1">Despacho en vivo</h1>
        <div className="hidden sm:flex gap-4 text-text-secondary">
          {atencion.length > 0 && <span className="flex items-baseline gap-1.5"><b className="font-display text-[19px] tabular-nums text-danger">{atencion.length}</b><span className="text-[11px] uppercase tracking-wide">atención</span></span>}
          <span className="flex items-baseline gap-1.5"><b className="font-display text-[19px] tabular-nums text-text-primary">{enCurso.length}</b><span className="text-[11px] uppercase tracking-wide">en curso</span></span>
          <span className="flex items-baseline gap-1.5"><b className="font-display text-[19px] tabular-nums text-text-primary">{eur(costeEnCurso)}</b><span className="text-[11px] uppercase tracking-wide">coste reparto</span></span>
        </div>
        <button onClick={() => void refresh()} title="Actualizar" className="p-2 rounded-lg bg-card text-text-secondary border border-default hover:text-text-primary hover:bg-page">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {MAPBOX_TOKEN && (
        <div ref={containerRef} className="h-[34%] min-h-[180px] border-b border-default" />
      )}

      <div className="flex-1 overflow-y-auto p-5 bg-page">
        {error && <div className="text-danger bg-danger-bg border border-danger/30 rounded-xl px-4 py-3 text-sm mb-4">{error}</div>}
        {loading && orders.length === 0 ? (
          <div className="grid place-items-center h-[40vh] text-text-secondary">Cargando despacho…</div>
        ) : orders.length === 0 ? (
          <div className="grid place-items-center h-[40vh] text-center text-text-secondary">
            <div><div className="font-display text-[22px] text-text-primary mb-2">Sin entregas activas</div><div className="text-sm">Las entregas de reparto propio aparecen aquí en cuanto entran.</div></div>
          </div>
        ) : (
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            {/* Atención */}
            <div>
              <div className="flex items-center gap-2 mb-3 font-extrabold text-[14px] text-text-primary">
                <span className="w-2.5 h-2.5 rounded-full bg-danger" /> Atención
                <span className="ml-auto bg-accent-bg text-text-secondary text-[12px] font-extrabold px-2 py-px rounded-full tabular-nums">{atencion.length}</span>
              </div>
              {atencion.length === 0 ? <p className="text-xs text-text-secondary">Nada pendiente. 👌</p> : (
                <div className="space-y-2.5">{atencion.map(o => <AttentionRow key={o.sale_id} order={o} onDone={refresh} />)}</div>
              )}
            </div>
            {/* En curso */}
            <div>
              <div className="flex items-center gap-2 mb-3 font-extrabold text-[14px] text-text-primary">
                <span className="w-2.5 h-2.5 rounded-full bg-success" /> En curso
                <span className="ml-auto bg-accent-bg text-text-secondary text-[12px] font-extrabold px-2 py-px rounded-full tabular-nums">{enCurso.length}</span>
              </div>
              {enCurso.length === 0 ? <p className="text-xs text-text-secondary">Ninguna entrega en curso.</p> : (
                <div className="space-y-2.5">{enCurso.map(o => <ProgressRow key={o.sale_id} order={o} />)}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Fila "Atención": sin despachar / fallo / buscando → con acción de despacho.
function AttentionRow({ order, onDone }: { order: OrderFeedItem; onDone: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const d = deliveryView(order)
  const undispatched = isOwnDeliveryUndispatched(order)
  const failed = !!order.dispatch_error
  async function doDispatch() {
    if (busy) return
    setBusy(true); setErr(null)
    try { await dispatchOrder(order.sale_id); await onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo despachar.') }
    finally { setBusy(false) }
  }
  return (
    <div className={`rounded-xl border overflow-hidden ${failed ? 'border-danger/40 bg-danger-bg' : 'border-warning/40 bg-warning-bg'}`}>
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-[15px] text-text-primary">{order.brand ?? 'Pedido'}</span>
          <span className="text-[12px] text-text-secondary font-mono">{code(order)}</span>
          <span className="ml-auto text-[13px] font-bold tabular-nums text-text-primary">{eur(order.total)}</span>
        </div>
        <div className="text-[12px] text-text-secondary mt-0.5">
          {undispatched ? 'Reparto propio sin despachar' : failed ? 'Fallo de despacho' : d.stateLabel ?? 'Buscando repartidor'}
          {order.delivery_address ? ` · ${order.delivery_address}` : ''}
        </div>
        {(err || order.dispatch_error) && (
          <div className="flex items-start gap-1.5 text-[12px] text-danger mt-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{err ?? order.dispatch_error}</div>
        )}
      </div>
      {(undispatched || failed) && (
        <button onClick={doDispatch} disabled={busy}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 text-[13.5px] font-bold disabled:opacity-60 border-t ${failed ? 'text-white bg-danger border-danger/20' : 'text-[#2563A8] border-warning/30'}`}>
          {busy ? <><RefreshCw size={15} className="animate-spin" /> Despachando…</> : failed ? <><RefreshCw size={15} /> Reintentar despacho</> : <><Bike size={16} /> Despachar a Catcher</>}
        </button>
      )}
    </div>
  )
}

// Fila "En curso": despachada, con rider + estado + coste + llamar.
function ProgressRow({ order }: { order: OrderFeedItem }) {
  const d = deliveryView(order)
  const toneCls = d.stateTone === 'done' ? 'text-success bg-success-bg border-success/30'
    : d.stateTone === 'failed' ? 'text-danger bg-danger-bg border-danger/30'
    : d.stateTone === 'pending' ? 'text-warning bg-warning-bg border-warning/30'
    : 'text-success bg-success-bg border-success/30'
  return (
    <div className="rounded-xl border border-default bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-display font-bold text-[15px] text-text-primary">{order.brand ?? 'Pedido'}</span>
        <span className="text-[12px] text-text-secondary font-mono">{code(order)}</span>
        {d.stateLabel && <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full border ${toneCls}`}>{d.stateLabel}</span>}
        <span className="ml-auto text-[12px] text-text-secondary">{d.carrierLabel}</span>
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-[12.5px] text-text-secondary">
        <span>{vehEmoji(d.transport)} {d.rider ?? 'Sin rider aún'}</span>
        {d.etaText && <span>· llega en {d.etaText}</span>}
        <span className="ml-auto font-semibold text-text-primary">Reparto: {eur(order.transport_price)}</span>
      </div>
      {d.phone && (
        <a href={`tel:${d.phone.replace(/\s+/g, '')}`} className="mt-2 inline-flex items-center gap-1.5 bg-[#15171A] text-white px-3 py-1.5 rounded-full text-[12.5px] font-bold no-underline">
          <Phone size={12} /> {d.phone}
        </a>
      )}
    </div>
  )
}
