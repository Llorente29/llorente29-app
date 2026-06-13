// src/modules/kds/components/KdsTicketCard.tsx
//
// Una tarjeta = un ticket. Tema oscuro, alto contraste, objetivos táctiles
// amplios (se ve en TV/tablet a distancia). Líneas agrupadas por estación + un
// cajón "Sin estación" (líneas con station_id null mientras el ruteo no esté
// sembrado). Por estación, un botón bump/recall. Marcado por plato a la
// izquierda; tocar el NOMBRE abre el Cook Mode (los dos gestos no colisionan).

import { Check, ChefHat, Undo2, AlertTriangle } from 'lucide-react'
import type { KdsTicket, KdsLine } from '../services/kdsService'
import { ticketCode, channelLabel, timeLevel, timeChipClasses } from '../kdsUtils'

const SIN_ESTACION = '__none__'

interface KdsTicketCardProps {
  ticket: KdsTicket
  /** id de estación → nombre (con sesión). Si falta, se muestra etiqueta corta. */
  stationNames: Record<string, string>
  /** Estaciones que este dispositivo muestra (null = todas). */
  stationFilter: string[] | null
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
  ticket, stationNames, stationFilter, isNew, busy,
  onBump, onUnbump, onMarkLine, onOpenCook,
}: KdsTicketCardProps) {
  const level = timeLevel(ticket.minutos)
  const groups = groupByStation(ticket, stationFilter)
  const channel = channelLabel(ticket.channel)

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
                  <li
                    key={line.line_id}
                    className="flex items-stretch gap-2 px-2 py-1.5 hover:bg-zinc-700/30"
                  >
                    {/* Check de marcado (gesto 1) */}
                    <button
                      onClick={() => onMarkLine(line)}
                      className={`shrink-0 w-9 h-9 rounded-md grid place-items-center ring-1 transition-colors ${
                        line.marked
                          ? 'bg-emerald-500/30 ring-emerald-400 text-emerald-300'
                          : 'bg-zinc-900/40 ring-zinc-600 text-zinc-500 hover:text-zinc-300'
                      }`}
                      aria-label={line.marked ? 'Desmarcar plato' : 'Marcar plato'}
                    >
                      <Check size={18} />
                    </button>

                    {/* Cantidad */}
                    <span className="shrink-0 self-center w-7 text-right text-lg font-bold tabular-nums text-zinc-300">
                      {line.qty}
                    </span>

                    {/* Nombre (gesto 2: abre Cook Mode) */}
                    <button
                      onClick={() => { if (line.has_recipe) onOpenCook(line) }}
                      disabled={!line.has_recipe}
                      className={`flex-1 text-left self-center leading-tight ${
                        line.marked ? 'line-through text-zinc-500' : 'text-zinc-100'
                      } ${line.has_recipe ? 'hover:text-emerald-300 cursor-pointer' : 'cursor-default'}`}
                    >
                      <span className="text-[15px] font-medium">{line.name}</span>
                      {line.has_recipe && <ChefHat size={13} className="inline ml-1.5 -mt-0.5 text-zinc-500" />}
                      {line.allergens.length > 0 && (
                        <span className="ml-1.5 text-amber-400/80 text-xs align-middle" title={line.allergens.join(', ')}>
                          ⚠ {line.allergens.length}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </article>
  )
}
