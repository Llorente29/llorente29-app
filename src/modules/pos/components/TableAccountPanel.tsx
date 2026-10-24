// src/modules/pos/components/TableAccountPanel.tsx
//
// TPV · Sala (S1) — maqueta «Folvy TPV · Sala», pantalla 3: la cuenta de una
// mesa abierta, en el sitio del carrito de la venta rápida. Las líneas van
// agrupadas por envío, con su hora; al final, lo que aún no se ha enviado.
// Abajo: total (y por persona), «Enviar a cocina» y «Sacar la cuenta», y
// «Cobrar» en su propia fila.
//
// Lo enviado no se toca: tocarlo abre la anulación. Lo no enviado se toca para
// cambiar la cantidad, la nota o quitarlo. Los pases («Va de primero / de
// segundo», «Marchar los segundos») son S3.

import { useState, type ReactNode } from 'react'
import { Loader2, Check, Clock, Ban, Banknote, CreditCard, CheckCheck } from 'lucide-react'
import type { TableDetail, TableLine } from '@/modules/pos/services/posTableService'
import { formatClock } from '@/modules/pos/lib/tableState'

// eslint-disable-next-line no-restricted-syntax -- n es un importe ya numérico (RPC o carrito local), solo se formatea
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }
function qtyText(q: number): string { return Number.isInteger(q) ? String(q) : String(q).replace('.', ',') }

export interface LocalPendingLine {
  key: string
  displayName: string
  summary: string[]
  kitchenNote: string | null
  quantity: number
  totalPrice: number
}

// Una línea no enviada, venga de la cuenta (guardada) o de esta pantalla.
export type PendingPick =
  | { kind: 'saved'; line: TableLine }
  | { kind: 'local'; key: string }

interface Props {
  detail: TableDetail | null
  local: LocalPendingLine[]
  busy: boolean
  onPickPending: (p: PendingPick) => void
  onVoid: (line: TableLine) => void
  onFire: () => void
  onRequestBill: () => void
  onCharge: (method: 'cash' | 'card') => void
  onClear: () => void
}

function LineRow({ qty, name, total, summary, note, tone, struck, extra, disabled, onClick }: {
  qty: number; name: string; total: number; summary: string[]; note: string | null
  tone: 'sent' | 'pending'; struck?: boolean; extra?: ReactNode; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full min-h-tap-small px-3 py-2 rounded-tpv-line border text-tpv-txt text-left flex justify-between items-center gap-2.5 disabled:cursor-default ${tone === 'pending' ? 'border-tpv-accent-text bg-tpv-accent-tint' : 'border-tpv-line bg-tpv-surface-2'}`}
    >
      <span className="min-w-0 flex flex-col">
        <span className={`text-tpv-name font-bold ${struck ? 'line-through text-tpv-txt-2' : ''}`}>{qtyText(qty)} × {name}</span>
        {summary.length > 0 && <span className="text-tpv-mod text-tpv-txt-2 leading-snug">{summary.join(' · ')}</span>}
        {note && <span className="text-tpv-tab-sm font-extrabold uppercase text-tpv-note">{note}</span>}
        {extra}
      </span>
      <b className={`text-tpv-name font-extrabold shrink-0 ${struck ? 'line-through text-tpv-txt-2' : ''}`}>{eur(total)}</b>
    </button>
  )
}

function GroupHeader({ title, right, rightTone }: { title: string; right: ReactNode; rightTone: 'ok' | 'accent' }) {
  return (
    <div className="flex items-center justify-between gap-2 mt-2 first:mt-0">
      <b className="text-tpv-tab font-extrabold tracking-[0.05em] uppercase text-tpv-txt-2">{title}</b>
      <span className={`flex items-center gap-1.5 text-sm font-extrabold ${rightTone === 'ok' ? 'text-tpv-ok-text' : 'text-tpv-accent-text'}`}>{right}</span>
    </div>
  )
}

export default function TableAccountPanel(p: Props) {
  const [payPick, setPayPick] = useState(false)
  const d = p.detail

  if (!d) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-tpv-txt-2" /></div>
  }

  const savedPending = d.lines.filter(l => !l.fireId)
  const pendingCount = savedPending.length + p.local.length
  const total = d.total + p.local.reduce((s, l) => s + l.totalPrice, 0)
  const paid = d.paidAt != null
  const hasSent = d.fires.length > 0
  const perPerson = d.covers > 0 ? total / d.covers : null

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2">
        {d.fires.map(f => (
          <div key={f.id} className="flex flex-col gap-2">
            <GroupHeader
              title={`Envío ${f.number}${f.originTableName ? ` · de la ${f.originTableName}` : ''}`}
              rightTone="ok"
              right={<><Check size={16} strokeWidth={2.6} aria-hidden /> Enviado a cocina · {formatClock(f.firedAt)}</>}
            />
            {d.lines.filter(l => l.fireId === f.id).map(l => (
              <LineRow
                key={l.id}
                tone="sent"
                qty={l.quantity}
                name={l.name}
                total={l.voidedAt ? 0 : l.lineTotal}
                summary={l.summary}
                note={l.kitchenNote}
                struck={!!l.voidedAt}
                disabled={!!l.voidedAt || paid}
                onClick={() => p.onVoid(l)}
                extra={l.voidedAt ? (
                  <span className="inline-flex items-center gap-1 text-tpv-tab-sm font-extrabold uppercase text-tpv-danger"><Ban size={13} aria-hidden /> Anulado{l.voidReason ? ` · ${l.voidReason}` : ''}</span>
                ) : undefined}
              />
            ))}
          </div>
        ))}

        {pendingCount > 0 && (
          <div className="flex flex-col gap-2">
            <GroupHeader title="Sin enviar" rightTone="accent" right={<><Clock size={16} strokeWidth={2.6} aria-hidden /> Aún no está en cocina</>} />
            {savedPending.map(l => (
              <LineRow key={l.id} tone="pending" qty={l.quantity} name={l.name} total={l.lineTotal} summary={l.summary} note={l.kitchenNote}
                onClick={() => p.onPickPending({ kind: 'saved', line: l })} />
            ))}
            {p.local.map(l => (
              <LineRow key={l.key} tone="pending" qty={l.quantity} name={l.displayName} total={l.totalPrice} summary={l.summary} note={l.kitchenNote}
                onClick={() => p.onPickPending({ kind: 'local', key: l.key })} />
            ))}
          </div>
        )}

        {!hasSent && pendingCount === 0 && (
          <p className="text-base text-tpv-txt-2 text-center py-10">Toca productos para tomar nota.</p>
        )}
      </div>

      <div className="shrink-0 px-4 pt-3.5 pb-4 border-t border-tpv-line flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-tpv-tab font-bold text-tpv-txt-2">Total{perPerson != null && total > 0 ? ` · ${eur(perPerson)} por persona` : ''}</span>
          <b className="text-tpv-table-num font-extrabold">{eur(total)}</b>
        </div>

        {paid ? (
          <button type="button" onClick={p.onClear} disabled={p.busy}
            className="h-tap-critical rounded-tpv bg-tpv-ok text-white text-tpv-charge font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {p.busy ? <Loader2 className="animate-spin" size={24} /> : <CheckCheck size={26} />} Mesa lista
          </button>
        ) : !payPick ? (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button" onClick={p.onFire} disabled={p.busy || pendingCount === 0}
                className="h-tap rounded-tpv border border-tpv-line-strong bg-tpv-surface-2 text-tpv-txt text-tpv-name font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50">
                {p.busy && <Loader2 className="animate-spin" size={18} />} Enviar a cocina
              </button>
              <button type="button" onClick={p.onRequestBill} disabled={p.busy || !hasSent || pendingCount > 0}
                className="h-tap rounded-tpv border border-tpv-line-strong bg-tpv-surface-2 text-tpv-txt text-tpv-name font-bold disabled:opacity-50">
                {d.billRequestedAt ? 'Otra vez la cuenta' : 'Sacar la cuenta'}
              </button>
            </div>
            <button type="button" onClick={() => setPayPick(true)} disabled={p.busy || !hasSent || pendingCount > 0}
              className="h-tap-critical rounded-tpv bg-tpv-ok text-white text-tpv-charge font-extrabold disabled:opacity-50">
              Cobrar
            </button>
            {pendingCount > 0 && hasSent && (
              <p className="text-sm text-tpv-txt-2 text-center">{pendingCount} sin enviar: envíalo o quítalo antes de cobrar.</p>
            )}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" onClick={() => { setPayPick(false); p.onCharge('cash') }} disabled={p.busy}
              className="h-tap-critical rounded-tpv bg-tpv-ok text-white text-tpv-zone font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50">
              <Banknote size={22} /> Efectivo
            </button>
            <button type="button" onClick={() => { setPayPick(false); p.onCharge('card') }} disabled={p.busy}
              className="h-tap-critical rounded-tpv bg-tpv-ok text-white text-tpv-zone font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50">
              <CreditCard size={22} /> Tarjeta
            </button>
            <button type="button" onClick={() => setPayPick(false)} className="col-span-2 h-tap-small text-base font-bold text-tpv-txt-2 underline">Cancelar cobro</button>
          </div>
        )}
      </div>
    </>
  )
}
