// src/components/team/PeriodFilter.tsx
// F4 — selector de periodo compartido entre las pantallas de gestión de Team
// (Plantilla, Centro de Mando, Ficha). Granularidades: Diario/Semanal/Mensual/
// Anual/Rango. Siempre devuelve {from, to} ISO inclusive + una etiqueta legible.

import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getMondayOfWeek, toISODate } from '../../types/scheduler'

export type PeriodGranularity = 'diario' | 'semanal' | 'mensual' | 'anual' | 'rango'

export interface PeriodValue {
  granularity: PeriodGranularity
  anchor: string   // fecha ISO ancla (cualquier día dentro del periodo activo)
  from: string
  to: string
  label: string
}

const GRANULARITY_LABELS: Record<PeriodGranularity, string> = {
  diario: 'Diario',
  semanal: 'Semanal',
  mensual: 'Mensual',
  anual: 'Anual',
  rango: 'Rango',
}

const GRANULARITY_ORDER: PeriodGranularity[] = ['diario', 'semanal', 'mensual', 'anual', 'rango']

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return toISODate(dt)
}

function startOfMonthISO(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return toISODate(new Date(y, m - 1, 1))
}
function endOfMonthISO(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return toISODate(new Date(y, m, 0))
}
function startOfYearISO(iso: string): string {
  const [y] = iso.split('-').map(Number)
  return toISODate(new Date(y, 0, 1))
}
function endOfYearISO(iso: string): string {
  const [y] = iso.split('-').map(Number)
  return toISODate(new Date(y, 11, 31))
}
function shortDayLabel(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

function computeRange(
  granularity: PeriodGranularity,
  anchor: string,
  rangeFrom?: string,
  rangeTo?: string
): { from: string; to: string; label: string } {
  const [y, m, d] = anchor.split('-').map(Number)
  switch (granularity) {
    case 'diario': {
      const dt = new Date(y, m - 1, d)
      return { from: anchor, to: anchor, label: dt.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) }
    }
    case 'semanal': {
      const monday = toISODate(getMondayOfWeek(new Date(y, m - 1, d)))
      const sunday = addDaysISO(monday, 6)
      return { from: monday, to: sunday, label: `${shortDayLabel(monday)} – ${shortDayLabel(sunday)}` }
    }
    case 'mensual': {
      const from = startOfMonthISO(anchor)
      const to = endOfMonthISO(anchor)
      return { from, to, label: `${MONTHS_ES[m - 1]} ${y}` }
    }
    case 'anual': {
      return { from: startOfYearISO(anchor), to: endOfYearISO(anchor), label: `${y}` }
    }
    case 'rango': {
      const from = rangeFrom || anchor
      const to = rangeTo || anchor
      return { from, to, label: `${shortDayLabel(from)} – ${shortDayLabel(to)}` }
    }
  }
}

// Desplaza el ancla un "paso" de la granularidad activa (flechas prev/next).
// 'rango' no tiene noción de paso: se edita con los inputs de fecha.
function shiftAnchor(granularity: PeriodGranularity, anchor: string, dir: 1 | -1): string {
  const [y, m] = anchor.split('-').map(Number)
  switch (granularity) {
    case 'diario': return addDaysISO(anchor, dir)
    case 'semanal': return addDaysISO(anchor, dir * 7)
    case 'mensual': return toISODate(new Date(y, m - 1 + dir, 1))
    case 'anual': return toISODate(new Date(y + dir, 0, 1))
    case 'rango': return anchor
  }
}

export function makePeriodValue(
  granularity: PeriodGranularity,
  anchor: string,
  rangeFrom?: string,
  rangeTo?: string
): PeriodValue {
  return { granularity, anchor, ...computeRange(granularity, anchor, rangeFrom, rangeTo) }
}

interface Props {
  value: PeriodValue
  onChange: (v: PeriodValue) => void
}

export default function PeriodFilter({ value, onChange }: Props) {
  const { granularity, anchor } = value
  // rango guarda su from/to explícitos aparte del anchor (que no se usa en ese modo)
  const rangeFrom = granularity === 'rango' ? value.from : undefined
  const rangeTo = granularity === 'rango' ? value.to : undefined

  const label = useMemo(() => value.label, [value.label])

  function setGranularity(g: PeriodGranularity) {
    onChange(makePeriodValue(g, anchor, value.from, value.to))
  }
  function step(dir: 1 | -1) {
    const nextAnchor = shiftAnchor(granularity, anchor, dir)
    onChange(makePeriodValue(granularity, nextAnchor))
  }
  function setRangeFrom(v: string) {
    onChange(makePeriodValue('rango', anchor, v, rangeTo))
  }
  function setRangeTo(v: string) {
    onChange(makePeriodValue('rango', anchor, rangeFrom, v))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex bg-accent-bg rounded-lg p-0.5">
        {GRANULARITY_ORDER.map(g => (
          <button
            key={g}
            onClick={() => setGranularity(g)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-base ${
              granularity === g ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {GRANULARITY_LABELS[g]}
          </button>
        ))}
      </div>

      {granularity !== 'rango' ? (
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} className="p-1.5 border border-border-default rounded hover:bg-page text-text-secondary transition-base">
            <ChevronLeft size={14} />
          </button>
          <span className="text-sm font-medium text-text-primary min-w-[140px] text-center capitalize">{label}</span>
          <button onClick={() => step(1)} className="p-1.5 border border-border-default rounded hover:bg-page text-text-secondary transition-base">
            <ChevronRight size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={rangeFrom || anchor}
            onChange={e => setRangeFrom(e.target.value)}
            className="border border-border-default rounded px-2 py-1 text-xs bg-card text-text-primary"
          />
          <span className="text-text-secondary text-xs">–</span>
          <input
            type="date"
            value={rangeTo || anchor}
            onChange={e => setRangeTo(e.target.value)}
            className="border border-border-default rounded px-2 py-1 text-xs bg-card text-text-primary"
          />
        </div>
      )}
    </div>
  )
}
