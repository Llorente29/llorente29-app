// src/shell/MobileModuleTabs.tsx
//
// R1.3a — Sub-pestañas del 2º nivel en MÓVIL.
//
// En móvil sustituye al ModuleSidebar (208px fijo a la izquierda, que se comía
// la pantalla en pantallas estrechas): los items del módulo activo se muestran
// en una tira horizontal deslizable bajo el TopBar. Mismo gating que el sidebar
// (permiso granular + rol mínimo). En escritorio NO se usa: el Shell sigue
// montando ModuleSidebar sin cambios.

import type { ModuleSidebarDefinition } from './types'
import { usePermissions } from '../modules/multitenancy/hooks/usePermissions'

interface MobileModuleTabsProps {
  sidebar: ModuleSidebarDefinition
  activeItemId: string
  onSelectItem: (itemId: string) => void
}

export default function MobileModuleTabs({
  sidebar, activeItemId, onSelectItem,
}: MobileModuleTabsProps) {
  // Mismo filtro que ModuleSidebar: permiso granular Y rol mínimo (admin pasa
  // siempre el rol). Se replica aquí a propósito; cuando se unifiquen los tokens
  // y helpers del Shell se extrae a un sitio común y se quita la repetición.
  const { hasPermission, role } = usePermissions()
  const visibleItems = sidebar.items.filter(item => {
    const passesPermission = !item.requiredPermission || hasPermission(item.requiredPermission)
    const passesRole = !item.requiredRole || role === item.requiredRole || role === 'admin'
    return passesPermission && passesRole
  })

  if (visibleItems.length === 0) return null

  return (
    <nav
      aria-label="Secciones del modulo"
      className="flex overflow-x-auto shrink-0"
      style={{
        gap: 6,
        padding: '0.5rem 0.75rem',
        background: 'var(--color-bg-page)',
        borderBottom: '0.5px solid var(--color-border-default)',
        // Oculta la barra de scroll (la tira se desliza con el dedo).
        scrollbarWidth: 'none',
      }}
    >
      {visibleItems.map(item => {
        const Icon = item.icon
        const active = item.id === activeItemId
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectItem(item.id)}
            className="flex items-center shrink-0 transition-colors"
            style={{
              gap: 7,
              padding: '0.4375rem 0.75rem',
              borderRadius: 999,
              fontSize: '0.875rem',
              whiteSpace: 'nowrap',
              background: active ? 'var(--color-accent)' : 'var(--color-bg-card)',
              color: active ? '#fff' : 'var(--color-text-primary)',
              border: active ? 'none' : '0.5px solid var(--color-border-default)',
            }}
          >
            <Icon size={16} />
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}
