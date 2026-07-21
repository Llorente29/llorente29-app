// src/modules/orders/components/OrderCard.tsx
//
// Tarjeta de pedido del feed (lente "por pedido"). Rebrand 30/06/2026 — tema
// CLARO moderno (patrón gestión Otter/Deliverect): tarjeta blanca, acción
// primaria en tinta, semáforo de tiempo (verde fresco / ámbar aprieta / rojo
// tarde) en spine + timer, AVATAR DE MARCA (logo real o inicial) y badge de
// canal con logo de plataforma.
//
// Principios conservados:
//   - A1: la COMANDA COMPLETA en la tarjeta.
//   - Modificadores: rojo = quitar, ámbar = añadir, neutro = elección.
//   - Alérgenos desde el escandallo. Nota del cliente = banda roja, nunca truncada.
//   - B2: el pedido que NECESITA ACCIÓN es más grande + halo; crítico parpadea.
//
// RUTA COMPLETA: el pie avanza el pedido. ESCANDALLO: pulsar el plato abre Cook Mode.
// MARCAR LÍNEA: check por plato (kds_mark_line, compartido con el KDS).
//
// FILA DE REPARTO PROPIO (Catcher) POR FASES (operativa de cocina, 21/07/2026):
// la fila sube de intensidad según la urgencia real. Callada al buscar rider;
// nombre + llamar A LA VISTA (sin desplegar) al asignar/en camino; y al llegar el
// rider al local (`in_picking_location`) salta la cara ★ de HANDOFF, resaltada,
// para que el pase entregue la bolsa sin tener que mirar la pantalla. La prominencia
// la decide `deliveryView().phase` en el servicio; aquí solo se pinta.

import { useState } from 'react'
import { ChefHat, Check, Printer, Bike, Car, Phone, ChevronDown, ChevronUp, RefreshCw, AlertTriangle, ShoppingBag } from 'lucide-react'
import { timeLevel, channelLabel, ticketCode } from '@/modules/kds/kdsUtils'
import ChannelBadge from './ChannelBadge'
import TicketPreviewModal from './TicketPreviewModal'
import {
  primaryAction, secondaryAction, childVisual, deliveryView,
  isOwnDeliveryUndispatched, dispatchOrder,
  type OrderFeedItem, type OrderFeedLine, type OrderFeedChild, type OrderStatus,
  type DeliveryView, type DeliveryTone,
} from '../services/ordersFeedService'

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'Nuevo · sin aceptar',
  received: 'Nuevo · sin aceptar',
  accepted: 'Aceptado',
  in_preparation: 'En preparación',
  awaiting_collection: 'Listo',
  awaiting_shipment: 'Listo',
  in_delivery: 'En reparto',
  completed: 'Completado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  delivery_failed: 'Entrega fallida',
}

const NEEDS_ACTION: OrderStatus[] = ['new', 'received']
const TERMINAL: OrderStatus[] = ['completed', 'rejected', 'cancelled', 'delivery_failed']

function isNeedsAction(s: OrderStatus): boolean { return NEEDS_ACTION.includes(s) }
function isTerminal(s: OrderStatus): boolean { return TERMINAL.includes(s) }

// Semáforo de tiempo (marca nueva). 'late' rojo · 'warn' ámbar · resto verde.
const INK = '#15171A'
function timeColors(level: string): { spine: string; text: string } {
  if (level === 'late') return { spine: '#E0492E', text: '#E0492E' }
  if (level === 'warn') return { spine: '#C2890F', text: '#C2890F' }
  return { spine: '#1F9D6B', text: '#1F9D6B' }
}

function fmt(n: number | null | undefined): string {
  if (n == null) return ''
  return n.toFixed(2).replace('.', ',') + ' €'
}

// ── Avatar de marca (logo real o inicial sobre su color) ────────────────────
function BrandAvatar({ name, logoUrl, color }: { name: string | null; logoUrl: string | null; color: string | null }) {
  const [failed, setFailed] = useState(false)
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?'
  const bg = color || INK
  if (logoUrl && !failed) {
    return (
      <span className="w-[34px] h-[34px] rounded-[10px] overflow-hidden shrink-0 border border-default bg-white grid place-items-center">
        <img src={logoUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      </span>
    )
  }
  return (
    <span
      className="w-[34px] h-[34px] rounded-[10px] shrink-0 grid place-items-center text-white font-display font-bold text-[14px]"
      style={{ backgroundColor: bg }}
    >
      {initial}
    </span>
  )
}

// ── Sub-render ──────────────────────────────────────────────────────────────

function ChildRow({ child }: { child: OrderFeedChild }) {
  // Componente de combo: neutro, sin signo (forma parte del plato).
  if (child.line_type === 'combo_item') {
    return (
      <div className="flex items-center gap-2 text-[13px] font-semibold px-2.5 py-1 rounded-lg bg-page border border-default text-text-secondary">
        <span className="opacity-60">·</span>{child.qty > 1 ? `${child.qty}× ` : ''}{child.name}
      </div>
    )
  }

  const v = childVisual(child)
  const cls =
    v.tone === 'remove'
      ? 'bg-danger-bg text-danger border-danger/30'
      : v.tone === 'add'
        ? 'bg-warning-bg text-warning border-warning/30'
        : 'bg-page text-text-secondary border-default'
  const prefix = v.tone === 'add' ? '+ ' : ''

  return (
    <div className={`flex items-center gap-2 text-[14px] font-bold px-2.5 py-1.5 rounded-lg border ${cls}`}>
      <span className="flex-1">{prefix}{child.name}</span>
      {!v.confirmed && (
        <span
          className="shrink-0 w-1.5 h-1.5 rounded-full bg-current opacity-40"
          title="Tipo inferido del texto (sin confirmar en el catálogo)"
        />
      )}
    </div>
  )
}

function LineRow({
  line, onOpenRecipe, onMarkLine, marking,
}: {
  line: OrderFeedLine
  onOpenRecipe?: (line: OrderFeedLine) => void
  onMarkLine?: (lineId: string) => void
  marking?: boolean
}) {
  const clickable = line.has_recipe && line.menu_item_id != null && onOpenRecipe != null
  const marked = line.marked

  return (
    <div className={`py-2.5 border-b border-default last:border-b-0 ${marked ? 'opacity-55' : ''}`}>
      <div className="flex items-baseline gap-2.5">
        {onMarkLine && (
          <button
            onClick={() => onMarkLine(line.line_id)}
            disabled={marking}
            title={marked ? 'Marcado · tocar para desmarcar' : 'Marcar como hecho'}
            className={`shrink-0 self-center w-6 h-6 rounded-md grid place-items-center border disabled:opacity-50 ${
              marked
                ? 'bg-success border-success text-white'
                : 'bg-card text-text-secondary border-default hover:border-success hover:text-success'
            }`}
          >
            {marked && <Check size={15} strokeWidth={3} />}
          </button>
        )}
        <span className="font-display font-bold text-[16px] text-text-primary min-w-[28px]">
          {line.qty}×
        </span>
        {clickable ? (
          <button
            onClick={() => onOpenRecipe!(line)}
            className={`text-[15px] font-bold flex-1 leading-tight text-left text-text-primary hover:text-success flex items-center gap-1.5 min-w-0 ${marked ? 'line-through' : ''}`}
            title="Ver ficha técnica"
          >
            <span className="truncate">{line.name}</span>
            <ChefHat size={13} className="shrink-0 text-text-secondary" />
          </button>
        ) : (
          <span className={`text-[15px] font-bold flex-1 leading-tight text-text-primary ${marked ? 'line-through' : ''}`}>{line.name}</span>
        )}
        {line.line_total != null && (
          <span className="text-[13px] text-text-secondary tabular-nums font-mono">{fmt(line.line_total)}</span>
        )}
      </div>

      {line.children.length > 0 && (
        <div className="mt-2 ml-[58px] flex flex-col gap-1.5">
          {line.children.map(c => <ChildRow key={c.line_id} child={c} />)}
        </div>
      )}

      {line.allergens.length > 0 && (
        <div className="mt-2 ml-[58px] flex items-center gap-1.5 flex-wrap">
          <span className="text-[10.5px] font-extrabold uppercase tracking-wide text-text-secondary">Alérgenos</span>
          {line.allergens.map(a => (
            <span key={a} className="text-[12px] font-bold px-2 py-0.5 rounded-md bg-warning-bg text-warning border border-warning/30">{a}</span>
          ))}
        </div>
      )}

      {line.customer_note && (
        <div className="mt-2 ml-[58px] text-[13px] text-danger bg-danger-bg border border-danger/30 rounded-lg px-2.5 py-1.5">
          ⚠ {line.customer_note}
        </div>
      )}
    </div>
  )
}

// Vehículo del rider (Catcher): emoji + etiqueta + icono lucide para la cabecera.
function transportMeta(t: string | null): { emoji: string; label: string; car: boolean } | null {
  const v = (t ?? '').toLowerCase()
  if (!v) return null
  if (v.includes('bici') || v.includes('bike') || v.includes('cycl')) return { emoji: '🚲', label: 'Bici', car: false }
  if (v.includes('coche') || v.includes('car')) return { emoji: '🚗', label: 'Coche', car: true }
  if (v.includes('moto') || v.includes('scooter') || v.includes('vespa')) return { emoji: '🛵', label: 'Moto', car: false }
  return { emoji: '🛵', label: t as string, car: false }
}

// Clases de la píldora de estado según el tono (borde `canceled` corregido).
function statePillCls(tone: DeliveryTone): string {
  switch (tone) {
    case 'done':     return 'text-success bg-success-bg border-success/30'
    case 'failed':   return 'text-danger bg-danger-bg border-danger/30'
    case 'canceled': return 'text-text-secondary bg-page border-default'
    case 'pending':  return 'text-warning bg-warning-bg border-warning/30'
    default:         return 'text-success bg-success-bg border-success/30'
  }
}

// Botón redondo "llamar de un toque" (rider). tel: real; para de propagar el clic
// para no plegar/desplegar contenedores.
function CallIconButton({ phone }: { phone: string }) {
  return (
    <a
      href={`tel:${phone.replace(/\s+/g, '')}`}
      onClick={e => e.stopPropagation()}
      title={`Llamar al repartidor · ${phone}`}
      className="ml-auto shrink-0 w-9 h-9 rounded-full bg-[#15171A] text-white grid place-items-center no-underline"
    >
      <Phone size={15} />
    </a>
  )
}

// Píldora "llamar" con el número visible (handoff / soporte).
function CallPill({ phone, big = false }: { phone: string; big?: boolean }) {
  return (
    <a
      href={`tel:${phone.replace(/\s+/g, '')}`}
      onClick={e => e.stopPropagation()}
      className={`shrink-0 inline-flex items-center gap-1.5 bg-[#15171A] text-white rounded-full font-bold no-underline ${big ? 'px-3.5 py-2.5 text-[14px]' : 'px-3 py-2 text-[13px]'}`}
    >
      <Phone size={big ? 14 : 13} /> {phone}
    </a>
  )
}

// ── Fila de reparto. Caras según el estado del despacho propio. ──
function DeliveryRow({ order, onDispatched }: { order: OrderFeedItem; onDispatched?: () => void }) {
  const [dispatching, setDispatching] = useState(false)
  const [dispatchErr, setDispatchErr] = useState<string | null>(null)
  const d: DeliveryView = deliveryView(order)

  async function doDispatch() {
    if (dispatching) return
    setDispatching(true); setDispatchErr(null)
    try {
      await dispatchOrder(order.sale_id)
      onDispatched?.()
    } catch (e) {
      setDispatchErr(e instanceof Error ? e.message : 'No se pudo despachar.')
    } finally {
      setDispatching(false)
    }
  }

  // (A) Reparto propio SIN despachar (modo manual o tras fallo): botón en la fila.
  if (isOwnDeliveryUndispatched(order)) {
    const failed = !!order.dispatch_error
    const errMsg = dispatchErr ?? order.dispatch_error
    return (
      <div className={`mx-4 mb-2.5 ml-5 rounded-xl border overflow-hidden ${failed ? 'border-danger/40 bg-danger-bg' : 'border-[#CFE4FA] bg-[#F0F7FF]'}`}>
        {failed && errMsg && (
          <div className="flex items-start gap-2 px-3 py-2.5 border-b border-danger/20">
            <AlertTriangle size={15} className="text-danger shrink-0 mt-0.5" />
            <span className="text-[12.5px] text-danger leading-snug">
              <b className="block text-[11px] uppercase tracking-wide">No se pudo despachar</b>
              {errMsg}
            </span>
          </div>
        )}
        <button
          onClick={doDispatch}
          disabled={dispatching}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 text-[13.5px] font-bold disabled:opacity-60 ${
            failed ? 'text-white bg-danger' : 'text-[#2563A8]'
          }`}
        >
          {dispatching
            ? <><RefreshCw size={15} className="animate-spin" /> Despachando…</>
            : failed
              ? <><RefreshCw size={15} /> Reintentar despacho</>
              : <><Bike size={16} /> Despachar a Catcher</>}
        </button>
      </div>
    )
  }

  if (d.kind === 'none') return null

  // (B) Plataforma (Glovo/Uber/JE): informativo; si hay soporte, plegable con su teléfono.
  if (d.kind === 'platform') return <PlatformDeliveryRow view={d} />

  // (C) Reparto propio despachado (Catcher/Jelp): prominencia POR FASE.
  const tp = transportMeta(d.transport)
  const HeadIcon = tp?.car ? Car : Bike
  const riderName = d.rider
    ? <span className="text-[14px] font-bold text-text-primary truncate">{tp && <span className="mr-1" aria-label={tp.label} title={tp.label}>{tp.emoji}</span>}{d.rider}</span>
    : null

  // ★ HANDOFF — repartidor EN el local: el momento de entregar la bolsa. Resaltado.
  if (d.phase === 'at_pickup') {
    return (
      <div className="mx-4 mb-2.5 ml-5 rounded-2xl border-2 border-success bg-success-bg overflow-hidden shadow-[0_8px_22px_rgba(31,157,107,0.18)]">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <span className="w-11 h-11 rounded-xl bg-success text-white grid place-items-center shrink-0">
            <ShoppingBag size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[14.5px] font-extrabold text-success leading-tight">
              <span className="w-2.5 h-2.5 rounded-full bg-success animate-pulse shrink-0" />
              Repartidor en el local — entrega el pedido
            </div>
            <div className="text-[12.5px] text-success/90 mt-1 truncate">
              {tp && <span className="mr-1">{tp.emoji}</span>}{d.rider ?? d.carrierLabel} · {d.carrierLabel} · esperando la bolsa
            </div>
          </div>
          {d.phone && <CallPill phone={d.phone} big />}
        </div>
      </div>
    )
  }

  // Buscando repartidor — discreto (aún no hay nada que hacer).
  if (d.phase === 'searching') {
    return (
      <div className="mx-4 mb-2.5 ml-5 rounded-xl border border-[#CFE4FA] bg-[#F0F7FF] px-3 py-2.5 flex items-center gap-2.5">
        <Bike size={16} className="text-[#2563A8] shrink-0" />
        <span className="text-[13px] font-bold text-[#2563A8]">{d.carrierLabel}</span>
        <span className={`text-[11.5px] font-extrabold px-2.5 py-0.5 rounded-full border ${statePillCls('pending')}`}>
          {d.stateLabel ?? 'Buscando repartidor'}
        </span>
      </div>
    )
  }

  // Entregado — se apaga a un check verde.
  if (d.phase === 'delivered') {
    return (
      <div className="mx-4 mb-2.5 ml-5 rounded-xl border border-success/30 bg-success-bg px-3 py-2.5 flex items-center gap-2.5">
        <Check size={16} className="text-success shrink-0" strokeWidth={2.4} />
        <span className="text-[13px] font-bold text-success">Entregado</span>
        {d.rider && <span className="text-[12px] text-success/90 truncate">· {d.rider}</span>}
        {d.seenText && <span className="ml-auto text-[11px] text-success/80 shrink-0 hidden sm:inline">{d.seenText}</span>}
      </div>
    )
  }

  // No entregado (fallo).
  if (d.phase === 'failed') {
    return (
      <div className="mx-4 mb-2.5 ml-5 rounded-xl border border-danger/30 bg-danger-bg px-3 py-2.5 flex items-center gap-2.5">
        <AlertTriangle size={16} className="text-danger shrink-0" />
        <span className="text-[13px] font-bold text-danger">No entregado</span>
        {d.rider && <span className="text-[12px] text-danger/90 truncate">· {d.rider}</span>}
        {d.phone && <CallIconButton phone={d.phone} />}
      </div>
    )
  }

  // Cancelado.
  if (d.phase === 'canceled') {
    return (
      <div className="mx-4 mb-2.5 ml-5 rounded-xl border border-default bg-page px-3 py-2.5 flex items-center gap-2.5">
        <Bike size={16} className="text-text-secondary shrink-0" />
        <span className="text-[13px] font-bold text-text-secondary">{d.carrierLabel} · Cancelado</span>
      </div>
    )
  }

  // Asignado / En camino / (fallback) — NOMBRE + LLAMAR a la vista, sin desplegar.
  return (
    <div className="mx-4 mb-2.5 ml-5 rounded-xl border border-[#CFE4FA] bg-[#F0F7FF] px-3 py-2.5 flex items-center gap-2.5">
      <HeadIcon size={16} className="text-[#2563A8] shrink-0" />
      {riderName ?? <span className="text-[13px] font-bold text-[#2563A8]">{d.carrierLabel}</span>}
      {d.stateLabel && (
        <span className={`text-[11.5px] font-extrabold px-2.5 py-0.5 rounded-full border shrink-0 ${statePillCls(d.stateTone)}`}>
          {d.stateLabel}
        </span>
      )}
      {d.etaText && <span className="text-[11px] text-text-secondary shrink-0">{d.etaText}</span>}
      {d.seenText && <span className="text-[11px] text-text-secondary truncate hidden sm:inline">· {d.seenText}</span>}
      {d.phone
        ? <CallIconButton phone={d.phone} />
        : (
          <span className="ml-auto text-[12px] text-text-secondary shrink-0">
            {d.hasCourier ? 'Repartidor asignado' : 'Sin datos del rider'}
          </span>
        )}
    </div>
  )
}

// Fila de plataforma (Glovo/Uber/JE): "Lo lleva {plataforma}", plegable con soporte.
function PlatformDeliveryRow({ view }: { view: DeliveryView }) {
  const [open, setOpen] = useState(false)
  const canOpen = !!view.supportPhone
  return (
    <div className="mx-4 mb-2.5 ml-5 rounded-xl border border-[#CFE4FA] bg-[#F0F7FF] overflow-hidden">
      <button
        onClick={() => canOpen && setOpen(o => !o)}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left ${canOpen ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <Bike size={16} className="text-[#2563A8] shrink-0" />
        <span className="text-[13px] font-bold text-[#2563A8]">Lo lleva {view.carrierLabel}</span>
        {canOpen && (
          <span className="ml-auto text-[#2563A8] shrink-0">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        )}
      </button>
      {open && canOpen && (
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-t border-[#DCEAFB]">
          <span className="text-[12.5px] text-text-secondary">Soporte {view.carrierLabel}</span>
          <CallPill phone={view.supportPhone!} />
        </div>
      )}
    </div>
  )
}

// ── Tarjeta ─────────────────────────────────────────────────────────────────

interface OrderCardProps {
  order: OrderFeedItem
  allowGrow?: boolean
  onAdvance?: (saleId: string, next: OrderStatus) => void | Promise<void>
  onOpenRecipe?: (line: OrderFeedLine) => void
  onMarkLine?: (lineId: string) => void | Promise<void>
  /** Reimprime el pedido (encola a las impresoras). docType opcional = solo ese
   *  documento. Devuelve el nº de jobs. */
  onReprint?: (saleId: string, docType?: string) => Promise<number>
}

export default function OrderCard({ order, allowGrow = true, onAdvance, onOpenRecipe, onMarkLine, onReprint }: OrderCardProps) {
  const [busy, setBusy] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [showTickets, setShowTickets] = useState(false)
  const level = timeLevel(order.minutos)
  const needsAction = isNeedsAction(order.order_status)
  const terminal = isTerminal(order.order_status)
  const critical = needsAction && level === 'late'

  const tc = timeColors(level)

  const grow = allowGrow && needsAction ? 'sm:col-span-2' : ''
  const halo = critical
    ? 'border-danger shadow-[0_10px_32px_rgba(224,73,46,0.18)] animate-pulse'
    : needsAction
      ? 'border-[#DfE2E5] shadow-[0_8px_28px_rgba(21,23,26,0.08)]'
      : 'border-default'

  const primary = primaryAction(order)
  const secondary = secondaryAction(order)

  // Transiciones donde TODO debería estar hecho: avisar si quedan líneas sin marcar.
  const READY_OR_CLOSE: OrderStatus[] = ['awaiting_collection', 'awaiting_shipment', 'in_delivery', 'completed']
  const unmarkedCount = order.lineas.filter(l => !l.marked).length

  const run = async (next: OrderStatus) => {
    if (!onAdvance || busy) return
    if (READY_OR_CLOSE.includes(next) && unmarkedCount > 0) {
      const ok = window.confirm(
        `Quedan ${unmarkedCount} ${unmarkedCount === 1 ? 'línea sin marcar' : 'líneas sin marcar'}. ¿Continuar de todos modos?`
      )
      if (!ok) return
    }
    setBusy(true)
    try { await onAdvance(order.sale_id, next) } finally { setBusy(false) }
  }

  const mark = async (lineId: string) => {
    if (!onMarkLine || markingId) return
    setMarkingId(lineId)
    try { await onMarkLine(lineId) } finally { setMarkingId(null) }
  }

  const secIsDanger = secondary != null && (secondary.next === 'cancelled' || secondary.next === 'rejected')

  return (
    <div className={`relative rounded-2xl overflow-hidden bg-card border ${halo} ${grow} ${terminal ? 'opacity-70' : ''}`}>
      <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ backgroundColor: tc.spine }} />

      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5 pl-5">
        <BrandAvatar name={order.brand} logoUrl={order.brand_logo_url} color={order.brand_color} />
        <span className="font-display font-bold text-[18px] text-text-primary tracking-tight">
          {ticketCode(order.external_tab_ref, order.external_ref)}
        </span>
        <ChannelBadge channel={order.channel ?? channelLabel(order.channel)} />
        <button
          onClick={() => setShowTickets(true)}
          title="Tickets · reimprimir"
          className="ml-auto shrink-0 w-7 h-7 rounded-lg grid place-items-center text-text-secondary border border-default hover:text-text-primary hover:bg-page"
        >
          <Printer size={15} />
        </button>
        <span className="inline-flex items-center gap-1.5 font-extrabold text-[16px] tabular-nums font-mono" style={{ color: tc.text }}>
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tc.spine }} />
          {order.minutos}′
        </span>
      </div>

      <div className="px-4 pb-2 pl-5 text-[12.5px] font-bold text-text-secondary flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: needsAction ? INK : terminal ? '#9CA0A6' : tc.spine }} />
        {STATUS_LABEL[order.order_status]}
      </div>

      <div className="px-4 pb-2.5 pl-5 text-[12.5px] text-text-secondary">
        {order.brand || order.channel || '—'}
      </div>

      {order.customer_note && (
        <div className="mx-4 mb-2 ml-5 bg-danger-bg border border-danger/30 border-l-4 border-l-danger rounded-lg px-3 py-2.5 flex gap-2.5 items-start">
          <span className="text-[16px] leading-none">⚠</span>
          <div className="text-[13.5px] leading-snug text-danger">
            <b className="block text-[11px] uppercase tracking-wide mb-0.5">Nota del cliente</b>
            {order.customer_note}
          </div>
        </div>
      )}

      <div className="px-4 pl-5 border-t border-default">
        {order.lineas.map(l => (
          <LineRow
            key={l.line_id}
            line={l}
            onOpenRecipe={onOpenRecipe}
            onMarkLine={onMarkLine ? mark : undefined}
            marking={markingId === l.line_id}
          />
        ))}
      </div>

      <DeliveryRow order={order} />

      <div className="px-4 py-3 pl-5 border-t border-default">
        <div className="flex items-center gap-3">
          <span className="font-display font-semibold text-[18px] tabular-nums text-text-primary">
            {fmt(order.total)}
            {order.paid != null && order.paid > 0 && (
              <span className="text-[11px] font-bold text-success bg-success-bg border border-success/30 px-2 py-0.5 rounded-md ml-2 align-middle">Pagado</span>
            )}
          </span>
          {order.service_type && (
            <span className="ml-auto text-[11.5px] text-text-secondary font-semibold uppercase tracking-wide">
              {order.service_type.includes('collection') || order.service_type.includes('pickup') ? 'Recogida' : 'Entrega'}
            </span>
          )}
        </div>

        {onAdvance && (primary || secondary) && (
          <div className="flex items-center gap-2 mt-3">
            {secondary && (
              <button
                onClick={() => run(secondary.next)}
                disabled={busy}
                className={`px-3 py-2 rounded-xl text-[13px] font-bold border disabled:opacity-50 ${
                  secIsDanger
                    ? 'text-danger border-danger/40 hover:bg-danger-bg'
                    : 'text-text-secondary border-default hover:text-text-primary hover:bg-page'
                }`}
              >
                {secondary.label}
              </button>
            )}
            {primary && (
              <button
                onClick={() => run(primary.next)}
                disabled={busy}
                className="ml-auto flex-1 px-4 py-2.5 rounded-xl text-[14px] font-extrabold bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                {busy ? '…' : primary.label}
              </button>
            )}
          </div>
        )}
      </div>

      {showTickets && (
        <TicketPreviewModal order={order} onClose={() => setShowTickets(false)} onReprint={onReprint} />
      )}
    </div>
  )
}
