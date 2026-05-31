// src/shell/ShellBottomNav.tsx
//
// R1.2/R1.3b — Barra de navegación inferior (bottom tab bar) del Shell en MÓVIL.
//
// Primer nivel de navegación (módulos) en una barra fija inferior, patrón
// nativo de app/PWA: alcanzable con el pulgar, persistente y visible. Solo se
// monta en móvil: el Shell la renderiza con useIsMobile; en escritorio no existe.
//
// R1.3b — IA COMO HÉROE CENTRAL (patrón Instagram: 2 pestañas + acción central
// elevada + 2 pestañas). El héroe abre Folvy AI (onOpenAI). Los módulos del
// overflow (ver shellMobileNav) se alcanzan desde el menú del avatar del TopBar.
// El héroe usa el ISOTIPO de Folvy (círculo + arco terracota + punto) con un
// latido ligerísimo (punto que late + halo tenue), respetando reduced-motion.

import { Home } from 'lucide-react'
import { HOME_KEY } from './ShellTopBar'
import { getOrderedModules } from './moduleRegistry'
import { isMobileOverflowModule } from './shellMobileNav'
import { usePermissions } from '@/modules/multitenancy/hooks/usePermissions'
import type { ModuleDefinition } from './types'
import type { UserProfileRole } from '@/types/multitenancy'

// Tipo de icono = el mismo que declara cada módulo (ModuleDefinition.icon).
type IconType = ModuleDefinition['icon']

// Azul apagado del TopBar (no hay var CSS para él aún) — hace juego con la barra
// superior. INK y TERRACOTA viven como vars en index.css y se usan vía var().
const MUTED = '#9FB3C8'

interface ShellBottomNavProps {
  activeKey: string
  onSelect: (key: string) => void
  // Abre Folvy AI (lo gobierna el Shell, que controla el panel del chat).
  onOpenAI: () => void
  // ¿El panel de IA está abierto? (para resaltar el héroe).
  aiActive?: boolean
}

interface NavEntry {
  key: string
  label: string
  Icon: IconType
}

// Etiqueta corta para la barra (sin el prefijo de marca "Folvy ").
function shortLabel(name: string): string {
  return name.replace(/^Folvy\s+/i, '')
}

// Mirror de la visibilidad por módulo del ShellTopBar (permiso + rol).
function isModuleVisible(
  module: ModuleDefinition,
  hasPermission: (key: string) => boolean,
  role: UserProfileRole | null,
): boolean {
  const items = module.sidebar?.items
  if (!items || items.length === 0) return false
  return items.some(item => {
    const passesPermission = !item.requiredPermission || hasPermission(item.requiredPermission)
    const passesRole = !item.requiredRole || role === item.requiredRole || role === 'admin'
    return passesPermission && passesRole
  })
}

export default function ShellBottomNav({ activeKey, onSelect, onOpenAI, aiActive = false }: ShellBottomNavProps) {
  const { hasPermission, role } = usePermissions()

  // Módulos visibles, EXCLUYENDO los del overflow (van al menú del avatar).
  const barModules = getOrderedModules()
    .filter(m => isModuleVisible(m, hasPermission, role))
    .filter(m => !isMobileOverflowModule(m.id))

  // Pestañas de la barra: Inicio + módulos de barra.
  const entries: NavEntry[] = [
    { key: HOME_KEY, label: 'Inicio', Icon: Home },
    ...barModules.map(m => ({ key: m.id, label: shortLabel(m.name), Icon: m.icon })),
  ]

  // Partir 2+2 (o lo que haya) para dejar el héroe IA en el centro.
  const mid = Math.ceil(entries.length / 2)
  const left = entries.slice(0, mid)
  const right = entries.slice(mid)

  return (
    <nav
      aria-label="Navegacion principal"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
        background: 'var(--color-accent)',
        display: 'flex', alignItems: 'stretch',
        height: 56,
        paddingBottom: 'env(safe-area-inset-bottom)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {left.map(entry => (
        <BottomTab
          key={entry.key}
          label={entry.label}
          Icon={entry.Icon}
          active={entry.key === activeKey}
          onClick={() => onSelect(entry.key)}
        />
      ))}

      <AIHero active={aiActive} onClick={onOpenAI} />

      {right.map(entry => (
        <BottomTab
          key={entry.key}
          label={entry.label}
          Icon={entry.Icon}
          active={entry.key === activeKey}
          onClick={() => onSelect(entry.key)}
        />
      ))}
    </nav>
  )
}

// ─── Héroe IA central (isotipo Folvy elevado, con latido ligerísimo) ────────
function AIHero({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`
        @keyframes folvyHeroDot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.28); opacity: 0.6; }
        }
        @keyframes folvyHeroGlow {
          0%, 100% { box-shadow: 0 4px 12px rgba(12,10,9,0.28), 0 0 0 0 rgba(214,116,66,0); }
          50%      { box-shadow: 0 4px 12px rgba(12,10,9,0.28), 0 0 0 7px rgba(214,116,66,0.14); }
        }
        .folvy-hero-btn { animation: folvyHeroGlow 2.6s ease-in-out infinite; }
        .folvy-hero-dot { transform-box: fill-box; transform-origin: center; animation: folvyHeroDot 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .folvy-hero-btn, .folvy-hero-dot { animation: none; }
        }
      `}</style>
      <button
        type="button"
        onClick={onClick}
        aria-label="Folvy AI"
        aria-pressed={active}
        className="folvy-hero-btn"
        style={{
          width: 58, height: 58, borderRadius: 999,
          background: 'var(--color-accent)',
          border: `3px solid ${active ? 'var(--color-terracota)' : 'var(--color-bg-page)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: 'translateY(-14px)',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <svg width="32" height="32" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="38" fill="none" stroke="#F5F4F0" strokeWidth="6" />
          <path d="M 50 12 A 38 38 0 0 1 76.9 76.9" fill="none" stroke="#D67442" strokeWidth="10" strokeLinecap="round" />
          <circle className="folvy-hero-dot" cx="50" cy="50" r="6" fill="#D67442" />
        </svg>
      </button>
    </div>
  )
}

// ─── Pestaña individual de la barra inferior ────────────────────────────────
function BottomTab({
  label, Icon, active, onClick,
}: {
  label: string
  Icon: IconType
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center transition-colors"
      style={{
        flex: 1,
        minWidth: 0,
        gap: 3,
        height: 56,
        padding: '0 2px',
        background: 'transparent',
        color: active ? 'var(--color-terracota)' : MUTED,
      }}
    >
      <Icon size={22} />
      <span
        style={{
          fontSize: 10.5, fontWeight: 500, lineHeight: 1,
          maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </button>
  )
}
