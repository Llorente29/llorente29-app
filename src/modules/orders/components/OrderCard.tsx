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

import { useState } from 'react'
import { ChefHat, Check, Printer } from 'lucide-react'
import { timeLevel, channelLabel, ticketCode } from '@/modules/kds/kdsUtils'
import ChannelBadge from './ChannelBadge'
import TicketPreviewModal from './TicketPreviewModal'
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
      <span className="w-[34px] h-[34px] rounded-[10px] overflow-hidden shrink-0 border border-default bg-white grid place-items-center p-1">
        <img src={logoUrl} alt="" className="w-full h-full object-contain" loading="lazy" onError={() => setFailed(true)} />
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
          title="Previsualizar tickets"
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
        <TicketPreviewModal order={order} onClose={() => setShowTickets(false)} />
      )}
    </div>
  )
}
