// src/shell/home/widgets/MetricCard.tsx
//
// Widget de métrica del Home general (G-5 + G-8.4 legibilidad).
//
// Widget independiente y autocontenido: recibe datos por props (preparado para
// configurabilidad futura sin reescribir — decisión Sesión 14).
//
// LEGIBILIDAD: usa tokens de index.css (no grises hardcodeados) y tamaños en
// rem. Label/subtítulo en --color-text-secondary (#6B6760, buen contraste);
// valor grande en --color-accent o --color-terracota si es accionable.

import type { LucideIcon } from 'lucide-react'

export type MetricTone = 'neutral' | 'positive' | 'attention'

export interface MetricCardProps {
  label: string
  value: string
  icon: LucideIcon
  subtitle?: string
  subtitleTone?: MetricTone
  accent?: boolean
}

export default function MetricCard({
  label, value, icon: Icon, subtitle, subtitleTone = 'neutral', accent = false,
}: MetricCardProps) {
  const subtitleColor =
    subtitleTone === 'positive' ? 'var(--color-success)'
    : subtitleTone === 'attention' ? 'var(--color-terracota)'
    : 'var(--color-text-secondary)'

  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: '0.5px solid var(--color-border-default)',
        borderRadius: 'var(--radius-xl)',
        padding: '0.9375rem 1.0625rem',
      }}
    >
      <p
        className="flex items-center"
        style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: '0 0 0.375rem', gap: 6 }}
      >
        <Icon size={15} /> {label}
      </p>
      <p
        style={{
          fontSize: '1.75rem',
          fontWeight: 500,
          color: accent ? 'var(--color-terracota)' : 'var(--color-accent)',
          margin: 0,
          fontFamily: 'var(--font-display)',
          lineHeight: 1.1,
        }}
      >
        {value}
      </p>
      {subtitle ? (
        <p style={{ fontSize: '0.75rem', color: subtitleColor, margin: '0.25rem 0 0' }}>
          {subtitle}
        </p>
      ) : null}
    </div>
  )
}
