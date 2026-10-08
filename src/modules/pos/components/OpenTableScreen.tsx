// src/modules/pos/components/OpenTableScreen.tsx
//
// TPV · Sala (S1) — maqueta «Folvy TPV · Sala», pantalla 2: «Abrir una mesa».
// Pantalla completa: «¿Cuántos son?» con ocho números enormes y «Son más de
// 8». Tocar un número abre la mesa y pasa a tomar nota, sin confirmar.
// Comensales obligatorios: no hay forma de abrir sin decirlo.
//
// El panel «¿Vienen con reserva?» de la maqueta va con el encargo de Reservas:
// aquí no se deja un panel vacío ni un botón que no hace nada.

import { useState } from 'react'
import { ArrowLeft, Loader2, Minus, Plus } from 'lucide-react'

const NUMS = [1, 2, 3, 4, 5, 6, 7, 8]

export default function OpenTableScreen({ tableName, zoneName, seats, busy, onPick, onClose }: {
  tableName: string
  zoneName: string
  seats: number
  busy: boolean
  onPick: (covers: number) => void
  onClose: () => void
}) {
  const [more, setMore] = useState(false)
  const [n, setN] = useState(9)

  return (
    <div className="fixed inset-0 z-40 bg-tpv-bg text-tpv-txt flex flex-col" role="dialog" aria-modal="true" aria-label={`Abrir mesa ${tableName}`}>
      <header className="min-h-tpv-header shrink-0 px-4 lg:px-5 py-2 bg-tpv-surface border-b border-tpv-line flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" onClick={onClose}
          className="h-tap-small px-4 rounded-tpv border border-tpv-line-strong bg-tpv-surface-2 text-tpv-txt text-base font-bold inline-flex items-center gap-2">
          <ArrowLeft size={20} strokeWidth={2.4} aria-hidden /> Volver a la sala
        </button>
        <b className="text-tpv-title font-extrabold">Mesa {tableName} · {zoneName}</b>
        <span className="text-base font-bold text-tpv-txt-2">{seats} sitios · libre</span>
      </header>

      <main className="flex-1 min-h-0 flex flex-col gap-4 p-4 lg:p-5">
        <h1 className="text-tpv-table-num font-extrabold m-0">¿Cuántos son?</h1>
        {!more ? (
          <>
            <div className="flex-1 min-h-0 grid grid-cols-4 grid-rows-2 gap-2.5 lg:gap-3.5">
              {NUMS.map(c => (
                <button key={c} type="button" disabled={busy} onClick={() => onPick(c)}
                  className="min-h-tap rounded-2xl border-2 border-tpv-line-strong bg-tpv-surface-2 text-tpv-txt text-tpv-table-num lg:text-tpv-covers-pick font-extrabold active:bg-tpv-accent active:border-tpv-accent disabled:opacity-50">
                  {c}
                </button>
              ))}
            </div>
            <button type="button" disabled={busy} onClick={() => setMore(true)}
              className="h-tap shrink-0 rounded-tpv border border-tpv-line-strong bg-tpv-surface-2 text-tpv-txt text-tpv-zone font-bold disabled:opacity-50">
              Son más de 8
            </button>
          </>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6">
            <div className="flex items-center gap-6">
              <button type="button" onClick={() => setN(v => Math.max(9, v - 1))} aria-label="Uno menos"
                className="w-tap-critical h-tap-critical rounded-2xl border-2 border-tpv-line-strong bg-tpv-surface-2 flex items-center justify-center"><Minus size={32} /></button>
              <span className="text-tpv-covers-pick font-extrabold min-w-[2ch] text-center">{n}</span>
              <button type="button" onClick={() => setN(v => Math.min(99, v + 1))} aria-label="Uno más"
                className="w-tap-critical h-tap-critical rounded-2xl border-2 border-tpv-line-strong bg-tpv-surface-2 flex items-center justify-center"><Plus size={32} /></button>
            </div>
            <button type="button" disabled={busy} onClick={() => onPick(n)}
              className="h-tap px-10 rounded-tpv bg-tpv-accent text-white text-tpv-zone font-extrabold inline-flex items-center gap-2 disabled:opacity-50">
              {busy && <Loader2 size={20} className="animate-spin" />} Abrir mesa · {n} comensales
            </button>
            <button type="button" onClick={() => setMore(false)} className="h-tap-small px-4 text-base font-bold text-tpv-txt-2 underline">Volver a 1–8</button>
          </div>
        )}
      </main>
    </div>
  )
}
