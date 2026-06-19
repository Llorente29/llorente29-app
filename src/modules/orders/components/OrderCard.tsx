// src/modules/orders/components/OrderCard.tsx
//
// Tarjeta de pedido del feed (lente "por pedido"). Principios del diseño aprobado:
//   - A1: la COMANDA COMPLETA en la tarjeta (no hay que abrir nada para ver qué lleva).
//   - Modificadores y notas PROTAGONISTAS: rojo = quitar/alergia, ámbar = añadir.
//     Nota del cliente = banda roja, nunca truncada.
//   - Alérgenos desde el escandallo (la plataforma no los da).
//   - B2: el pedido que NECESITA ACCIÓN (sin aceptar) es más grande + halo terracota;
//     el crítico por tiempo (rojo) parpadea.
//   - Tema navy Folvy (pase oscuro), no negro puro.
//
// Las acciones (aceptar/rechazar) llegan en el sub-paso siguiente; esta tarjeta ya
// deja el hueco del pie.

import { timeLevel, channelLabel, ticketCode } from '@/modules/kds/kdsUtils'
import ChannelBadge from './ChannelBadge'
import type { OrderFeedItem, OrderFeedLine, OrderFeedChild, OrderStatus } from '../services/ordersFeedService'

// ── Etiquetas y agrupaciones de estado ──────────────────────────────────────

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

/** Heurística: ¿el modificador quita algo (rojo) o añade (ámbar)?
 *  Deuda declarada: lo ideal sería un flag en modifier_option; mientras, el
 *  prefijo "sin/no/quitar" marca "quitar". Cubre la mayoría de casos reales. */
function modKind(name: string): 'remove' | 'add' {
  return /^\s*(sin|no|quitar|without|sans)\b/i.test(name) ? 'remove' : 'add'
}

function fmt(n: number | null | undefined): string {
  if (n == null) return ''
  return n.toFixed(2).replace('.', ',') + ' €'
}

// ── Sub-render: modificadores / combos de una línea ─────────────────────────

function ChildRow({ child }: { child: OrderFeedChild }) {
  if (child.line_type === 'combo_item') {
    return (
      <div className="flex items-center gap-2 text-[13px] font-semibold px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/10 text-[#dbe4ea]">
        <span className="opacity-60">·</span>{child.qty > 1 ? `${child.qty}× ` : ''}{child.name}
      </div>
    )
  }
  // modifier
  const kind = modKind(child.name)
  const cls = kind === 'remove'
    ? 'bg-[#e5484d]/[0.16] text-[#f7a9ab] border-[#e5484d]/[0.35]'
    : 'bg-[#e0a33e]/[0.16] text-[#f3cd86] border-[#e0a33e]/[0.32]'
  const tag = kind === 'remove' ? '' : '+ '
  return (
    <div className={`flex items-center gap-2 text-[14px] font-bold px-2.5 py-1.5 rounded-lg border ${cls}`}>
      {tag}{child.name}
    </div>
  )
}

function LineRow({ line }: { line: OrderFeedLine }) {
  return (
    <div className="py-2.5 border-b border-white/[0.07] last:border-b-0">
      <div className="flex items-baseline gap-3">
        <span className="font-serif font-bold text-[17px] text-[#D67442] min-w-[28px]" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
          {line.qty}×
        </span>
        <span className="text-[15px] font-bold flex-1 leading-tight">{line.name}</span>
        {line.line_total != null && (
          <span className="text-[13px] text-[#93a6b3] tabular-nums">{fmt(line.line_total)}</span>
        )}
      </div>

      {line.children.length > 0 && (
        <div className="mt-2 ml-[40px] flex flex-col gap-1.5">
          {line.children.map(c => <ChildRow key={c.line_id} child={c} />)}
        </div>
      )}

      {line.allergens.length > 0 && (
        <div className="mt-2 ml-[40px] flex items-center gap-1.5 flex-wrap">
          <span className="text-[10.5px] font-extrabold uppercase tracking-wide text-[#5f7280]">Alérgenos</span>
          {line.allergens.map(a => (
            <span key={a} className="text-[12px] font-bold px-2 py-0.5 rounded-md bg-[#e0a33e]/[0.14] text-[#f0c578] border border-[#e0a33e]/30">{a}</span>
          ))}
        </div>
      )}

      {line.customer_note && (
        <div className="mt-2 ml-[40px] text-[13px] text-[#f7b9bb] bg-[#e5484d]/[0.12] border border-[#e5484d]/30 rounded-lg px-2.5 py-1.5">
          ⚠ {line.customer_note}
        </div>
      )}
    </div>
  )
}

// ── Tarjeta ─────────────────────────────────────────────────────────────────

interface OrderCardProps {
  order: OrderFeedItem
  /** En cuadrícula, el que necesita acción ocupa 2 columnas (B2). En kanban no. */
  allowGrow?: boolean
}

export default function OrderCard({ order, allowGrow = true }: OrderCardProps) {
  const level = timeLevel(order.minutos)
  const needsAction = isNeedsAction(order.order_status)
  const terminal = isTerminal(order.order_status)
  const critical = needsAction && level === 'late'

  // Lomo de urgencia
  const spine = level === 'late' ? '#e5484d' : level === 'warn' ? '#e0a33e' : '#3ba776'

  // B2: halo + tamaño
  const grow = allowGrow && needsAction ? 'sm:col-span-2' : ''
  const halo = critical
    ? 'ring-2 ring-[#e5484d] shadow-[0_14px_40px_rgba(229,72,77,0.3)] animate-pulse'
    : needsAction
      ? 'ring-2 ring-[#D67442] shadow-[0_14px_40px_rgba(214,116,66,0.28)]'
      : 'ring-1 ring-[#243a48]'

  const timeColor = level === 'late' ? '#f4999c' : level === 'warn' ? '#f3cd86' : '#86e0b6'

  return (
    <div
      className={`relative rounded-2xl overflow-hidden bg-[#16242f] ${halo} ${grow} ${terminal ? 'opacity-70' : ''}`}
    >
      {/* lomo de urgencia */}
      <div className="absolute left-0 top-0 bottom-0 w-[5px]" style={{ backgroundColor: spine }} />

      {/* cabecera */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5 pl-5">
        <span className="font-serif font-semibold text-[20px]" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
          {ticketCode(order.external_tab_ref, order.external_ref)}
        </span>
        <ChannelBadge channel={order.channel ?? channelLabel(order.channel)} />
        <span className="ml-auto inline-flex items-center gap-1.5 font-extrabold text-[16px] tabular-nums" style={{ color: timeColor }}>
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: spine }} />
          {order.minutos}′
        </span>
      </div>

      {/* estado */}
      <div className="px-4 pb-2.5 pl-5 text-[12.5px] font-bold text-[#93a6b3] flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: needsAction ? '#D67442' : terminal ? '#5f7280' : '#D67442' }} />
        {STATUS_LABEL[order.order_status]}
      </div>

      {/* marca / canal */}
      <div className="px-4 pb-2.5 pl-5 text-[12.5px] text-[#93a6b3]">
        {order.brand || order.channel || '—'}
      </div>

      {/* nota del cliente a nivel pedido — banda roja, nunca truncada */}
      {order.customer_note && (
        <div className="mx-4 mb-2 ml-5 bg-[#e5484d]/[0.13] border border-[#e5484d]/[0.34] border-l-4 border-l-[#e5484d] rounded-lg px-3 py-2.5 flex gap-2.5 items-start">
          <span className="text-[16px] leading-none">⚠</span>
          <div className="text-[13.5px] leading-snug text-[#f7b9bb]">
            <b className="block text-[11px] uppercase tracking-wide text-[#f7a9ab] mb-0.5">Nota del cliente</b>
            {order.customer_note}
          </div>
        </div>
      )}

      {/* COMANDA completa */}
      <div className="px-4 pl-5 border-t border-white/[0.07]">
        {order.lineas.map(l => <LineRow key={l.line_id} line={l} />)}
      </div>

      {/* pie: total + (acciones en sub-paso siguiente) */}
      <div className="px-4 py-3 pl-5 border-t border-white/[0.07] flex items-center gap-3">
        <span className="font-serif font-semibold text-[18px] tabular-nums" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
          {fmt(order.total)}
          {order.paid != null && order.paid > 0 && (
            <span className="text-[11px] font-bold text-[#7fd6ab] bg-[#3ba776]/[0.14] border border-[#3ba776]/30 px-2 py-0.5 rounded-md ml-2 align-middle">Pagado</span>
          )}
        </span>
        {order.service_type && (
          <span className="ml-auto text-[11.5px] text-[#5f7280] font-semibold uppercase tracking-wide">
            {order.service_type.includes('collection') ? 'Recogida' : 'Entrega'}
          </span>
        )}
      </div>
    </div>
  )
}
