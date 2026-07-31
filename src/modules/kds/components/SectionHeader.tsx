// src/modules/kds/components/SectionHeader.tsx
//
// DISPONIBILIDAD · C2 — cabecera de sección única (icono + título + contador
// opcional + slot de acción a la derecha). Antes "Local y marcas" era una
// micro-etiqueta gris sin icono y "Productos agotados" era un punto rojo +
// texto — dos tratamientos distintos para el mismo rol. Ahora ambas usan
// esta misma cabecera (mismo trato que ya tenía ClosedBrandsCard).

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { themeCls, type Theme } from '../lib/theme'

interface Props {
  icon: LucideIcon
  title: string
  /** número o null = "…" (cargando). undefined = sin contador. */
  count?: number | null
  /** punto de estado tokenizado, opcional (p.ej. 'danger' en "Productos agotados"). */
  dot?: 'danger' | 'warning' | 'success'
  action?: ReactNode
  theme?: Theme
  className?: string
}

const DOT_CLASS: Record<NonNullable<Props['dot']>, string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
}

export default function SectionHeader({ icon: Icon, title, count, dot, action, theme = 'light', className }: Props) {
  const t = themeCls(theme)
  return (
    <div className={`flex items-center justify-between gap-2 flex-wrap ${className ?? ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        {dot && <span className={`w-2 h-2 rounded-full shrink-0 ${DOT_CLASS[dot]}`} />}
        <Icon size={15} className={t.textMuted} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${t.textSecondary}`}>{title}</span>
        {count !== undefined && (
          <span className={t.textMuted}>· {count === null ? '…' : count}</span>
        )}
      </div>
      {action}
    </div>
  )
}
