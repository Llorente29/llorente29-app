// src/modules/pos/components/FloorView.tsx
//
// TPV · Sala (S1). Pestañas por zona con su ocupación y la rejilla de mesas,
// ordenada (no plano dibujado). Cada mesa: número, comensales, estado (color +
// icono + palabra), tiempo e importe. El tiempo pasa a ámbar a partir del
// umbral del local. A la derecha, solo «Ahora mismo» (comensales por zona): el
// panel de reservas de la maqueta va en su encargo.

import { useMemo, useState } from 'react'
import { Users, Clock, LayoutGrid } from 'lucide-react'
import type { Floor, FloorTable } from '@/modules/pos/services/posTableService'
import { TABLE_STATE_LOOK, minutesSince, formatDuration } from '@/modules/pos/lib/tableState'

// eslint-disable-next-line no-restricted-syntax -- n es un importe ya numérico del RPC, solo se formatea
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

const COL_SPAN: Record<number, string> = { 1: '', 2: 'col-span-2', 3: 'col-span-2 sm:col-span-3', 4: 'col-span-2 sm:col-span-4' }

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
      className={`${COL_SPAN[table.gridWidth] ?? ''} min-h-tpv-product rounded-tpv border-2 ${look.border} ${s ? 'bg-tpv-surface' : 'bg-tpv-surface-2'} p-3 flex flex-col justify-between gap-2 text-left active:scale-[0.98] transition-base`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-tpv-code font-extrabold text-tpv-txt leading-none">{table.name}</span>
        <span className="inline-flex items-center gap-1 text-sm font-bold text-tpv-txt-2">
          <Users size={15} aria-hidden /> {s ? s.covers : table.seats}
          {!s && <span className="sr-only">sitios</span>}
        </span>
      </div>
      <span className={`inline-flex items-center gap-1.5 self-start rounded-tpv px-2 py-1 text-xs font-extrabold ${look.chip}`}>
        <Icon size={14} aria-hidden /> {look.label}
      </span>
      {s && (
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1 text-sm font-bold ${late ? 'text-tpv-warn' : 'text-tpv-txt-2'}`}>
            <Clock size={14} aria-hidden /> {formatDuration(minutes)}
          </span>
          <span className="text-base font-extrabold text-tpv-txt">{eur(s.total)}</span>
        </div>
      )}
    </button>
  )
}

export default function FloorView({ floor, now, onTapTable }: {
  floor: Floor
  now: number
  onTapTable: (table: FloorTable) => void
}) {
  const [zoneId, setZoneId] = useState<string | null>(null)
  const zone = floor.zones.find(z => z.id === zoneId) ?? floor.zones[0] ?? null

  const occupancy = useMemo(() => floor.zones.map(z => {
    const open = z.tables.filter(t => t.sale)
    return { id: z.id, name: z.name, busy: open.length, total: z.tables.length, covers: open.reduce((s, t) => s + (t.sale?.covers ?? 0), 0) }
  }), [floor])
  const totalCovers = occupancy.reduce((s, z) => s + z.covers, 0)

  if (floor.zones.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center text-tpv-txt-2">
        <LayoutGrid size={40} aria-hidden />
        <p className="text-base font-bold text-tpv-txt">Este local aún no tiene sala montada.</p>
        <p className="text-sm max-w-sm">Las zonas y las mesas se crean en Configuración → Locales → este local → «Sala y mesas».</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
      <div className="flex-1 flex flex-col min-h-0">
        <nav className="flex gap-2 px-3 py-2 overflow-x-auto bg-tpv-surface border-b border-tpv-line shrink-0">
          {floor.zones.map(z => {
            const o = occupancy.find(x => x.id === z.id)!
            const active = zone?.id === z.id
            return (
              <button
                key={z.id}
                type="button"
                onClick={() => setZoneId(z.id)}
                className={`shrink-0 min-h-tap-small px-4 rounded-tpv border text-sm font-extrabold inline-flex items-center gap-2 transition-base ${active ? 'bg-tpv-accent border-tpv-accent text-white' : 'bg-tpv-surface-2 border-tpv-line text-tpv-txt'}`}
              >
                {z.name}
                <span className={`rounded-full px-2 text-xs ${active ? 'bg-white/20' : 'bg-tpv-bg text-tpv-txt-2'}`}>{o.busy}/{o.total}</span>
              </button>
            )
          })}
        </nav>
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {zone && zone.tables.length === 0 && (
            <p className="text-center text-sm text-tpv-txt-2 py-10">Esta zona no tiene mesas.</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {zone?.tables.map(t => (
              <TableTile key={t.id} table={t} warnMinutes={floor.warnMinutes} now={now} onTap={() => onTapTable(t)} />
            ))}
          </div>
        </div>
      </div>

      <aside className="lg:w-[260px] shrink-0 bg-tpv-surface border-t lg:border-t-0 lg:border-l border-tpv-line p-3 lg:p-4">
        <h2 className="text-xs font-extrabold uppercase tracking-wide text-tpv-txt-2 mb-2">Ahora mismo</h2>
        <div className="flex lg:flex-col gap-2 overflow-x-auto">
          {occupancy.map(o => (
            <div key={o.id} className="shrink-0 rounded-tpv border border-tpv-line bg-tpv-surface-2 px-3 py-2 min-w-[130px]">
              <p className="text-sm font-bold text-tpv-txt">{o.name}</p>
              <p className="text-xs text-tpv-txt-2 inline-flex items-center gap-1"><Users size={13} aria-hidden /> {o.covers} comensales · {o.busy} de {o.total} mesas</p>
            </div>
          ))}
          <div className="shrink-0 rounded-tpv border border-tpv-line px-3 py-2 min-w-[130px]">
            <p className="text-sm font-extrabold text-tpv-txt">Total: {totalCovers} comensales</p>
          </div>
        </div>
      </aside>
    </div>
  )
}
