// src/modules/orders/pages/DispatchBoardPage.tsx
//
// Despacho — la superficie para OPERAR el reparto propio (el canal que te saca de
// la comisión de plataforma). No es un mapa de riders decorativo: es la herramienta
// para despachar, seguir y decidir la entrega, con el GANCHO ECONÓMICO delante:
// cuánto AHORRAS por entregar tú en vez de pagar ~30% a la plataforma. Útil desde
// el pedido nº1 — es lo que HABILITA que el reparto propio crezca.
//
// Foco: pedidos de REPARTO PROPIO (own_delivery). Los de plataforma se cuentan
// aparte (los reparte la plataforma; no hay nada que despachar).
//
// Reutiliza: getOrdersFeed, deliveryView, isOwnDeliveryUndispatched, dispatchOrder,
// y reparto_settings() para los repartidores en turno.

import { useCallback, useEffect, useState } from 'react'
import { MapPin, RefreshCw, Bike, Phone, AlertTriangle, PiggyBank, UserRound } from 'lucide-react'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import {
  getOrdersFeed, deliveryView, isOwnDeliveryUndispatched, dispatchOrder, isTerminalStatus,
  type OrderFeedItem,
} from '../services/ordersFeedService'

const POLL_MS = 10_000
const PLATFORM_COMMISSION = 0.30   // comisión típica de plataforma (aprox., para el comparativo)
const OWN_COST_EST = 3.30          // coste de última milla estimado si aún no llegó el real

function eur(n: number | null | undefined): string { return n == null ? '—' : n.toFixed(2).replace('.', ',') + ' €' }
function code(o: OrderFeedItem): string { return o.pos_short_code || o.platform_order_code || o.external_tab_ref || o.external_ref || '—' }
function vehEmoji(t: string | null): string {
  const v = (t ?? '').toLowerCase()
  if (v.includes('bici') || v.includes('bike')) return '\u{1F6B2}'
  if (v.includes('coche') || v.includes('car')) return '\u{1F697}'
  return '\u{1F6F5}'
}
// Ahorro de hacer la entrega tú vs pagar comisión de plataforma en ese pedido.
function saving(o: OrderFeedItem): number {
  const comm = (o.total ?? 0) * PLATFORM_COMMISSION
  const own = o.transport_price ?? OWN_COST_EST
  return Math.max(0, comm - own)
}
function ownCost(o: OrderFeedItem): number { return o.transport_price ?? OWN_COST_EST }

// Reparto propio activo (lo que se opera aquí).
function isActiveOwn(o: OrderFeedItem): boolean {
  if ((o.service_type ?? '') !== 'own_delivery') return false
  if (isTerminalStatus(o.order_status)) return false
  const ds = (o.delivery_state ?? '').toLowerCase()
  return !['delivered', 'canceled', 'cancelled', 'finish', 'failed'].includes(ds)
}
function needsDispatch(o: OrderFeedItem): boolean {
  return isOwnDeliveryUndispatched(o) || !!o.dispatch_error
}

interface Courier { id: string; name?: string; transport_type?: string | null; on_shift?: boolean; active?: boolean; assigned_locations?: string[] | null }

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
  const [couriers, setCouriers] = useState<Courier[]>([])
  const [platformCount, setPlatformCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await getOrdersFeed(locationId)
      const all = res.orders ?? []
      setPlatformCount(all.filter(o => (o.service_type ?? '').includes('platform') && !isTerminalStatus(o.order_status)).length)
      setOrders(all.filter(isActiveOwn))
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

  // Repartidores en turno (flota propia) para este local.
  useEffect(() => {
    if (!supabase) return
    let stop = false
    ;(async () => {
      const { data } = await (supabase!.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: { couriers?: Courier[] } | null }>)('reparto_settings', {})
      if (stop || !data) return
      const cs = (data.couriers ?? []).filter(c => c.active !== false && (!c.assigned_locations?.length || c.assigned_locations.includes(locationId)))
      setCouriers(cs)
    })()
    return () => { stop = true }
  }, [locationId])

  const porDespachar = orders.filter(needsDispatch)
  const enCurso = orders.filter(o => !needsDispatch(o) && !!o.carrier_code)
  const onShift = couriers.filter(c => c.on_shift)
  const ahorroActivo = orders.reduce((s, o) => s + saving(o), 0)

  return (
    <div className="rounded-2xl overflow-hidden border border-default bg-card text-text-primary flex flex-col h-[calc(100vh-9rem)] min-h-[520px]">
      {/* Cabecera + KPIs */}
      <div className="flex items-center gap-4 px-5 py-3.5 border-b border-default flex-wrap">
        <h1 className="font-display font-semibold text-[22px] leading-none tracking-tight flex-1 min-w-[160px]">Despacho · reparto propio</h1>
        <div className="flex gap-5 text-text-secondary items-center">
          <span className="flex items-baseline gap-1.5"><b className="font-display text-[19px] tabular-nums text-text-primary">{orders.length}</b><span className="text-[11px] uppercase tracking-wide">propias activas</span></span>
          <span className="flex items-baseline gap-1.5"><b className="font-display text-[19px] tabular-nums text-text-primary">{onShift.length}</b><span className="text-[11px] uppercase tracking-wide">en turno</span></span>
          <span className="flex items-baseline gap-1.5" title="Lo que te ahorras entregando tú en vez de pagar comisión de plataforma">
            <b className="font-display text-[19px] tabular-nums text-success">{eur(ahorroActivo)}</b><span className="text-[11px] uppercase tracking-wide">ahorro vs plataforma</span>
          </span>
        </div>
        <button onClick={() => void refresh()} title="Actualizar" className="p-2 rounded-lg bg-card text-text-secondary border border-default hover:text-text-primary hover:bg-page">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Repartidores en turno */}
      <div className="px-5 py-2.5 border-b border-default flex items-center gap-2 flex-wrap bg-page">
        <span className="text-[11px] uppercase tracking-wide text-text-secondary font-bold mr-1">Repartidores</span>
        {onShift.length === 0 ? (
          <span className="text-[12.5px] text-text-secondary">Ninguno en turno · las entregas se despachan a Catcher.</span>
        ) : onShift.map(c => (
          <span key={c.id} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold bg-success-bg text-success border border-success/30 rounded-full px-2.5 py-1">
            <UserRound size={12} /> {vehEmoji(c.transport_type ?? null)} {c.name}
          </span>
        ))}
        {platformCount > 0 && <span className="ml-auto text-[12px] text-text-secondary">· {platformCount} pedidos los reparte la plataforma</span>}
      </div>

      {/* Cuerpo */}
      <div className="flex-1 overflow-y-auto p-5 bg-page">
        {error && <div className="text-danger bg-danger-bg border border-danger/30 rounded-xl px-4 py-3 text-sm mb-4">{error}</div>}
        {loading && orders.length === 0 ? (
          <div className="grid place-items-center h-[40vh] text-text-secondary">Cargando despacho…</div>
        ) : orders.length === 0 ? (
          <div className="grid place-items-center h-[40vh] text-center text-text-secondary">
            <div>
              <PiggyBank className="mx-auto mb-3 text-success" size={34} />
              <div className="font-display text-[20px] text-text-primary mb-1">Sin entregas propias ahora</div>
              <div className="text-sm max-w-sm">Cuando entre un pedido directo (Shop/teléfono), lo despachas aquí — y por cada uno te ahorras la comisión de plataforma.{platformCount > 0 ? ` Ahora mismo hay ${platformCount} pedidos que reparte la plataforma.` : ''}</div>
            </div>
          </div>
        ) : (
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))' }}>
            <div>
              <div className="flex items-center gap-2 mb-3 font-extrabold text-[14px] text-text-primary">
                <span className="w-2.5 h-2.5 rounded-full bg-warning" /> Por despachar
                <span className="ml-auto bg-accent-bg text-text-secondary text-[12px] font-extrabold px-2 py-px rounded-full tabular-nums">{porDespachar.length}</span>
              </div>
              {porDespachar.length === 0 ? <p className="text-xs text-text-secondary">Todo despachado. 👌</p> : (
                <div className="space-y-2.5">{porDespachar.map(o => <DispatchRow key={o.sale_id} order={o} onDone={refresh} />)}</div>
              )}
            </div>
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

function EconNudge({ order }: { order: OrderFeedItem }) {
  const s = saving(order)
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">
      <PiggyBank size={13} className="text-success shrink-0" />
      <span className="text-success font-semibold">Ahorras {eur(s)}</span>
      <span className="text-text-secondary">vs plataforma · te cuesta {eur(ownCost(order))}</span>
    </div>
  )
}

function DispatchRow({ order, onDone }: { order: OrderFeedItem; onDone: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
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
          {undispatched ? 'Reparto propio sin despachar' : 'Fallo de despacho'}{order.delivery_address ? ` · ${order.delivery_address}` : ''}
        </div>
        {(err || order.dispatch_error) && (
          <div className="flex items-start gap-1.5 text-[12px] text-danger mt-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{err ?? order.dispatch_error}</div>
        )}
        <EconNudge order={order} />
      </div>
      <button onClick={doDispatch} disabled={busy}
        className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 text-[13.5px] font-bold disabled:opacity-60 border-t ${failed ? 'text-white bg-danger border-danger/20' : 'text-[#2563A8] border-warning/30'}`}>
        {busy ? <><RefreshCw size={15} className="animate-spin" /> Despachando…</> : failed ? <><RefreshCw size={15} /> Reintentar despacho</> : <><Bike size={16} /> Despachar</>}
      </button>
    </div>
  )
}

function ProgressRow({ order }: { order: OrderFeedItem }) {
  const d = deliveryView(order)
  const carrier = (order.carrier_code ?? '').toLowerCase() === 'own_fleet' ? 'Flota propia' : d.carrierLabel
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
        <span className="ml-auto text-[12px] text-text-secondary">{carrier}</span>
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-[12.5px] text-text-secondary">
        <span>{vehEmoji(d.transport)} {d.rider ?? 'Sin rider aún'}</span>
        {d.etaText && <span>· llega en {d.etaText}</span>}
        {order.delivery_address && <span className="truncate">· {order.delivery_address}</span>}
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <EconNudge order={order} />
        {d.phone && (
          <a href={`tel:${d.phone.replace(/\s+/g, '')}`} className="shrink-0 inline-flex items-center gap-1.5 bg-[#15171A] text-white px-3 py-1.5 rounded-full text-[12.5px] font-bold no-underline">
            <Phone size={12} /> Llamar
          </a>
        )}
      </div>
    </div>
  )
}
