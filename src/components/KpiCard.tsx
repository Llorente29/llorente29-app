// src/components/KpiCard.tsx
//
// Tarjeta de KPI con delta contra el periodo anterior.
//
// EXTRAÍDA TAL CUAL de AvailabilityReportsPage el 01/09/2026, sin tocar ni una
// clase. La condición de Julio era explícita: «al extraer el KpiCard local a
// componente común, esta pantalla tiene que quedar píxel a píxel igual; si algo
// cambia de aspecto, es un fallo del refactor, no una mejora». Por eso el JSX
// de abajo es byte a byte el que había, y lo único añadido es el `export` y
// estos imports.
//
// NO se ha convergido con `MetricCard` (src/shell/home/widgets), y es
// deliberado: no son el mismo componente con props distintas, son dos diseños
// distintos —borde de 1px contra 0.5px, clases Tailwind contra estilos en línea,
// label en mayúsculas sin icono contra label con icono, `number | null` + format
// contra `string` ya formateado—. Converger cambiaría el aspecto del Inicio, que
// es justo lo que este refactor no puede hacer. La salida ya estaba escrita en
// la línea base del 30/08: se unifica el KpiCard ahora y MetricCard migra cuando
// sus tarjetas se cableen al catálogo.

import { Minus, TrendingUp, TrendingDown } from 'lucide-react'

export function KpiCard({
  label, value, prevValue, betterWhen, format, note,
}: {
  label: string
  value: number | null
  prevValue: number | null
  betterWhen: 'up' | 'down'
  format: (v: number | null) => string
  note?: string
}) {
  const hasDelta = value !== null && prevValue !== null && Number.isFinite(value) && Number.isFinite(prevValue)
  const delta = hasDelta ? value! - prevValue! : null
  const improved = delta !== null && (betterWhen === 'up' ? delta > 0 : delta < 0)
  const worsened = delta !== null && (betterWhen === 'up' ? delta < 0 : delta > 0)
  const DeltaIcon = delta === null || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown

  return (
    <div className="bg-card border border-border-default rounded-xl p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1.5">{label}</p>
      <p className="text-2xl font-semibold text-text-primary font-display">{format(value)}</p>
      {hasDelta && delta !== null && (
        <p className={`mt-1.5 text-xs inline-flex items-center gap-1 font-medium ${
          improved ? 'text-success' : worsened ? 'text-danger' : 'text-text-secondary'
        }`}>
          <DeltaIcon size={13} /> {format(Math.abs(delta))} vs periodo anterior
        </p>
      )}
      {note && <p className="mt-1 text-[11px] text-text-tertiary">{note}</p>}
    </div>
  )
}

export default KpiCard
