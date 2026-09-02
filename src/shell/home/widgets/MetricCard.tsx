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
  /**
   * EL PIE DE LA MAQUETA: «Abrir Ventas →». Va DENTRO de la tarjeta y como
   * enlace visible, no como un click en toda la caja: una tarjeta entera
   * pulsable no dice a dónde lleva, y lo que no dice a dónde lleva no se pulsa.
   */
  pie?: { etiqueta: string; onClick: () => void }
  /**
   * GARANTÍA (a): el sello de ESTA tarjeta, no el del panel. «datos de las
   * 08:18», y cuando el dato pasa su umbral, «· pueden haber cambiado».
   * Se pinta atenuado: informa, no interrumpe.
   */
  sello?: { texto: string; caducado: boolean }
}

export default function MetricCard({
  label, value, icon: Icon, subtitle, subtitleTone = 'neutral', accent = false, pie, sello,
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
      {sello ? (
        <p style={{
          fontSize: '0.6875rem', margin: '0.5rem 0 0',
          color: sello.caducado ? 'var(--color-terracota)' : 'var(--color-text-secondary)',
        }}>
          {sello.texto}
        </p>
      ) : null}
      {pie ? (
        <button
          type="button"
          onClick={pie.onClick}
          style={{
            marginTop: '0.625rem', padding: 0, border: 0, background: 'none',
            font: 'inherit', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
            color: 'var(--color-accent)', textAlign: 'left',
          }}
        >
          {pie.etiqueta}
        </button>
      ) : null}
    </div>
  )
}
