// src/modules/kds/components/KdsTicketCard.tsx
//
// Una tarjeta = un ticket. Tema oscuro, alto contraste, objetivos táctiles
// amplios (se ve en TV/tablet a distancia). Líneas agrupadas por estación. Por
// estación, un botón bump/recall. Marcado por plato a la izquierda; tocar el
// NOMBRE abre el Cook Mode (los dos gestos no colisionan). Pie de tarjeta: botón
// "Servir" (bump del Pase) que cierra el ticket en cocina.
//
// TICKET COMPLETO (Nivel 1a): cada línea puede traer `children` (componentes de
// combo y/o modificadores) y `customer_note`. Combo → cabecera pequeña y gris
// (contexto) con sus componentes en grande debajo (lo cocinable destaca).
// Modificadores → sangrados y diferenciados bajo el plato. Nota de cliente →
// chip ámbar-rojo MUY visible, pegado a la línea del plato (no banda global).
// El marcado y el Cook Mode siguen en la línea producto; las hijas no tienen
// check propio (se marcan con el padre).
//
// Cajón "Sin estación": ahora el backend rutea las líneas sin familia a la
// estación por defecto del local (default_station_id), así que con datos
// normales NO aparece. Se conserva por ROBUSTEZ: si algún día faltara la default,
// las líneas con station_id null siguen siendo visibles (no se pierden).

import { useEffect, useRef, useState } from 'react'
import { Check, ChefHat, Undo2, AlertTriangle } from 'lucide-react'
import type { KdsTicket, KdsLine, KdsLineChild } from '../services/kdsService'
import { ticketCode, channelLabel, timeLevel, timeChipClasses } from '../kdsUtils'

const SIN_ESTACION = '__none__'

interface KdsTicketCardProps {
  ticket: KdsTicket
  /** id de estación → nombre (con sesión). Si falta, se muestra etiqueta corta. */
  stationNames: Record<string, string>
  /** Estaciones que este dispositivo muestra (null = todas). */
  stationFilter: string[] | null
  /** Estación de Pase del local (board.expo_station_id). null → sin Pase
   *  configurado: el botón Servir se deshabilita. */
  expoStationId: string | null
  isNew: boolean
  busy: boolean
  onBump: (saleId: string, stationId: string) => void
  onUnbump: (saleId: string, stationId: string) => void
  onMarkLine: (line: KdsLine) => void
  onOpenCook: (line: KdsLine) => void
}

interface StationGroup {
  stationId: string // SIN_ESTACION para el cajón sin ruteo
  lines: KdsLine[]
}

function groupByStation(ticket: KdsTicket, stationFilter: string[] | null): StationGroup[] {
  const map = new Map<string, KdsLine[]>()
  for (const line of ticket.lineas) {
    const key = line.station_id ?? SIN_ESTACION
    // Filtro del dispositivo: solo estaciones del filtro (+ cajón sin estación).
    if (stationFilter && line.station_id !== null && !stationFilter.includes(line.station_id)) {
      continue
    }
    const arr = map.get(key)
    if (arr) arr.push(line)
    else map.set(key, [line])
  }
  // Estaciones reales primero (orden estable por nombre), "Sin estación" al final.
  const groups: StationGroup[] = []
  for (const [stationId, lines] of map) {
    if (stationId !== SIN_ESTACION) groups.push({ stationId, lines })
  }
  groups.sort((a, b) => a.stationId.localeCompare(b.stationId))
  const sinEstacion = map.get(SIN_ESTACION)
  if (sinEstacion) groups.push({ stationId: SIN_ESTACION, lines: sinEstacion })
  return groups
}

function stationLabel(stationId: string, names: Record<string, string>): string {
  if (stationId === SIN_ESTACION) return 'Sin estación'
  return names[stationId] ?? `Estación ${stationId.slice(0, 4)}`
}

export default function KdsTicketCard({
  ticket, stationNames, stationFilter, expoStationId, isNew, busy,
  onBump, onUnbump, onMarkLine, onOpenCook,
}: KdsTicketCardProps) {
  const level = timeLevel(ticket.minutos)
  const groups = groupByStation(ticket, stationFilter)
  const channel = channelLabel(ticket.channel)

  // Botón Servir con confirmación de DOS toques (anti-toque-fantasma): el 1er
  // toque arma "¿Servir?" durante ~2 s; el 2º dentro de esa ventana confirma y
  // hace bump del Pase (el ticket sale del board al refrescar). Sin modal.
  const [confirming, setConfirming] = useState(false)
  const timerRef = useRef<number | null>(null)
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current) }, [])

  function handleServe() {
    if (!expoStationId || busy) return
    if (confirming) {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = null
      setConfirming(false)
      onBump(ticket.sale_id, expoStationId)
      return
    }
    setConfirming(true)
    timerRef.current = window.setTimeout(() => {
      setConfirming(false)
      timerRef.current = null
    }, 2000)
  }

  return (
    <article
      className={`flex flex-col rounded-xl bg-zinc-800/70 ring-1 overflow-hidden transition-shadow ${
        isNew ? 'ring-emerald-400 shadow-lg shadow-emerald-500/20' : 'ring-zinc-700'
      } ${level === 'late' ? 'ring-red-500/40' : ''}`}
    >
      {/* Cabecera */}
      <header className="flex items-center justify-between gap-2 px-3 py-2.5 bg-zinc-900/60 border-b border-zinc-700">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg font-extrabold tabular-nums text-zinc-100">
            {ticketCode(ticket.external_tab_ref, ticket.external_ref)}
          </span>
          {channel && (
            <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/40 shrink-0">
              {channel}
            </span>
          )}
          {ticket.brand && (
            <span className="text-xs text-zinc-400 truncate">{ticket.brand}</span>
          )}
        </div>
        <span className={`px-2 py-0.5 rounded-md text-sm font-bold tabular-nums shrink-0 ${timeChipClasses(level)}`}>
          {ticket.minutos}′
        </span>
      </header>

      {/* Estaciones */}
      <div className="flex flex-col divide-y divide-zinc-700/70">
        {groups.map(group => {
          const isSin = group.stationId === SIN_ESTACION
          const state = !isSin ? ticket.estaciones?.[group.stationId] : undefined
          const done = state === 'done'
          return (
            <section key={group.stationId} className={done ? 'opacity-60' : ''}>
              {/* Cabecera de estación + bump */}
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-zinc-800">
                <span className={`text-xs font-semibold uppercase tracking-wide ${isSin ? 'text-amber-300' : 'text-zinc-400'}`}>
                  {isSin && <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />}
                  {stationLabel(group.stationId, stationNames)}
                </span>
                {!isSin && (
                  done ? (
                    <button
                      disabled={busy}
                      onClick={() => onUnbump(ticket.sale_id, group.stationId)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-zinc-700 text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
                    >
                      <Undo2 size={13} /> Recall
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => onBump(ticket.sale_id, group.stationId)}
                      className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-bold bg-emerald-500 text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                    >
                      <Check size={14} /> Listo
                    </button>
                  )
                )}
              </div>

              {/* Líneas de la estación */}
              <ul>
                {group.lines.map(line => (
                  <KdsLineRow
                    key={line.line_id}
                    line={line}
                    onMarkLine={onMarkLine}
                    onOpenCook={onOpenCook}
                  />
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {/* Pie: Servir (cierra el ticket en cocina = bump del Pase) */}
      <div className="p-2 border-t border-zinc-700 bg-zinc-900/40 mt-auto">
        <button
          disabled={busy || !expoStationId}
          onClick={handleServe}
          title={!expoStationId ? 'Configura una estación de Pase en Ajustes → Estaciones' : undefined}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            confirming
              ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400 ring-2 ring-amber-300 animate-pulse'
              : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
          }`}
        >
          {confirming
            ? <>¿Servir? Toca otra vez</>
            : <><Check size={16} /> Servir</>}
        </button>
      </div>
    </article>
  )
}

// Nota de cliente: chip muy visible (ámbar-rojo) pegado a la línea del plato.
// Debe llamar la atención aunque sea la única en 200 tickets.
function NoteChip({ note }: { note: string }) {
  return (
    <div className="mt-1 flex items-start gap-1.5 rounded-md bg-red-500/25 ring-1 ring-red-500/60 px-2 py-1 text-[13px] font-semibold text-red-100">
      <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-300" />
      <span className="leading-snug">{note}</span>
    </div>
  )
}

// Fila de una línea de plato (con sus hijas: combo y/o modificadores) + nota.
function KdsLineRow({ line, onMarkLine, onOpenCook }: {
  line: KdsLine
  onMarkLine: (line: KdsLine) => void
  onOpenCook: (line: KdsLine) => void
}) {
  const children: KdsLineChild[] = line.children ?? []
  const comboItems = children.filter(c => c.line_type === 'combo_item')
  const modifiers = children.filter(c => c.line_type === 'modifier')
  const isCombo = comboItems.length > 0
  // El Cook Mode se abre desde la línea producto cocinable. Un combo (contexto,
  // sin receta propia) NO abre Cook Mode: sus componentes ya están en la tarjeta.
  const clickable = !isCombo && line.has_recipe
  const struck = line.marked

  return (
    <li className="px-2 py-1.5 hover:bg-zinc-700/30">
      <div className="flex items-start gap-2">
        {/* Check de marcado (gesto 1) — marca el plato/combo entero */}
        <button
          onClick={() => onMarkLine(line)}
          className={`shrink-0 w-9 h-9 rounded-md grid place-items-center ring-1 transition-colors ${
            struck
              ? 'bg-emerald-500/30 ring-emerald-400 text-emerald-300'
              : 'bg-zinc-900/40 ring-zinc-600 text-zinc-500 hover:text-zinc-300'
          }`}
          aria-label={struck ? 'Desmarcar plato' : 'Marcar plato'}
        >
          <Check size={18} />
        </button>

        {/* Cantidad */}
        <span className="shrink-0 mt-1 w-7 text-right text-lg font-bold tabular-nums text-zinc-300">
          {line.qty}
        </span>

        <div className="flex-1 min-w-0">
          {isCombo ? (
            <>
              {/* Cabecera de combo: pequeña y atenuada (contexto, no lo cocinable) */}
              <div className={`text-xs font-medium ${struck ? 'line-through text-zinc-600' : 'text-zinc-400'}`}>
                ▸ {line.name}
              </div>
              {/* Componentes: tamaño normal de línea (destacan) */}
              <ul className="mt-0.5 space-y-0.5">
                {comboItems.map(c => (
                  <li key={c.line_id} className={`leading-tight ${struck ? 'line-through text-zinc-500' : 'text-zinc-100'}`}>
                    <span className="text-[15px] font-medium">
                      {c.qty > 1 && <span className="text-zinc-400 mr-1 tabular-nums">{c.qty}×</span>}
                      {c.name}
                    </span>
                    {c.customer_note && <NoteChip note={c.customer_note} />}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            /* Nombre del plato (gesto 2: abre Cook Mode si tiene receta) */
            <button
              onClick={() => { if (clickable) onOpenCook(line) }}
              disabled={!clickable}
              className={`text-left leading-tight ${
                struck ? 'line-through text-zinc-500' : 'text-zinc-100'
              } ${clickable ? 'hover:text-emerald-300 cursor-pointer' : 'cursor-default'}`}
            >
              <span className="text-[15px] font-medium">{line.name}</span>
              {clickable && <ChefHat size={13} className="inline ml-1.5 -mt-0.5 text-zinc-500" />}
              {line.allergens.length > 0 && (
                <span className="ml-1.5 text-amber-400/80 text-xs align-middle" title={line.allergens.join(', ')}>
                  ⚠ {line.allergens.length}
                </span>
              )}
            </button>
          )}

          {/* Modificadores: sangrados, diferenciados, más pequeños que el plato */}
          {modifiers.length > 0 && (
            <ul className="mt-0.5 pl-3 border-l border-zinc-700 space-y-0.5">
              {modifiers.map(m => (
                <li key={m.line_id} className={`text-[13px] ${struck ? 'line-through text-zinc-600' : 'text-zinc-400'}`}>
                  {m.qty > 1 && <span className="tabular-nums mr-1">{m.qty}×</span>}{m.name}
                  {m.customer_note && <NoteChip note={m.customer_note} />}
                </li>
              ))}
            </ul>
          )}

          {/* Nota de cliente del plato: pegada a la línea, muy visible */}
          {line.customer_note && <NoteChip note={line.customer_note} />}
        </div>
      </div>
    </li>
  )
}
