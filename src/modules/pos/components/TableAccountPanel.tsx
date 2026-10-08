// src/modules/pos/components/TableAccountPanel.tsx
//
// TPV · Sala (S1). La cuenta de una mesa abierta, en el sitio del carrito de
// la venta rápida. Arriba la cabecera de la mesa; luego las líneas agrupadas
// por envío con su hora; al final lo que aún no se ha enviado (lo guardado en
// la cuenta y lo tocado en esta pantalla). Abajo: «Enviar a cocina», «Sacar la
// cuenta» y, separado, «Cobrar».
//
// Lo enviado no se toca: tocarlo abre la anulación. Lo no enviado se cambia o
// se quita libremente.

import { useState } from 'react'
import {
  ArrowLeft, Users, Clock, Loader2, Minus, Plus, Trash2, Send, Receipt, Banknote, CreditCard, CheckCheck, Ban,
} from 'lucide-react'
import type { TableDetail, TableLine } from '@/modules/pos/services/posTableService'
import { TABLE_STATE_LOOK, minutesSince, formatDuration, formatClock } from '@/modules/pos/lib/tableState'

// eslint-disable-next-line no-restricted-syntax -- n es un importe ya numérico (RPC o carrito local), solo se formatea
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

export interface LocalPendingLine {
  key: string
  displayName: string
  summary: string[]
  kitchenNote: string | null
  quantity: number
  totalPrice: number
}

interface Props {
  detail: TableDetail | null
  local: LocalPendingLine[]
  busy: boolean
  now: number
  warnMinutes: number
  onClose: () => void
  onLocalQty: (key: string, delta: number) => void
  onLocalRemove: (key: string) => void
  onLocalNote: (key: string) => void
  onSavedQty: (line: TableLine, quantity: number) => void
  onSavedRemove: (line: TableLine) => void
  onVoid: (line: TableLine) => void
  onFire: () => void
  onRequestBill: () => void
  onCharge: (method: 'cash' | 'card') => void
  onClear: () => void
}

function LineBody({ name, summary, note, qty, total, struck }: { name: string; summary: string[]; note: string | null; qty: number; total: number; struck?: boolean }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={`text-tpv-name font-bold flex-1 min-w-0 ${struck ? 'line-through text-tpv-txt-2' : 'text-tpv-txt'}`}>
          {qty > 1 && <span className="mr-1">{qty}×</span>}{name}
        </span>
        <span className={`text-tpv-line-price font-extrabold shrink-0 ${struck ? 'line-through text-tpv-txt-2' : 'text-tpv-txt'}`}>{eur(total)}</span>
      </div>
      {summary.length > 0 && <p className="text-tpv-mod text-tpv-txt-2 mt-0.5 leading-snug">{summary.join(' · ')}</p>}
      {note && (
        <div className="mt-1.5 pl-2.5 border-l-4 border-tpv-note bg-tpv-note/10 rounded py-1">
          <p className="text-xs font-extrabold uppercase text-tpv-note">{note}</p>
        </div>
      )}
    </>
  )
}

function QtyControls({ qty, onMinus, onPlus, onRemove }: { qty: number; onMinus: () => void; onPlus: () => void; onRemove: () => void }) {
  return (
    <div className="flex items-center justify-between mt-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onMinus} aria-label="Uno menos" className="min-w-tap-small min-h-tap-small rounded-tpv border border-tpv-line flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface"><Minus size={16} /></button>
        <span className="min-w-[1.6em] text-center text-base font-extrabold text-tpv-txt">{qty}</span>
        <button type="button" onClick={onPlus} aria-label="Uno más" className="min-w-tap-small min-h-tap-small rounded-tpv border border-tpv-line flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface"><Plus size={16} /></button>
      </div>
      <button type="button" onClick={onRemove} aria-label="Quitar" className="min-w-tap-small min-h-tap-small rounded-tpv flex items-center justify-center text-tpv-txt-2 hover:text-tpv-danger hover:bg-tpv-danger/10 transition-base"><Trash2 size={18} /></button>
    </div>
  )
}

export default function TableAccountPanel(p: Props) {
  const [payPick, setPayPick] = useState(false)
  const d = p.detail

  if (!d) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-tpv-txt-2" /></div>
  }

  const look = TABLE_STATE_LOOK[d.state]
  const StateIcon = look.icon
  const minutes = minutesSince(d.openedAt, p.now)
  const late = d.state !== 'cobrada' && minutes >= p.warnMinutes
  const savedPending = d.lines.filter(l => !l.fireId)
  const pendingCount = savedPending.length + p.local.length
  const localTotal = p.local.reduce((s, l) => s + l.totalPrice, 0)
  const total = d.total + localTotal
  const paid = d.paidAt != null
  const hasSent = d.fires.length > 0

  return (
    <>
      {/* Cabecera de la mesa */}
      <div className="px-4 py-3 border-b border-tpv-line shrink-0">
        <div className="flex items-center gap-2">
          <button type="button" onClick={p.onClose} aria-label="Volver a la sala" className="w-12 h-12 rounded-full flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface-2 shrink-0"><ArrowLeft size={22} /></button>
          <div className="flex-1 min-w-0">
            <p className="text-tpv-amount font-extrabold text-tpv-txt leading-none truncate">Mesa {d.tableName}</p>
            <p className="text-xs font-bold uppercase tracking-wide text-tpv-txt-2 truncate">{d.zoneName}{d.servedByName ? ` · ${d.servedByName}` : ''}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="inline-flex items-center gap-1 text-sm font-bold text-tpv-txt"><Users size={15} aria-hidden /> {d.covers}</span>
            <span className={`inline-flex items-center gap-1 text-sm font-bold ${late ? 'text-tpv-warn' : 'text-tpv-txt-2'}`}><Clock size={14} aria-hidden /> {formatDuration(minutes)}</span>
          </div>
        </div>
        <span className={`mt-2 inline-flex items-center gap-1.5 rounded-tpv px-2 py-1 text-xs font-extrabold ${look.chip}`}>
          <StateIcon size={14} aria-hidden /> {look.label}
        </span>
      </div>

      {/* Líneas por envío */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
        {d.fires.map(f => {
          const lines = d.lines.filter(l => l.fireId === f.id)
          return (
            <section key={f.id}>
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-tpv-txt-2 mb-1.5">
                Envío {f.number} · {formatClock(f.firedAt)}{f.firedByName ? ` · ${f.firedByName}` : ''}
              </h3>
              <div className="space-y-2">
                {lines.map(l => (
                  <button
                    key={l.id}
                    type="button"
                    disabled={!!l.voidedAt || paid}
                    onClick={() => p.onVoid(l)}
                    className="w-full text-left p-3 rounded-tpv border border-tpv-line bg-tpv-surface-2 disabled:cursor-default"
                  >
                    <LineBody name={l.name} summary={l.summary} note={l.kitchenNote} qty={l.quantity} total={l.voidedAt ? 0 : l.lineTotal} struck={!!l.voidedAt} />
                    {l.voidedAt && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs font-extrabold text-tpv-danger"><Ban size={13} aria-hidden /> Anulado{l.voidReason ? ` · ${l.voidReason}` : ''}</p>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )
        })}

        {pendingCount > 0 && (
          <section>
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-tpv-accent-text mb-1.5">Sin enviar · {pendingCount}</h3>
            <div className="space-y-2">
              {savedPending.map(l => (
                <div key={l.id} className="p-3 rounded-tpv border border-tpv-accent bg-tpv-surface-2">
                  <LineBody name={l.name} summary={l.summary} note={l.kitchenNote} qty={1} total={l.lineTotal} />
                  <QtyControls qty={l.quantity}
                    onMinus={() => l.quantity > 1 && p.onSavedQty(l, l.quantity - 1)}
                    onPlus={() => p.onSavedQty(l, l.quantity + 1)}
                    onRemove={() => p.onSavedRemove(l)} />
                </div>
              ))}
              {p.local.map(l => (
                <div key={l.key} className="p-3 rounded-tpv border border-tpv-accent bg-tpv-surface-2">
                  <button type="button" onClick={() => p.onLocalNote(l.key)} className="w-full text-left">
                    <LineBody name={l.displayName} summary={l.summary} note={l.kitchenNote} qty={1} total={l.totalPrice} />
                    {!l.kitchenNote && <p className="text-xs text-tpv-txt-2 mt-1">+ Añadir nota de cocina</p>}
                  </button>
                  <QtyControls qty={l.quantity}
                    onMinus={() => p.onLocalQty(l.key, -1)}
                    onPlus={() => p.onLocalQty(l.key, 1)}
                    onRemove={() => p.onLocalRemove(l.key)} />
                </div>
              ))}
            </div>
          </section>
        )}

        {!hasSent && pendingCount === 0 && (
          <p className="text-sm text-tpv-txt-2 text-center py-10">Toca productos para tomar nota.</p>
        )}
      </div>

      {/* Total y acciones */}
      <div className="px-4 py-3 border-t border-tpv-line space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-tpv-txt-2">Total</span>
          <b className="text-tpv-total font-extrabold text-tpv-txt">{eur(total)}</b>
        </div>

        {paid ? (
          <button type="button" onClick={p.onClear} disabled={p.busy}
            className="w-full min-h-tap-critical rounded-tpv text-lg font-extrabold bg-tpv-ok text-white inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {p.busy ? <Loader2 className="animate-spin" size={20} /> : <CheckCheck size={20} />} Mesa lista
          </button>
        ) : !payPick ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={p.onFire} disabled={p.busy || pendingCount === 0}
                className="inline-flex items-center justify-center gap-1.5 min-h-tap rounded-tpv text-sm font-extrabold bg-tpv-accent text-white disabled:opacity-50 transition-base">
                {p.busy ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />} Enviar a cocina{pendingCount > 0 ? ` · ${pendingCount}` : ''}
              </button>
              <button type="button" onClick={p.onRequestBill} disabled={p.busy || !hasSent || pendingCount > 0}
                className="inline-flex items-center justify-center gap-1.5 min-h-tap rounded-tpv text-sm font-bold border border-tpv-line bg-tpv-surface-2 text-tpv-txt disabled:opacity-50 transition-base">
                <Receipt size={17} /> {d.billRequestedAt ? 'Otra vez la cuenta' : 'Sacar la cuenta'}
              </button>
            </div>
            {/* Cobrar aislado: fila propia, sin vecino (sistema de diseño §3, anti-patrón 8). */}
            <button type="button" onClick={() => setPayPick(true)} disabled={p.busy || !hasSent || pendingCount > 0}
              className="w-full min-h-tap-critical rounded-tpv text-lg font-extrabold bg-tpv-ok text-white hover:opacity-90 disabled:opacity-50 transition-base">
              💶 COBRAR
            </button>
            {pendingCount > 0 && hasSent && (
              <p className="text-xs text-tpv-txt-2 text-center">Hay {pendingCount} sin enviar: envíalo o quítalo para sacar la cuenta o cobrar.</p>
            )}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setPayPick(false); p.onCharge('cash') }} disabled={p.busy}
              className="inline-flex items-center justify-center gap-1.5 min-h-tap-critical rounded-tpv text-base font-extrabold bg-tpv-ok text-white disabled:opacity-50">
              <Banknote size={18} /> Efectivo
            </button>
            <button type="button" onClick={() => { setPayPick(false); p.onCharge('card') }} disabled={p.busy}
              className="inline-flex items-center justify-center gap-1.5 min-h-tap-critical rounded-tpv text-base font-extrabold bg-tpv-ok text-white disabled:opacity-50">
              <CreditCard size={18} /> Tarjeta
            </button>
            <button type="button" onClick={() => setPayPick(false)} className="col-span-2 min-h-tap-small text-sm font-bold text-tpv-txt-2 underline">Cancelar cobro</button>
          </div>
        )}
      </div>
    </>
  )
}
