// src/shell/home/widgets/MetricCard.tsx
//
// Widget de métrica del Home general (Bloque G-5, Sprint 3).
//
// Es un WIDGET INDEPENDIENTE y autocontenido: recibe todos sus datos por
// props. Esto es deliberado (decisión Sesión 14): el Home V1 es FIJO pero se
// construye como widgets sueltos para que añadir configurabilidad (drag&drop +
// orden por usuario) en V1.1/V2 NO obligue a reescribir los widgets, solo a
// envolverlos en un sistema de orden persistente.
//
// G-5: datos MOCK (pasados por props desde HomeGeneral). La conexión a datos
// reales (ventas de Sales/Last.app, fichajes de Team, etc.) se hace módulo a
// módulo en fases posteriores; bastará con pasar los valores reales por las
// mismas props.
//
// Diseño aprobado (maqueta Sesión 14): tarjeta blanca, borde sutil, label
// gris arriba, número grande Fraunces, subtítulo opcional. El acento terracota
// se usa SOLO cuando la métrica es accionable (requiere atención del usuario).

import type { LucideIcon } from 'lucide-react'

const INK = '#1E3A5F'
const TERRACOTA = '#D67442'
const MUTED = '#8A8780'
const GREEN = '#2E8B57'
const BORDER = '#E2DFD6'

// Tono del subtítulo según su significado.
export type MetricTone = 'neutral' | 'positive' | 'attention'

export interface MetricCardProps {
  label: string
  value: string
  icon: LucideIcon
  // Texto pequeño bajo el valor (ej. "+12% vs ayer", "en 3 locales").
  subtitle?: string
  subtitleTone?: MetricTone
  // Si true, el valor se pinta en terracota (métrica accionable).
  accent?: boolean
}

export default function MetricCard({
  label, value, icon: Icon, subtitle, subtitleTone = 'neutral', accent = false,
}: MetricCardProps) {
  const subtitleColor =
    subtitleTone === 'positive' ? GREEN
    : subtitleTone === 'attention' ? TERRACOTA
    : MUTED

  return (
    <div
      style={{
        background: '#fff',
        border: `0.5px solid ${BORDER}`,
        borderRadius: 12,
        padding: '15px 17px',
      }}
    >
      <p
        className="flex items-center"
        style={{ fontSize: 12, color: MUTED, margin: '0 0 6px', gap: 5 }}
      >
        <Icon size={14} /> {label}
      </p>
      <p
        style={{
          fontSize: 27,
          fontWeight: 500,
          color: accent ? TERRACOTA : INK,
          margin: 0,
          fontFamily: 'Fraunces, Georgia, serif',
          lineHeight: 1.1,
        }}
      >
        {value}
      </p>
      {subtitle ? (
        <p style={{ fontSize: 11, color: subtitleColor, margin: '4px 0 0' }}>
          {subtitle}
        </p>
      ) : null}
    </div>
  )
}
