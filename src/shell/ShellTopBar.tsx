// src/shell/ShellTopBar.tsx
//
// TopBar del Shell modular (Bloque G-4, Sprint 3). Patrón "Microsoft 365":
// barra superior azul marino con wordmark Folvy + pestañas (Inicio + módulos
// del registry) + selector de local + notificaciones + avatar.
//
// Diseño aprobado por Julio (Sesión 14): marca azul marino #1E3A5F, wordmark
// Fraunces, sección activa subrayada en terracota #D67442. Proporciones
// validadas en maqueta: barra 68px, isotipo+wordmark inline (no .svg externo,
// para clavar el tamaño), pestañas 15px con aire.
//
// El logo se dibuja INLINE (isotipo SVG + texto) en vez de cargar un fichero
// .svg, para controlar las proporciones al pixel y que coincidan con la
// maqueta independientemente del viewBox de ningún fichero.

import { Home, Bell, MapPin } from 'lucide-react'
import { getOrderedModules } from './moduleRegistry'

// Clave especial del Home general (no es un módulo, es del Shell).
export const HOME_KEY = '__home__'

const INK = '#1E3A5F'
const CREAM = '#F5F4F0'
const TERRACOTA = '#D67442'
const MUTED = '#9FB3C8'

interface ShellTopBarProps {
  activeKey: string
  onSelect: (key: string) => void
  userInitials?: string
  locationLabel?: string
}

export default function ShellTopBar({
  activeKey,
  onSelect,
  userInitials = 'JG',
  locationLabel = 'Todos los locales',
}: ShellTopBarProps) {
  const modules = getOrderedModules()

  return (
    <header
      className="flex items-center shrink-0"
      style={{ background: INK, height: 68, paddingLeft: 26, paddingRight: 26, gap: 34 }}
    >
      {/* Wordmark inline (isotipo + texto), proporciones de maqueta */}
      <div className="flex items-center shrink-0" style={{ gap: 11 }}>
        <svg width="34" height="34" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="38" fill="none" stroke={CREAM} strokeWidth="6" />
          <path d="M 50 12 A 38 38 0 0 1 76.9 76.9" fill="none" stroke={TERRACOTA} strokeWidth="10" strokeLinecap="round" />
          <circle cx="50" cy="50" r="6" fill={TERRACOTA} />
        </svg>
        <span style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, color: CREAM, fontWeight: 600, letterSpacing: '-0.5px', lineHeight: 1 }}>
          folvy
        </span>
      </div>

      {/* Pestañas: Inicio + módulos */}
      <nav className="flex items-stretch self-stretch" style={{ gap: 4 }}>
        <TabButton
          label="Inicio"
          icon={<Home size={18} />}
          active={activeKey === HOME_KEY}
          onClick={() => onSelect(HOME_KEY)}
        />
        {modules.map(m => {
          const Icon = m.icon
          return (
            <TabButton
              key={m.id}
              label={m.name}
              icon={<Icon size={18} />}
              active={activeKey === m.id}
              onClick={() => onSelect(m.id)}
            />
          )
        })}
      </nav>

      {/* Lado derecho: local, notificaciones, avatar */}
      <div className="flex items-center shrink-0" style={{ marginLeft: 'auto', gap: 16 }}>
        <span className="inline-flex items-center" style={{ color: MUTED, fontSize: 14, gap: 5 }}>
          <MapPin size={16} /> {locationLabel}
        </span>
        <button type="button" aria-label="Notificaciones" className="inline-flex items-center" style={{ color: MUTED }}>
          <Bell size={19} />
        </button>
        <div
          className="rounded-full flex items-center justify-center text-white shrink-0"
          style={{ width: 34, height: 34, background: TERRACOTA, fontSize: 13, fontWeight: 500 }}
        >
          {userInitials}
        </div>
      </div>
    </header>
  )
}

// ─── Botón de pestaña del TopBar ───────────────────────────────────────────
function TabButton({
  label, icon, active, onClick,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center transition-colors"
      style={{
        gap: 8,
        paddingLeft: 16,
        paddingRight: 16,
        fontSize: 15,
        color: active ? CREAM : MUTED,
        borderBottom: active ? `2px solid ${TERRACOTA}` : '2px solid transparent',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
