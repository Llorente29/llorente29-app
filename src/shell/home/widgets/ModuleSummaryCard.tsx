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
  onOpen?: () => void
}

export default function ModuleSummaryCard({
  title, icon: Icon, lines, onOpen,
}: ModuleSummaryCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left w-full transition-colors"
      style={{
        background: 'var(--color-bg-card)',
        border: '0.5px solid var(--color-border-default)',
        borderRadius: 'var(--radius-xl)',
        padding: '1rem 1.125rem',
        cursor: onOpen ? 'pointer' : 'default',
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
    </button>
  )
}
