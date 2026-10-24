// src/modules/pos/components/FloorView.tsx
//
// TPV · Sala (S1) — maqueta «Folvy TPV · Sala», pantallas 1 (tablet) y 6
// (móvil, a dos columnas). Pestañas por zona con su ocupación; la rejilla de
// mesas ordenada (no plano dibujado) a 5 columnas que llenan el alto; cada
// mesa: número, comensales o sitios, estado (color + icono + palabra), tiempo
// (ámbar desde el umbral del local) e importe.
//
// A la derecha, SOLO «Ahora mismo». Las reservas y «Apuntar una reserva» /
// «Mover o juntar mesas» de la maqueta van en sus encargos (Reservas, S2): no
// se dejan botones que no hacen nada.

import { useMemo, useState, type CSSProperties } from 'react'
import { LayoutGrid } from 'lucide-react'
import type { Floor, FloorTable } from '@/modules/pos/services/posTableService'
import { TABLE_STATE_LOOK, minutesSince, formatDuration, zoneOccupancyLabel } from '@/modules/pos/lib/tableState'

// eslint-disable-next-line no-restricted-syntax -- n es un importe ya numérico del RPC, solo se formatea
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

// En el móvil (maqueta, pantalla 6) toda mesa ocupa un hueco: a dos columnas
// una mesa ancha dejaría la fila entera para ella sola.
const COL_SPAN: Record<number, string> = { 2: 'lg:col-span-2', 3: 'lg:col-span-3', 4: 'lg:col-span-4' }

function TableTile({ table, warnMinutes, now, onTap }: { table: FloorTable; warnMinutes: number; now: number; onTap: () => void }) {
  const s = table.sale
  const look = TABLE_STATE_LOOK[s?.state ?? 'libre']
  const Icon = look.icon
  const minutes = s ? minutesSince(s.openedAt, now) : 0
  const late = s != null && s.state !== 'cobrada' && minutes >= warnMinutes
  return (
    <button
      type="button"
      onClick={onTap}
      className={`${COL_SPAN[table.gridWidth] ?? ''} min-h-tpv-table-sm lg:min-h-0 rounded-tpv-tile border-2 ${look.tile} px-3.5 py-3 lg:px-4 lg:py-3.5 text-tpv-txt text-left flex flex-col gap-1.5 lg:gap-2 active:scale-[0.98] transition-base`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <b className="text-tpv-table-num-sm lg:text-tpv-table-num font-extrabold leading-none">{table.name}</b>
        <span className="text-tpv-tab lg:text-base font-bold text-tpv-txt-2">{s ? `${s.covers} pers.` : `${table.seats} sitios`}</span>
      </span>
      <span className={`flex items-center gap-1.5 text-sm lg:text-tpv-tab font-extrabold leading-tight ${look.ink}`}>
        <Icon size={18} strokeWidth={2.3} className="shrink-0" aria-hidden /> {look.label}
      </span>
      <span className="flex-grow" />
      {s && (
        <span className="flex items-baseline justify-between gap-2">
          <span className={`text-tpv-tab lg:text-base font-bold ${late ? 'text-tpv-warn-text' : 'text-tpv-txt-2'}`}>{formatDuration(minutes)}</span>
          {s.state !== 'cobrada' && <b className="text-tpv-name lg:text-tpv-zone font-extrabold">{eur(s.total)}</b>}
        </span>
      )}
    </button>
  )
}

export default function FloorView({ floor, now, onTapTable, onStartMove }: {
  floor: Floor
  now: number
  onTapTable: (table: FloorTable) => void
  onStartMove?: () => void
}) {
  const [zoneId, setZoneId] = useState<string | null>(null)
  const zone = floor.zones.find(z => z.id === zoneId) ?? floor.zones[0] ?? null

  const occupancy = useMemo(() => floor.zones.map(z => {
    const open = z.tables.filter(t => t.sale)
    return { id: z.id, name: z.name, kind: z.kind, busy: open.length, total: z.tables.length, covers: open.reduce((s, t) => s + (t.sale?.covers ?? 0), 0) }
  }), [floor])
  const totalCovers = occupancy.reduce((s, z) => s + z.covers, 0)
  const byZone = occupancy.filter(o => o.covers > 0).map(o => `${o.covers} en ${o.name.toLowerCase()}`).join(' · ')

  // La rejilla llena el alto en tablet: tantas filas como hagan falta para
  // las mesas de la zona (las anchas cuentan doble), con un suelo de 150 px.
  const rows = Math.max(3, Math.ceil((zone?.tables ?? []).reduce((n, t) => n + Math.min(t.gridWidth, 5), 0) / 5))

  if (floor.zones.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center text-tpv-txt-2">
        <LayoutGrid size={40} aria-hidden />
        <p className="text-base font-bold text-tpv-txt">Este local aún no tiene sala montada.</p>
        <p className="text-sm max-w-sm">Las zonas y las mesas se crean en Configuración → Locales → este local → «Sala y mesas (TPV)».</p>
      </div>
    )
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col lg:flex-row gap-5 p-4 lg:p-5 overflow-hidden">
      <section className="flex-1 min-w-0 min-h-0 flex flex-col gap-3 lg:gap-3.5">
        <div className="grid grid-cols-3 gap-2 lg:gap-2.5 shrink-0">
          {occupancy.map(o => {
            const active = zone?.id === o.id
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setZoneId(o.id)}
                className={`h-tap rounded-tpv flex flex-col lg:flex-row items-center justify-center gap-0.5 lg:gap-3 font-extrabold text-tpv-name lg:text-tpv-zone transition-base ${active ? 'border-2 border-tpv-accent bg-tpv-accent text-white' : 'border border-tpv-line-strong bg-tpv-surface-2 text-tpv-txt'}`}
              >
                {o.name}
                <span className={`text-tpv-tab-sm lg:text-tpv-tab font-bold ${active ? 'text-white/90' : 'text-tpv-txt-2'}`}>
                  <span className="lg:hidden">{zoneOccupancyLabel(o.kind, o.busy, o.total, true)}</span>
                  <span className="hidden lg:inline">{zoneOccupancyLabel(o.kind, o.busy, o.total)}</span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {zone && zone.tables.length === 0 && (
            <p className="text-center text-sm text-tpv-txt-2 py-10">Esta zona no tiene mesas.</p>
          )}
          <div
            className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 lg:gap-3 lg:h-full lg:[grid-template-rows:var(--rows)]"
            style={{ '--rows': `repeat(${rows}, minmax(150px, 1fr))` } as CSSProperties}
          >
            {zone?.tables.map(t => (
              <TableTile key={t.id} table={t} warnMinutes={floor.warnMinutes} now={now} onTap={() => onTapTable(t)} />
            ))}
          </div>
        </div>
      </section>

      <aside className="hidden lg:flex w-[320px] shrink-0 flex-col gap-3.5">
        <div className="px-5 py-[18px] rounded-2xl bg-tpv-surface border border-tpv-line flex flex-col gap-1">
          <span className="text-sm font-extrabold tracking-[0.06em] uppercase text-tpv-txt-2">Ahora mismo</span>
          <b className="text-tpv-covers-big font-extrabold">{totalCovers} comensal{totalCovers === 1 ? '' : 'es'}</b>
          <span className="text-base text-tpv-txt-2">{byZone || 'Ninguna mesa abierta'}</span>
        </div>
        <div className="flex-grow" />
        {onStartMove && occupancy.some(o => o.busy > 0) && (
          <button type="button" onClick={onStartMove}
            className="h-tap rounded-tpv border border-tpv-line-strong bg-tpv-surface-2 text-tpv-txt text-lg font-bold">
            Mover o juntar mesas
          </button>
        )}
      </aside>
    </main>
  )
}
