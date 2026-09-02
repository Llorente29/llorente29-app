// src/shell/home/widgets/ModuleSummaryCard.tsx
//
// Widget de tarjeta-resumen de módulo en el Home general (G-5 + G-8.4 legib.).
// Da el "titular" de un módulo y enlaza a él. Widget autocontenido.
//
// LEGIBILIDAD: tokens de index.css + rem. Líneas a 0.8125rem con
// --color-text-primary (legibles); líneas "muted" en --color-text-secondary.

import type { LucideIcon } from 'lucide-react'

export interface ModuleSummaryLine {
  text: string
  muted?: boolean
}

export interface ModuleSummaryCardProps {
  title: string
  icon: LucideIcon
  lines: ModuleSummaryLine[]
  /**
   * EL PIE, igual que en MetricCard: «Abrir Team · Ahora mismo →». Va abajo y
   * es lo ÚNICO pulsable de la tarjeta.
   *
   * (02/09) Antes la tarjeta ENTERA era un <button> con `onOpen`. Se cambia por
   * dos motivos: una caja pulsable no dice a dónde lleva —y lo que no dice a
   * dónde lleva no se pulsa—, y además un <button> dentro de otro <button> es
   * HTML inválido, así que el pie no cabía sin este cambio.
   */
  pie?: { etiqueta: string; onClick: () => void }
}

export default function ModuleSummaryCard({
  title, icon: Icon, lines, pie,
}: ModuleSummaryCardProps) {
  return (
    <div
      className="text-left w-full"
      style={{
        background: 'var(--color-bg-card)',
        border: '0.5px solid var(--color-border-default)',
        borderRadius: 'var(--radius-xl)',
        padding: '1rem 1.125rem',
      }}
    >
      <p
        className="flex items-center"
        style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-accent)', margin: '0 0 0.75rem', gap: 6 }}
      >
        <Icon size={16} color="var(--color-terracota)" /> {title}
      </p>
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            fontSize: '0.8125rem',
            color: line.muted ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
            marginBottom: i === lines.length - 1 ? 0 : '0.4375rem',
          }}
        >
          {line.text}
        </div>
      ))}
      {pie ? (
        <button
          type="button"
          onClick={pie.onClick}
          style={{
            marginTop: '0.75rem', padding: 0, border: 0, background: 'none',
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
