// src/shell/home/widgets/ModuleSummaryCard.tsx
//
// Widget de tarjeta-resumen de módulo en el Home general (Bloque G-5).
//
// Cada tarjeta da el "titular" de un módulo (Team, Safety, Sales) y es la
// puerta de entrada para profundizar: al pulsarla se navega al módulo. El Home
// NO duplica los módulos, los RESUME y ENLAZA.
//
// Widget independiente y autocontenido (ver nota en MetricCard sobre por qué).
//
// G-5: las líneas de resumen son MOCK (props desde HomeGeneral). La navegación
// (onOpen) se cablea: en G-5 cambia la pestaña activa del Shell; el contenido
// real del módulo es G-6.

import type { LucideIcon } from 'lucide-react'

const INK = '#1E3A5F'
const TERRACOTA = '#D67442'
const TEXT = '#44443F'
const MUTED = '#8A8780'
const BORDER = '#E2DFD6'

export interface ModuleSummaryLine {
  text: string
  // Si true, la línea se ve atenuada (estado "todo en orden", no accionable).
  muted?: boolean
}

export interface ModuleSummaryCardProps {
  title: string
  icon: LucideIcon
  lines: ModuleSummaryLine[]
  // Acción al pulsar la tarjeta (navegar al módulo).
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
        background: '#fff',
        border: `0.5px solid ${BORDER}`,
        borderRadius: 12,
        padding: '16px 18px',
        cursor: onOpen ? 'pointer' : 'default',
      }}
    >
      <p
        className="flex items-center"
        style={{ fontSize: 13, fontWeight: 500, color: INK, margin: '0 0 12px', gap: 6 }}
      >
        <Icon size={15} color={TERRACOTA} /> {title}
      </p>
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            fontSize: 12,
            color: line.muted ? MUTED : TEXT,
            marginBottom: i === lines.length - 1 ? 0 : 7,
          }}
        >
          {line.text}
        </div>
      ))}
    </button>
  )
}
