// src/modules/kds/components/KdsTicketCard.tsx
//
// Una tarjeta = un ticket. Tema oscuro, alto contraste, objetivos táctiles
// amplios (se ve en TV/tablet a distancia). Líneas agrupadas por estación. Por
// estación, un botón bump/recall. Marcado por plato a la izquierda; tocar el
// NOMBRE abre el Cook Mode (los dos gestos no colisionan). Pie de tarjeta: botón
// "Servir" (bump del Pase) que cierra el ticket en cocina.
//
// Rebrand 30/06/2026 (A+B): semáforos en verde/ámbar/rojo de MARCA
// (#1F9D6B / #C2890F / #E0492E); AVATAR de marca (logo real o inicial) y badge
// de PLATAFORMA con logo en la cabecera, para identificar de un vistazo en
// cocina (clave con muchas marcas). Código del ticket en Space Grotesk.
//
// TICKET COMPLETO (Nivel 1a): cada línea puede traer `children` (componentes de
// combo y/o modificadores) y `customer_note`. Combo → cabecera pequeña y gris
// (contexto) con sus componentes en grande debajo (lo cocinable destaca).
// Modificadores → sangrados y diferenciados bajo el plato. Nota de cliente →
// chip rojo MUY visible, pegado a la línea del plato (no banda global).
//
// Cajón "Sin estación": el backend rutea las líneas sin familia a la estación
// por defecto del local, así que con datos normales NO aparece. Se conserva por
// ROBUSTEZ: si faltara la default, las líneas con station_id null siguen visibles.

import { useEffect, useRef, useState } from 'react'
import { Check, ChefHat, Undo2, AlertTriangle } from 'lucide-react'
import type { KdsTicket, KdsLine, KdsLineChild } from '../services/kdsService'
import { ticketCode, channelBadge, timeLevel, timeChipClasses } from '../kdsUtils'

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
    if (stationFilter && line.station_id !== null && !stationFilter.includes(line.station_id)) {
      continue
    }
    const arr = map.get(key)
    if (arr) arr.push(line)
    else map.set(key, [line])
  }
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

// ── Avatar de marca (logo real o inicial) ───────────────────────────────────
function BrandAvatar({ name, logoUrl }: { name: string | null; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false)
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?'
  if (logoUrl && !failed) {
    return (
      <span className="w-8 h-8 rounded-lg overflow-hidden shrink-0 ring-1 ring-zinc-700 bg-white grid place-items-center">
        <img src={logoUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      </span>
    )
  }
  return (
    <span className="w-8 h-8 rounded-lg shrink-0 grid place-items-center bg-zinc-700 text-zinc-100 font-display font-bold text-[14px]">
      {initial}
    </span>
  )
}

// ── Badge de plataforma (logo en cajita blanca + nombre) ────────────────────
function KdsChannelBadge({ channel }: { channel: string }) {
  const [failed, setFailed] = useState(false)
  const b = channelBadge(channel)
  if (!b) return null
  const showLogo = b.logo != null && !failed
  return (
    <span className="inline-flex items-center gap-1.5 pl-0.5 pr-2 py-0.5 rounded-md bg-zinc-900 ring-1 ring-zinc-700 text-zinc-200 text-[11px] font-semibold whitespace-nowrap shrink-0">
      {showLogo ? (
        <span className="w-5 h-5 rounded bg-white grid place-items-center overflow-hidden shrink-0">
          <img src={b.logo!} alt="" className="w-full h-full object-contain" loading="lazy" onError={() => setFailed(true)} />
        </span>
      ) : (
        <span className="w-2 h-2 rounded-full shrink-0 ml-1" style={{ backgroundColor: b.color }} />
      )}
      {b.label}
    </span>
  )
}

export default function KdsTicketCard({
  ticket, stationNames, stationFilter, expoStationId, isNew, busy,
  onBump, onUnbump, onMarkLine, onOpenCook,
}: KdsTicketCardProps) {
  const level = timeLevel(ticket.minutos)
  const groups = groupByStation(ticket, stationFilter)

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
        isNew ? 'ring-[#1F9D6B] shadow-lg shadow-[#1F9D6B]/25' : 'ring-zinc-700'
      } ${level === 'late' ? 'ring-[#E0492E]/55' : ''}`}
    >
      {/* Cabecera: avatar de marca + código + tiempo / badge de plataforma + marca */}
      <header className="px-3 py-2.5 bg-zinc-900/60 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <BrandAvatar name={ticket.brand} logoUrl={ticket.brand_logo_url} />
          <span className="text-lg font-extrabold tabular-nums text-zinc-100 font-display flex-1 min-w-0 truncate">
            {ticketCode(ticket.external_tab_ref, ticket.external_ref)}
          </span>
          <span className={`px-2 py-0.5 rounded-md text-sm font-bold tabular-nums shrink-0 ${timeChipClasses(level)}`}>
            {ticket.minutos}′
          </span>
        </div>
        {(ticket.channel || ticket.brand) && (
          <div className="flex items-center gap-2 mt-1.5 min-w-0">
            {ticket.channel && <KdsChannelBadge channel={ticket.channel} />}
            {ticket.brand && <span className="text-xs text-zinc-400 truncate">{ticket.brand}</span>}
          </div>
        )}
      </header>

      {/* Estaciones */}
      <div className="flex flex-col divide-y divide-zinc-700/70">
        {groups.map(group => {
          const isSin = group.stationId === SIN_ESTACION
          const state = !isSin ? ticket.estaciones?.[group.stationId] : undefined
          const done = state === 'done'
          return (
            <section key={group.stationId} className={done ? 'opacity-60' : ''}>
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-zinc-800">
                <span className={`text-xs font-semibold uppercase tracking-wide ${isSin ? 'text-[#E8B84B]' : 'text-zinc-400'}`}>
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
                      className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-bold bg-[#1F9D6B] text-white hover:bg-[#23B07A] disabled:opacity-50"
                    >
                      <Check size={14} /> Listo
                    </button>
                  )
                )}
              </div>

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
              ? 'bg-[#C2890F] text-white hover:bg-[#D69A1F] ring-2 ring-[#E8B84B] animate-pulse'
              : 'bg-[#1F9D6B] text-white hover:bg-[#23B07A]'
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

// Nota de cliente: chip muy visible (rojo de marca) pegado a la línea del plato.
function NoteChip({ note }: { note: string }) {
  return (
    <div className="mt-1 flex items-start gap-1.5 rounded-md bg-[#E0492E]/25 ring-1 ring-[#E0492E]/60 px-2 py-1 text-[13px] font-semibold text-[#FCE0D8]">
      <AlertTriangle size={14} className="shrink-0 mt-0.5 text-[#F4856E]" />
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
              ? 'bg-[#1F9D6B]/30 ring-[#1F9D6B] text-[#5FD3A0]'
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
              <div className={`text-xs font-medium ${struck ? 'line-through text-zinc-600' : 'text-zinc-400'}`}>
                ▸ {line.name}
              </div>
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
            <button
              onClick={() => { if (clickable) onOpenCook(line) }}
              disabled={!clickable}
              className={`text-left leading-tight ${
                struck ? 'line-through text-zinc-500' : 'text-zinc-100'
              } ${clickable ? 'hover:text-[#5FD3A0] cursor-pointer' : 'cursor-default'}`}
            >
              <span className="text-[15px] font-medium">{line.name}</span>
              {clickable && <ChefHat size={13} className="inline ml-1.5 -mt-0.5 text-zinc-500" />}
              {line.allergens.length > 0 && (
                <span className="ml-1.5 text-[#E8B84B] text-xs align-middle" title={line.allergens.join(', ')}>
                  ⚠ {line.allergens.length}
                </span>
              )}
            </button>
          )}

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

          {line.customer_note && <NoteChip note={line.customer_note} />}
        </div>
      </div>
    </li>
  )
}
