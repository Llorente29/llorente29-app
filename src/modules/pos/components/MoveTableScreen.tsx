// src/modules/pos/components/MoveTableScreen.tsx
//
// TPV · Sala (S2) — maqueta «Folvy TPV · Sala», pantalla 4: «Mover o juntar
// mesas». Una banda azul dice qué se cambia y qué pasa al tocar; debajo, la
// sala con cada mesa diciendo QUÉ pasará si la tocas:
//   · la de origen          «← Sale de aquí»             (no se toca)
//   · libre y caben         «→ Pasar aquí»               (verde)
//   · libre y no caben      «⚠ Caben solo N»             (ámbar, se puede igual)
//   · ocupada               «+ Juntar con la N»          (borde blanco)
//   · cobrada sin recoger   «Sin recoger»                (apagada, no se toca)
// Se toca el destino y ya: sin arrastrar y sin confirmar (encargo S2). La
// pantalla de la mesa dice después qué ha pasado, con cifras.
//
// Tres usos, la misma pantalla:
//   · elegir la mesa que se cambia (desde la Sala, «Mover o juntar mesas»)
//   · cambiar / juntar una mesa abierta («Cambiar de mesa»)
//   · llevar una o varias líneas a otra mesa

import { useMemo, useState, type CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeftRight, ArrowLeft, ArrowRight, Plus, TriangleAlert, Ban, Hand } from 'lucide-react'
import type { Floor, FloorTable } from '@/modules/pos/services/posTableService'

// eslint-disable-next-line no-restricted-syntax -- n es un importe ya numérico del RPC, solo se formatea
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

export type MoveIntent =
  | { kind: 'pick' }                                                                   // aún no se sabe qué mesa
  | { kind: 'table'; tableId: string; tableName: string; covers: number; total: number }
  | { kind: 'lines'; tableId: string; tableName: string; label: string }

type Look = 'origen' | 'pasar' | 'nocaben' | 'juntar' | 'no' | 'elegir'

const LOOK: Record<Look, { tile: string; ink: string; icon: LucideIcon }> = {
  origen:  { tile: 'border-tpv-strong border-tpv-accent-text bg-tpv-accent-tint', ink: 'text-tpv-accent-soft', icon: ArrowLeft },
  pasar:   { tile: 'border-tpv-strong border-tpv-ok-text bg-tpv-ok-tint',         ink: 'text-tpv-ok-text',     icon: ArrowRight },
  nocaben: { tile: 'border-tpv-strong border-tpv-warn bg-tpv-warn-tint',          ink: 'text-tpv-warn-text',   icon: TriangleAlert },
  juntar:  { tile: 'border-2 border-tpv-txt bg-tpv-surface-2',               ink: 'text-tpv-txt',         icon: Plus },
  elegir:  { tile: 'border-2 border-tpv-txt bg-tpv-surface-2',               ink: 'text-tpv-txt',         icon: Hand },
  no:      { tile: 'border-2 border-tpv-line bg-tpv-surface opacity-60',     ink: 'text-tpv-txt-2',       icon: Ban },
}

function tileFor(t: FloorTable, intent: MoveIntent): { look: Look; label: string; enabled: boolean } {
  const s = t.sale
  if (intent.kind === 'pick') {
    if (!s) return { look: 'no', label: 'Libre', enabled: false }
    if (s.paidAt) return { look: 'no', label: 'Sin recoger', enabled: false }
    return { look: 'elegir', label: 'Esta se cambia', enabled: true }
  }
  if (t.id === intent.tableId) return { look: 'origen', label: 'Sale de aquí', enabled: false }
  if (s?.paidAt) return { look: 'no', label: 'Sin recoger', enabled: false }
  if (s) return { look: 'juntar', label: intent.kind === 'lines' ? `Llevar a la ${t.name}` : `Juntar con la ${t.name}`, enabled: true }
  if (intent.kind === 'table' && intent.covers > t.seats) return { look: 'nocaben', label: `Caben solo ${t.seats}`, enabled: true }
  return { look: 'pasar', label: 'Pasar aquí', enabled: true }
}

export default function MoveTableScreen({ floor, intent, busy, onPick, onCancel }: {
  floor: Floor
  intent: MoveIntent
  busy: boolean
  onPick: (table: FloorTable) => void
  onCancel: () => void
}) {
  const [zoneId, setZoneId] = useState<string | null>(() =>
    intent.kind === 'pick' ? null : floor.zones.find(z => z.tables.some(t => t.id === intent.tableId))?.id ?? null)
  const zone = floor.zones.find(z => z.id === zoneId) ?? floor.zones[0] ?? null
  const rows = Math.max(3, Math.ceil((zone?.tables ?? []).reduce((n, t) => n + Math.min(t.gridWidth, 6), 0) / 6))
  const free = useMemo(() => Object.fromEntries(floor.zones.map(z => [z.id, z.tables.filter(t => !t.sale).length])), [floor])

  const title = intent.kind === 'pick'
    ? '¿Qué mesa se cambia? Tócala.'
    : intent.kind === 'table'
      ? `La mesa ${intent.tableName} se cambia. Toca a cuál va.`
      : `${intent.label} se va de la mesa ${intent.tableName}. Toca a cuál va.`
  const sub = intent.kind === 'pick'
    ? 'Después eliges a dónde va. Si es a una ocupada, se juntan las dos cuentas.'
    : intent.kind === 'table'
      ? `${intent.covers} persona${intent.covers === 1 ? '' : 's'} · ${eur(intent.total)} · Si tocas una ocupada, se juntan las dos cuentas.`
      : 'A una ocupada se suma a su cuenta; a una libre, se abre con ella.'

  return (
    <div className="fixed inset-0 z-40 bg-tpv-bg text-tpv-txt flex flex-col" role="dialog" aria-modal="true" aria-label={title}>
      <header className="min-h-tpv-banner shrink-0 px-4 lg:px-5 py-3 bg-tpv-accent flex flex-wrap items-center gap-x-4 gap-y-3">
        <ArrowLeftRight size={30} strokeWidth={2.3} className="text-white shrink-0" aria-hidden />
        <div className="flex flex-col leading-tight min-w-0 flex-1 basis-[calc(100%-50px)] lg:basis-auto">
          <b className="text-xl lg:text-tpv-banner font-extrabold text-white">{title}</b>
          <span className="text-sm lg:text-base font-semibold text-white">{sub}</span>
        </div>
        <button type="button" onClick={onCancel} disabled={busy}
          className="h-tap-small lg:h-tap w-full lg:w-auto px-6 rounded-tpv border-2 border-white bg-tpv-bg text-white text-lg lg:text-tpv-zone font-extrabold shrink-0 disabled:opacity-50">
          No cambiar nada
        </button>
      </header>

      <main className="flex-1 min-h-0 flex flex-col gap-3.5 p-4 lg:p-5">
        <div className="grid grid-cols-3 gap-2.5 shrink-0">
          {floor.zones.map(z => {
            const active = zone?.id === z.id
            return (
              <button key={z.id} type="button" onClick={() => setZoneId(z.id)}
                className={`h-tap rounded-tpv flex flex-col lg:flex-row items-center justify-center gap-0.5 lg:gap-3 font-extrabold text-tpv-name lg:text-tpv-zone ${active ? 'border-2 border-tpv-accent bg-tpv-accent text-white' : 'border border-tpv-line-strong bg-tpv-surface-2 text-tpv-txt'}`}>
                {z.name}
                {!active && free[z.id] > 0 && <span className="text-tpv-tab-sm lg:text-tpv-tab font-bold text-tpv-txt-2">{free[z.id]} libre{free[z.id] === 1 ? '' : 's'}</span>}
              </button>
            )
          })}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5 lg:gap-3 lg:h-full lg:[grid-template-rows:var(--rows)]"
            style={{ '--rows': `repeat(${rows}, minmax(140px, 1fr))` } as CSSProperties}>
            {zone?.tables.map(t => {
              const { look, label, enabled } = tileFor(t, intent)
              const L = LOOK[look]
              const Icon = L.icon
              return (
                <button key={t.id} type="button" disabled={!enabled || busy} onClick={() => onPick(t)}
                  className={`${t.gridWidth >= 2 ? 'lg:col-span-2' : ''} min-h-tpv-table-sm lg:min-h-0 rounded-tpv-tile ${L.tile} px-3.5 py-3 lg:px-4 lg:py-3.5 text-left flex flex-col gap-2 disabled:cursor-default active:scale-[0.98] transition-base`}>
                  <span className="flex items-baseline justify-between gap-2">
                    <b className="text-tpv-table-num-sm lg:text-tpv-table-num font-extrabold leading-none">{t.name}</b>
                    <span className="text-tpv-tab lg:text-base font-bold text-tpv-txt-2">{t.sale ? `${t.sale.covers} pers.` : `${t.seats} sitios`}</span>
                  </span>
                  <span className="flex-grow" />
                  <span className={`flex items-center gap-2 text-base lg:text-lg font-extrabold leading-tight ${L.ink}`}>
                    <Icon size={20} strokeWidth={2.4} className="shrink-0" aria-hidden /> {label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
