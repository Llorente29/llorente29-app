// src/shell/ShellBottomNav.tsx
//
// R1.2 — Barra de navegación inferior (bottom tab bar) del Shell en MÓVIL.
//
// Primer nivel de navegación (módulos) en una barra fija inferior, patrón
// nativo de app/PWA: alcanzable con el pulgar, persistente y visible (mejor
// descubribilidad que un menú escondido). Solo se monta en móvil: el Shell la
// renderiza condicionalmente con useIsMobile; en escritorio no existe.
//
// Contrato calcado del ShellTopBar (activeKey + onSelect) para compartir la
// misma lógica de navegación del Shell (goToKey) sin duplicarla.
//
// R1.2 es ADITIVO: aparece la barra, no se quita nada. Las pestañas del TopBar
// y el ModuleSidebar siguen ahí (redundantes pero funcionales) hasta R1.3, que
// minimiza el TopBar, convierte el sidebar en sub-pestañas (2º nivel) e inserta
// la IA como héroe central de esta barra. Así ningún paso deja navegación rota.

import { useState } from 'react'
import { Home, MoreHorizontal } from 'lucide-react'
import { HOME_KEY } from './ShellTopBar'
import { getOrderedModules } from './moduleRegistry'
import { usePermissions } from '@/modules/multitenancy/hooks/usePermissions'
import type { ModuleDefinition } from './types'
import type { UserProfileRole } from '@/types/multitenancy'

// Tipo de icono = el mismo que declara cada módulo (ModuleDefinition.icon), así
// los iconos lucide (Home, MoreHorizontal) y los de los módulos comparten tipo.
type IconType = ModuleDefinition['icon']

// Azul apagado del TopBar (no hay var CSS para él aún) — se mantiene idéntico
// para que la barra inferior haga juego con la superior. INK y TERRACOTA sí
// viven como vars en index.css y se usan vía var(). En R1.3, al tocar el
// TopBar, se unifican los tokens en un helper compartido y se quita esta línea.
const MUTED = '#9FB3C8'

// Tope cómodo de pestañas en una bottom bar (HIG iOS = 5). Inicio + 4 módulos
// = 5 → entran justas. Si el registro crece, el resto se pliega en "Más".
const MAX_TABS = 5

interface ShellBottomNavProps {
  activeKey: string
  onSelect: (key: string) => void
}

interface NavEntry {
  key: string
  label: string
  Icon: IconType
}

// Mirror EXACTO de la visibilidad por módulo del ShellTopBar (un módulo se ve
// si tiene >=1 item que pasa permiso Y rol). Se replica aquí; en R1.3 se extrae
// a un helper compartido cuando se toque el TopBar (se elimina el duplicado).
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

export default function ShellBottomNav({ activeKey, onSelect }: ShellBottomNavProps) {
  const { hasPermission, role } = usePermissions()
  const [moreOpen, setMoreOpen] = useState(false)

  const visibleModules = getOrderedModules()
    .filter(m => isModuleVisible(m, hasPermission, role))

  // Entradas: Inicio + módulos visibles.
  const allEntries: NavEntry[] = [
    { key: HOME_KEY, label: 'Inicio', Icon: Home },
    ...visibleModules.map(m => ({ key: m.id, label: m.name, Icon: m.icon })),
  ]

  // Si caben todas, se muestran. Si no, primeras (MAX_TABS - 1) + "Más".
  const overflow = allEntries.length > MAX_TABS
  const primary = overflow ? allEntries.slice(0, MAX_TABS - 1) : allEntries
  const extra = overflow ? allEntries.slice(MAX_TABS - 1) : []

  // "Más" se marca activo si la sección activa está dentro del overflow.
  const moreActive = extra.some(e => e.key === activeKey)

  function handleSelect(key: string) {
    setMoreOpen(false)
    onSelect(key)
  }

  return (
    <>
      {/* Hoja de "Más" (overflow): fondo translúcido + panel inferior. */}
      {moreOpen && extra.length > 0 && (
        <div
          onClick={() => setMoreOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'rgba(12,10,9,0.35)',
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              background: 'var(--color-bg-card)',
              borderTopLeftRadius: 16, borderTopRightRadius: 16,
              padding: '0.5rem 0.5rem calc(0.5rem + env(safe-area-inset-bottom))',
              boxShadow: '0 -8px 24px rgba(12,10,9,0.12)',
            }}
          >
            {extra.map(e => {
              const Icon = e.Icon
              const active = e.key === activeKey
              return (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => handleSelect(e.key)}
                  className="w-full flex items-center text-left"
                  style={{
                    gap: 12, padding: '0.875rem 0.75rem', borderRadius: 10,
                    fontSize: '1rem',
                    background: active ? 'var(--color-accent-bg)' : 'transparent',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <Icon size={20} />
                  {e.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <nav
        aria-label="Navegacion principal"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
          background: 'var(--color-accent)',
          display: 'flex',
          height: 56,
          paddingBottom: 'env(safe-area-inset-bottom)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {primary.map(entry => (
          <BottomTab
            key={entry.key}
            label={entry.label}
            Icon={entry.Icon}
            active={entry.key === activeKey}
            onClick={() => handleSelect(entry.key)}
          />
        ))}
        {overflow && (
          <BottomTab
            label="Mas"
            Icon={MoreHorizontal}
            active={moreActive || moreOpen}
            onClick={() => setMoreOpen(o => !o)}
          />
        )}
      </nav>
    </>
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
        gap: 3,
        height: 56,
        background: 'transparent',
        color: active ? 'var(--color-terracota)' : MUTED,
      }}
    >
      <Icon size={22} />
      <span style={{ fontSize: 10.5, fontWeight: 500, lineHeight: 1 }}>{label}</span>
    </button>
  )
}
