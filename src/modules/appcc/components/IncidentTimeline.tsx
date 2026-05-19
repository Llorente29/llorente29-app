// src/modules/appcc/components/IncidentTimeline.tsx
// Timeline visual estilo SafetyCulture/Lumiform: línea vertical con iconos
// por cada evento. Muestra el ciclo de vida CAPA completo.

import { useMemo } from 'react'
import {
  CircleDot,
  UserPlus,
  Search,
  Wrench,
  ShieldCheck,
  CheckCircle2,
  X as XIcon,
  AlertTriangle,
  Camera,
  Clock,
  StickyNote,
  RotateCcw,
  Lightbulb,
} from 'lucide-react'
import type {
  AppccIncidentEvent,
  AppccIncidentEventType,
} from '@/modules/appcc/types'

const EVENT_META: Record<
  AppccIncidentEventType,
  { Icon: typeof CircleDot; color: string; bg: string }
> = {
  created:             { Icon: CircleDot,    color: 'text-text-secondary', bg: 'bg-page' },
  assigned:            { Icon: UserPlus,     color: 'text-accent',         bg: 'bg-accent-bg' },
  status_changed:      { Icon: CircleDot,    color: 'text-accent',         bg: 'bg-accent-bg' },
  note_added:          { Icon: StickyNote,   color: 'text-text-secondary', bg: 'bg-page' },
  photo_added:         { Icon: Camera,       color: 'text-text-secondary', bg: 'bg-page' },
  root_cause_set:      { Icon: Search,       color: 'text-accent',         bg: 'bg-accent-bg' },
  corrective_applied:  { Icon: Wrench,       color: 'text-success',        bg: 'bg-success-bg' },
  preventive_applied:  { Icon: Lightbulb,    color: 'text-success',        bg: 'bg-success-bg' },
  verified:            { Icon: ShieldCheck,  color: 'text-success',        bg: 'bg-success-bg' },
  closed:              { Icon: CheckCircle2, color: 'text-success',        bg: 'bg-success-bg' },
  reopened:            { Icon: RotateCcw,    color: 'text-warning',        bg: 'bg-warning-bg' },
  rejected:            { Icon: XIcon,        color: 'text-text-secondary', bg: 'bg-page' },
  escalated:           { Icon: AlertTriangle, color: 'text-danger',        bg: 'bg-danger-bg' },
  sla_extended:        { Icon: Clock,        color: 'text-warning',        bg: 'bg-warning-bg' },
}

interface Props {
  events: AppccIncidentEvent[]
  compact?: boolean
}

export default function IncidentTimeline({ events, compact = false }: Props) {
  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [events]
  )

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-text-secondary italic">
        Sin eventos registrados todavía.
      </p>
    )
  }

  return (
    <ol className="relative space-y-3">
      {/* Línea vertical */}
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border-default" />

      {sorted.map((evt) => {
        const meta = EVENT_META[evt.event_type] ?? EVENT_META.created
        const Icon = meta.Icon
        const dt = new Date(evt.created_at)
        const fullText = (evt.event_data as { full_text?: unknown } | null)?.full_text

        return (
          <li
            key={evt.id}
            className="relative flex items-start gap-3 pl-0"
          >
            {/* Icono del evento */}
            <div
              className={`relative z-10 shrink-0 w-8 h-8 rounded-full ${meta.bg} ${meta.color} flex items-center justify-center border-2 border-card`}
            >
              <Icon size={16} />
            </div>

            {/* Contenido */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-text-primary">
                  {evt.description ?? evt.event_type}
                </span>
                <span className="text-xs text-text-secondary">
                  {dt.toLocaleString('es-ES', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              {evt.actor_name && (
                <div className="text-xs text-text-secondary mt-0.5">
                  por {evt.actor_name}
                </div>
              )}
              {!compact && typeof fullText === 'string' && fullText && (
                <div className="text-sm text-text-primary mt-1 bg-page p-2 rounded">
                  {fullText}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
