// src/modules/kitchen/components/MarginBar.tsx
//
// La mini-barra de margen de la fila premium. Es el diferenciador de Folvy
// hecho visible: Otter no tiene escandallos, así que no puede pintar esto.
//
// El color es semántico y estricto (verde bien / ámbar atención / rojo
// problema), pero NO viaja solo: el porcentaje va escrito al lado y la barra
// lleva su `title`. Un margen es dinero; comunicarlo solo por tono sería
// dejar fuera a quien no distingue verde de rojo.

interface Props {
  /** Margen sobre PVP, 0-100. */
  marginPct: number
  className?: string
}

function marginTone(pct: number): 'good' | 'warn' | 'bad' {
  if (pct >= 65) return 'good'
  if (pct >= 50) return 'warn'
  return 'bad'
}

const FILL: Record<ReturnType<typeof marginTone>, string> = {
  good: 'bg-emerald-600',
  warn: 'bg-amber-500',
  bad: 'bg-red-600',
}
const TEXT: Record<ReturnType<typeof marginTone>, string> = {
  good: 'text-emerald-700',
  warn: 'text-amber-600',
  bad: 'text-red-600',
}

export default function MarginBar({ marginPct, className = '' }: Props) {
  const pct = Math.max(0, Math.min(100, marginPct))
  const tone = marginTone(pct)
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className="inline-block w-12 h-1.5 rounded-full bg-border-default overflow-hidden"
        title={`Margen ${Math.round(pct)}% sobre PVP`}
        role="img"
        aria-label={`Margen ${Math.round(pct)} por ciento`}
      >
        <span
          className={`block h-full rounded-full ${FILL[tone]} transition-[width] duration-200`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className={`text-[11px] font-medium tabular-nums ${TEXT[tone]}`}>
        {Math.round(pct)}%
      </span>
    </span>
  )
}
