// src/components/team/StatusBand.tsx
// F4 — franja de estado compartida: UNA franja arriba (verde si nada, o las N
// cosas a resolver), nunca varias tarjetas de alerta sueltas. Cada línea:
// problema + por qué importa (consecuencia) + botón de acción opcional.
// Estados SIEMPRE con icono + etiqueta, nunca color solo.

import { CheckCircle2, type LucideIcon } from 'lucide-react'

export interface StatusLine {
  key: string
  severity: 'warning' | 'critical'
  Icon: LucideIcon
  text: string          // el problema, en una frase
  consequence: string   // por qué importa, en una frase
  actionLabel?: string
  onAction?: () => void
}

interface Props {
  lines: StatusLine[]
  emptyLabel?: string
}

export default function StatusBand({ lines, emptyLabel = 'Todo en orden — nada que resolver hoy.' }: Props) {
  if (lines.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success-bg border border-success/30">
        <CheckCircle2 size={18} className="text-success shrink-0" />
        <p className="text-sm font-semibold text-success">{emptyLabel}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border-default overflow-hidden divide-y divide-border-default">
      {lines.map(l => {
        const Icon = l.Icon
        const tone = l.severity === 'critical' ? 'text-danger' : 'text-warning'
        const bg = l.severity === 'critical' ? 'bg-danger-bg' : 'bg-warning-bg'
        return (
          <div key={l.key} className={`flex items-center gap-3 px-4 py-2.5 ${bg}`}>
            <Icon size={16} className={`shrink-0 ${tone}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${tone}`}>{l.text}</p>
              <p className="text-xs text-text-secondary mt-0.5">{l.consequence}</p>
            </div>
            {l.onAction && (
              <button
                onClick={l.onAction}
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-base hover:bg-card ${tone} border-current`}
              >
                {l.actionLabel || 'Ver'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
