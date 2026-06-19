// src/modules/orders/components/OrderCard.tsx
//
// Tarjeta de pedido del feed (lente "por pedido"). Principios del diseño aprobado:
//   - A1: la COMANDA COMPLETA en la tarjeta.
//   - Modificadores PROTAGONISTAS: rojo = quitar, ámbar = añadir, neutro = elección.
//     Color por group_type del catálogo (verdad); texto como desempate; lo inferido
//     se marca con un punto "sin confirmar". Bebidas/postres (cross_sell) al final.
//   - Alérgenos desde el escandallo. Nota del cliente = banda roja, nunca truncada.
//   - B2: el pedido que NECESITA ACCIÓN es más grande + halo; crítico parpadea.
//   - Tema navy Folvy.
//
// RUTA COMPLETA: el pie avanza el pedido. ESCANDALLO: pulsar el plato abre Cook Mode.
// MARCAR LÍNEA: check por plato (kds_mark_line, compartido con el KDS).

import { useState } from 'react'
import { ChefHat, Check } from 'lucide-react'
import { timeLevel, channelLabel, ticketCode } from '@/modules/kds/kdsUtils'
import ChannelBadge from './ChannelBadge'
import {
  primaryAction, secondaryAction, childVisual,
  type OrderFeedItem, type OrderFeedLine, type OrderFeedChild, type OrderStatus,
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

function fmt(n: number | null | undefined): string {
  if (n == null) return ''
  return n.toFixed(2).replace('.', ',') + ' €'
}

// ── Sub-render ──────────────────────────────────────────────────────────────

function ChildRow({ child }: { child: OrderFeedChild }) {
  // Componente de combo: neutro, sin signo (forma parte del plato).
  if (child.line_type === 'combo_item') {
    return (
      <div className="flex items-center gap-2 text-[13px] font-semibold px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/10 text-[#dbe4ea]">
        <span className="opacity-60">·</span>{child.qty > 1 ? `${child.qty}× ` : ''}{child.name}
      </div>
    )
  }

  const v = childVisual(child)
  const cls =
    v.tone === 'remove'
      ? 'bg-[#e5484d]/[0.16] text-[#f7a9ab] border-[#e5484d]/[0.35]'
      : v.tone === 'add'
        ? 'bg-[#e0a33e]/[0.16] text-[#f3cd86] border-[#e0a33e]/[0.32]'
        : 'bg-white/[0.04] text-[#dbe4ea] border-white/10'
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
    <div className={`py-2.5 border-b border-white/[0.07] last:border-b-0 ${marked ? 'opacity-55' : ''}`}>
      <div className="flex items-baseline gap-2.5">
        {onMarkLine && (
          <button
            onClick={() => onMarkLine(line.line_id)}
            disabled={marking}
            title={marked ? 'Marcado · tocar para desmarcar' : 'Marcar como hecho'}
            className={`shrink-0 self-center w-6 h-6 rounded-md grid place-items-center ring-1 disabled:opacity-50 ${
              marked
                ? 'bg-[#3ba776] text-[#0e1d15] ring-[#3ba776]'
                : 'bg-transparent text-[#5f7280] ring-[#3a5366] hover:ring-[#3ba776] hover:text-[#86e0b6]'
            }`}
          >
            {marked && <Check size={15} strokeWidth={3} />}
          </button>
        )}
        <span className="font-serif font-bold text-[17px] text-[#D67442] min-w-[28px]" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
          {line.qty}×
        </span>
        {clickable ? (
          <button
            onClick={() => onOpenRecipe!(line)}
            className={`text-[15px] font-bold flex-1 leading-tight text-left hover:text-[#86e0b6] flex items-center gap-1.5 min-w-0 ${marked ? 'line-through' : ''}`}
            title="Ver ficha técnica"
          >
            <span className="truncate">{line.name}</span>
            <ChefHat size={13} className="shrink-0 opacity-70" />
          </button>
        ) : (
          <span className={`text-[15px] font-bold flex-1 leading-tight ${marked ? 'line-through' : ''}`}>{line.name}</span>
        )}
        {line.line_total != null && (
          <span className="text-[13px] text-[#93a6b3] tabular-nums">{fmt(line.line_total)}</span>
        )}
      </div>

      {line.children.length > 0 && (
        <div className="mt-2 ml-[58px] flex flex-col gap-1.5">
          {line.children.map(c => <ChildRow key={c.line_id} child={c} />)}
        </div>
      )}

      {line.allergens.length > 0 && (
        <div className="mt-2 ml-[58px] flex items-center gap-1.5 flex-wrap">
          <span className="text-[10.5px] font-extrabold uppercase tracking-wide text-[#5f7280]">Alérgenos</span>
          {line.allergens.map(a => (
            <span key={a} className="text-[12px] font-bold px-2 py-0.5 rounded-md bg-[#e0a33e]/[0.14] text-[#f0c578] border border-[#e0a33e]/30">{a}</span>
          ))}
        </div>
      )}

      {line.customer_note && (
        <div className="mt-2 ml-[58px] text-[13px] text-[#f7b9bb] bg-[#e5484d]/[0.12] border border-[#e5484d]/30 rounded-lg px-2.5 py-1.5">
          ⚠ {line.customer_note}
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
}

export default function OrderCard({ order, allowGrow = true, onAdvance, onOpenRecipe, onMarkLine }: OrderCardProps) {
  const [busy, setBusy] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const level = timeLevel(order.minutos)
  const needsAction = isNeedsAction(order.order_status)
  const terminal = isTerminal(order.order_status)
  const critical = needsAction && level === 'late'

  const spine = level === 'late' ? '#e5484d' : level === 'warn' ? '#e0a33e' : '#3ba776'

  const grow = allowGrow && needsAction ? 'sm:col-span-2' : ''
  const halo = critical
    ? 'ring-2 ring-[#e5484d] shadow-[0_14px_40px_rgba(229,72,77,0.3)] animate-pulse'
    : needsAction
      ? 'ring-2 ring-[#D67442] shadow-[0_14px_40px_rgba(214,116,66,0.28)]'
      : 'ring-1 ring-[#243a48]'

  const timeColor = level === 'late' ? '#f4999c' : level === 'warn' ? '#f3cd86' : '#86e0b6'

  const primary = primaryAction(order)
  const secondary = secondaryAction(order)

  const run = async (next: OrderStatus) => {
    if (!onAdvance || busy) return
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
    <div className={`relative rounded-2xl overflow-hidden bg-[#16242f] ${halo} ${grow} ${terminal ? 'opacity-70' : ''}`}>
      <div className="absolute left-0 top-0 bottom-0 w-[5px]" style={{ backgroundColor: spine }} />

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

      <div className="px-4 pb-2.5 pl-5 text-[12.5px] font-bold text-[#93a6b3] flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: needsAction ? '#D67442' : terminal ? '#5f7280' : '#D67442' }} />
        {STATUS_LABEL[order.order_status]}
      </div>

      <div className="px-4 pb-2.5 pl-5 text-[12.5px] text-[#93a6b3]">
        {order.brand || order.channel || '—'}
      </div>

      {order.customer_note && (
        <div className="mx-4 mb-2 ml-5 bg-[#e5484d]/[0.13] border border-[#e5484d]/[0.34] border-l-4 border-l-[#e5484d] rounded-lg px-3 py-2.5 flex gap-2.5 items-start">
          <span className="text-[16px] leading-none">⚠</span>
          <div className="text-[13.5px] leading-snug text-[#f7b9bb]">
            <b className="block text-[11px] uppercase tracking-wide text-[#f7a9ab] mb-0.5">Nota del cliente</b>
            {order.customer_note}
          </div>
        </div>
      )}

      <div className="px-4 pl-5 border-t border-white/[0.07]">
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

      <div className="px-4 py-3 pl-5 border-t border-white/[0.07]">
        <div className="flex items-center gap-3">
          <span className="font-serif font-semibold text-[18px] tabular-nums" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
            {fmt(order.total)}
            {order.paid != null && order.paid > 0 && (
              <span className="text-[11px] font-bold text-[#7fd6ab] bg-[#3ba776]/[0.14] border border-[#3ba776]/30 px-2 py-0.5 rounded-md ml-2 align-middle">Pagado</span>
            )}
          </span>
          {order.service_type && (
            <span className="ml-auto text-[11.5px] text-[#5f7280] font-semibold uppercase tracking-wide">
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
                className={`px-3 py-2 rounded-xl text-[13px] font-bold ring-1 disabled:opacity-50 ${
                  secIsDanger
                    ? 'text-[#f4999c] ring-[#e5484d]/40 hover:bg-[#e5484d]/[0.12]'
                    : 'text-[#93a6b3] ring-[#243a48] hover:text-[#f2efe9]'
                }`}
              >
                {secondary.label}
              </button>
            )}
            {primary && (
              <button
                onClick={() => run(primary.next)}
                disabled={busy}
                className="ml-auto flex-1 px-4 py-2.5 rounded-xl text-[14px] font-extrabold bg-[#D67442] text-[#1a1208] hover:bg-[#e08652] disabled:opacity-50"
              >
                {busy ? '…' : primary.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
