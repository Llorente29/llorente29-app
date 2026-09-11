// src/modules/tablet/AgotarExtraModal.tsx
//
// «Agotar extra» desde la tablet de cocina (11/09/2026). Oscuro y táctil, igual
// que el resto de la Estación.
//
// EL ALCANCE SE DICE ANTES DE PULSAR, no después (regla 8). Un extra vive
// repartido en copias —«Salsa Yogur» son TRECE en Foodint— y quien lo agota
// tiene derecho a saber cuántas va a tumbar y cuántas se van a quedar fuera
// por no tener referencia de canal.

import { useEffect, useRef, useState } from 'react'
import { X, Search, Loader2, CircleOff, AlertTriangle } from 'lucide-react'
import { searchExtras, setExtraAvailability, type ExtraPick } from './services/tabletAvailabilityService'

const HORAS: { label: string; horas: number | null }[] = [
  { label: 'Hasta que lo reactive', horas: null },
  { label: '2 horas', horas: 2 },
  { label: 'Fin del servicio (4 h)', horas: 4 },
]

export default function AgotarExtraModal({
  token, locationName, onClose, onDone,
}: {
  token: string
  locationName: string
  onClose: () => void
  onDone: (mensaje: string) => void
}) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<ExtraPick[]>([])
  const [buscando, setBuscando] = useState(false)
  const [sel, setSel] = useState<ExtraPick | null>(null)
  const [horas, setHoras] = useState<number | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [])

  // Los `setState` van DENTRO del temporizador y no en el cuerpo del efecto:
  // la regla `react-hooks/set-state-in-effect` marca el segundo, y el lint se
  // mide a los dos lados (761 errores en `origin/main`, 761 con esto).
  useEffect(() => {
    let cancel = false
    const t = setTimeout(() => {
      if (cancel) return
      if (q.trim().length < 2) { setRows([]); return }
      setBuscando(true)
      searchExtras(token, q)
        .then(r => { if (!cancel) { setRows(r); setError(null) } })
        .catch(e => { if (!cancel) setError(e instanceof Error ? e.message : 'No se pudo buscar') })
        .finally(() => { if (!cancel) setBuscando(false) })
    }, 250)
    return () => { cancel = true; clearTimeout(t) }
  }, [q, token])

  async function agotar() {
    if (!sel) return
    setGuardando(true); setError(null)
    try {
      const until = horas == null ? null : new Date(Date.now() + horas * 3600_000).toISOString()
      const r = await setExtraAvailability(token, sel.optionId, false, 'stock_out', until, 'sin_stock')
      // Regla 8: la confirmación lleva contenido. Y si algo se queda fuera, se
      // dice en la misma frase, no en una nota al pie que nadie lee.
      const fuera = r.sinRef > 0
        ? ` ${r.sinRef} ${r.sinRef === 1 ? 'copia se queda' : 'copias se quedan'} fuera por no tener referencia de canal.`
        : ''
      onDone(`${sel.name} agotado en ${r.opciones} ${r.opciones === 1 ? 'sitio' : 'sitios'} de la carta.${fuera}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo agotar')
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-2xl bg-zinc-950 rounded-2xl ring-1 ring-zinc-800 overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 shrink-0">
          <CircleOff size={22} className="text-amber-400" />
          <span className="text-lg font-bold text-zinc-100">Agotar extra</span>
          <span className="text-sm text-zinc-500">· {locationName}</span>
          <button onClick={onClose} aria-label="Cerrar" className="ml-auto p-2 text-zinc-500 hover:text-zinc-200">
            <X size={22} />
          </button>
        </div>

        <div className="px-5 py-4 shrink-0">
          <div className="flex items-center gap-3 bg-zinc-900 ring-1 ring-zinc-800 rounded-xl px-4">
            <Search size={20} className="text-zinc-500 shrink-0" />
            <input
              ref={input}
              value={q}
              onChange={e => { setQ(e.target.value); setSel(null) }}
              placeholder="Salsa, bacon, extra de queso…"
              className="flex-1 bg-transparent py-4 text-lg text-zinc-100 placeholder:text-zinc-600 outline-none"
            />
            {buscando && <Loader2 size={20} className="animate-spin text-zinc-600" />}
          </div>
        </div>

        {error && (
          <div className="mx-5 mb-3 rounded-lg bg-red-500/15 text-red-200 ring-1 ring-red-500/40 px-3 py-2 text-sm shrink-0">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {q.trim().length < 2 ? (
            <p className="text-zinc-600 text-center py-10">Escribe dos letras para buscar.</p>
          ) : rows.length === 0 && !buscando ? (
            <p className="text-zinc-600 text-center py-10">Ningún extra con «{q}».</p>
          ) : (
            <div className="grid gap-2">
              {rows.map(r => {
                const elegido = sel?.clave === r.clave
                return (
                  <button
                    key={r.clave}
                    onClick={() => setSel(r)}
                    className={`text-left px-4 py-3 rounded-xl ring-1 transition-colors ${
                      elegido ? 'bg-amber-500/15 ring-amber-500/60' : 'bg-zinc-900 ring-zinc-800 hover:ring-zinc-700'
                    }`}
                  >
                    <p className="font-semibold text-zinc-100 text-lg">{r.name}</p>
                    <p className="text-sm text-zinc-500">
                      {r.opciones} {r.opciones === 1 ? 'sitio' : 'sitios'} de la carta · {r.marcas} {r.marcas === 1 ? 'marca' : 'marcas'}
                      {r.sinRef > 0 && (
                        <span className="ml-2 text-amber-400">
                          · {r.sinRef} sin referencia de canal
                        </span>
                      )}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {sel && (
          <div className="border-t border-zinc-800 px-5 py-4 shrink-0 space-y-3">
            <div className="flex gap-2 flex-wrap">
              {HORAS.map(h => (
                <button
                  key={h.label}
                  onClick={() => setHoras(h.horas)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-semibold ring-1 ${
                    horas === h.horas ? 'bg-zinc-100 text-zinc-950 ring-zinc-100' : 'bg-zinc-900 text-zinc-300 ring-zinc-800'
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>
            {sel.sinRef > 0 && (
              <p className="flex items-start gap-2 text-sm text-amber-300">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                {sel.sinRef} de las {sel.opciones} copias no tienen referencia de canal y
                seguirán vendiéndose en las plataformas. Avisa a oficina.
              </p>
            )}
            <button
              onClick={() => void agotar()}
              disabled={guardando}
              className="w-full py-4 rounded-xl bg-amber-500 text-zinc-950 text-lg font-bold hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {guardando ? <Loader2 size={20} className="animate-spin" /> : <CircleOff size={20} />}
              Agotar {sel.name} en {sel.conRef} {sel.conRef === 1 ? 'sitio' : 'sitios'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
