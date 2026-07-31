// src/modules/kitchen/components/AvailabilityHeatmap.tsx
//
// DISPONIBILIDAD · C3b — mapa de calor día×hora de downtime (§C3a heatmap).
// Rampa secuencial de UN solo tono (danger, "el color es dinero" — más rojo
// = más minutos cerrado), por opacidad sobre bg-card: nunca un arcoíris.
// dow: 0=lunes..6=domingo (mismo criterio que la RPC, extract(isodow)-1).

import { useMemo } from 'react'
import type { HeatmapCell } from '../services/availabilityReportService'

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const HOURS = Array.from({ length: 24 }, (_, h) => h)

function fmtMin(min: number): string {
  if (min <= 0) return '0 min'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export default function AvailabilityHeatmap({ cells }: { cells: HeatmapCell[] }) {
  const { byKey, max } = useMemo(() => {
    const map = new Map<string, number>()
    let m = 0
    for (const c of cells) {
      map.set(`${c.dow}-${c.hour}`, c.downtime_min)
      if (c.downtime_min > m) m = c.downtime_min
    }
    return { byKey: map, max: m }
  }, [cells])

  if (max === 0) {
    return (
      <div className="py-10 text-center text-sm text-stone-400">
        Sin downtime registrado en el periodo — mapa vacío.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 640 }}>
        <div className="flex items-center gap-1 mb-1" style={{ paddingLeft: 24 }}>
          {HOURS.map((h) => (
            <div key={h} className="flex-1 text-center text-[9px] text-stone-400">
              {h % 3 === 0 ? h : ''}
            </div>
          ))}
        </div>
        {DAYS.map((label, dow) => (
          <div key={dow} className="flex items-center gap-1 mb-1">
            <div className="w-5 shrink-0 text-[11px] font-medium text-stone-500">{label}</div>
            {HOURS.map((hour) => {
              const min = byKey.get(`${dow}-${hour}`) ?? 0
              const alpha = min > 0 ? Math.min(1, 0.08 + 0.82 * (min / max)) : 0
              return (
                <div
                  key={hour}
                  title={`${label} ${String(hour).padStart(2, '0')}:00 · ${fmtMin(min)} cerrado`}
                  className={`flex-1 aspect-square rounded-sm ${min > 0 ? '' : 'bg-page'}`}
                  style={min > 0 ? { minWidth: 20, backgroundColor: `rgba(224, 73, 46, ${alpha})` } : { minWidth: 20 }}
                />
              )
            })}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-2 text-[11px] text-stone-400">
          <span>Menos</span>
          <div className="flex gap-0.5">
            {[0.15, 0.35, 0.55, 0.75, 0.95].map((a) => (
              <div key={a} className="w-4 h-3 rounded-sm" style={{ backgroundColor: `rgba(224, 73, 46, ${a})` }} />
            ))}
          </div>
          <span>Más downtime</span>
        </div>
      </div>
    </div>
  )
}
