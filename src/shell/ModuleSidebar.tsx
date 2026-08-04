// src/shell/ModuleSidebar.tsx
//
// Barra lateral interna de un módulo (Bloque G-6 + G-8.4 legibilidad).
// Cada módulo declara su navegación en ModuleDefinition.sidebar (G-3). El
// Shell la renderiza aquí cuando ese módulo está activo. Patrón "Microsoft
// 365": TopBar de módulos arriba + esta ModuleSidebar a la izquierda.
//
// LEGIBILIDAD (Sesión 14): usa los tokens de color de index.css (no grises
// hardcodeados) para heredar el contraste del sistema, y tamaños en rem
// (escalan con la preferencia de fuente del navegador → accesibilidad).
// Items a 0.9375rem (15px): cómodos para etiquetas de navegación.

import type { ModuleSidebarDefinition } from './types'
import { usePermissions } from '../modules/multitenancy/hooks/usePermissions'

const SURFACE = 'var(--color-bg-page)'
const BORDER = 'var(--color-border-default)'

interface ModuleSidebarProps {
  moduleName: string
  sidebar: ModuleSidebarDefinition
  activeItemId: string
  onSelectItem: (itemId: string) => void
}

export default function ModuleSidebar({
  moduleName, sidebar, activeItemId, onSelectItem,
}: ModuleSidebarProps) {
  // Gating por permiso granular Y por rol mínimo. Un item se muestra si
  // pasa AMBOS filtros:
  //   - Permiso: si declara requiredPermission, hasPermission(clave) === true.
  //   - Rol: si declara requiredRole, roleInActiveAccount === requiredRole
  //     (los admin de cuenta pasan siempre el filtro de rol).
  // El `role` viene del propio hook usePermissions (que lo lee del context
  // como `roleInActiveAccount`); NO usamos isAdmin del context — es la
  // deuda B-8 que ya está documentada en usePermissions.
  const { hasPermission, role } = usePermissions()
  const visibleItems = sidebar.items.filter(item => {
    const passesPermission = !item.requiredPermission || hasPermission(item.requiredPermission)
    const passesRole = !item.requiredRole || role === item.requiredRole || role === 'admin'
    return passesPermission && passesRole
  })

  return (
    // Auditoría externa (Bloque 4, tablet): a 208px fijos, un iPad vertical
    // (768px) le daba el 27% del ancho a esto solo. De 768 a 1023px (tablet:
    // isMobile ya es false ahí, así que Shell.tsx sigue montando ESTA
    // sidebar, no MobileModuleTabs) se colapsa a solo-icono (w-14 = 56px,
    // patrón "activity bar" ya estándar en apps de escritorio/tablet). A
    // partir de 1024px (lg) recupera el ancho y las etiquetas de siempre —
    // 208px exactos (w-52 = 13rem). Puro CSS/Tailwind: no toca useIsMobile
    // ni la rama de Shell.tsx, cero riesgo para el bottom-nav móvil ni para
    // los terminales standalone (que ni montan este componente).
    <aside
      className="shrink-0 w-14 lg:w-52"
      style={{
        background: SURFACE,
        borderRight: `0.5px solid ${BORDER}`,
        padding: '1rem 0.625rem',
      }}
    >
      <p
        className="hidden lg:block"
        style={{
          fontSize: '0.6875rem',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          color: 'var(--color-text-secondary)',
          margin: '0 0 0.625rem 0.5rem',
          fontWeight: 600,
        }}
      >
        {moduleName}
      </p>

      <nav className="flex flex-col" style={{ gap: 2 }}>
        {visibleItems.map(item => {
          const Icon = item.icon
          const active = item.id === activeItemId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectItem(item.id)}
              title={item.label}
              className="flex items-center justify-center lg:justify-start text-left transition-colors"
              style={{
                gap: 10,
                padding: '0.5rem 0.625rem',
                borderRadius: 8,
                fontSize: '0.9375rem',
                background: active ? 'var(--color-accent)' : 'transparent',
                color: active ? '#fff' : 'var(--color-text-primary)',
              }}
            >
              <Icon size={17} className="shrink-0" />
              <span className="hidden lg:inline">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
