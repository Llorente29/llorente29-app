// src/shell/ModuleSidebar.tsx
//
// Barra lateral interna de un módulo (Bloque G-6, Sprint 3).
// Cada módulo declara su navegación en ModuleDefinition.sidebar (G-3). El
// Shell la renderiza aquí cuando ese módulo está activo. Patrón "Microsoft
// 365": TopBar de módulos arriba + esta ModuleSidebar a la izquierda.
//
// G-6 (opción A): pinta los items y gestiona cuál está activo por estado
// local. Al pulsar un item, cambia el item activo (el contenido real de cada
// página se enchufa en una fase posterior; aquí el contenido es placeholder).
//
// Diseño: fondo cream claro, item activo en azul marino, resto en texto
// neutro. Coherente con la maqueta del Shell.

import type { ModuleSidebarDefinition } from './types'

const INK = '#1E3A5F'
const TEXT = '#44443F'
const MUTED = '#8A8780'
const BORDER = '#D8D5CC'
const SURFACE = '#F5F4F0'

interface ModuleSidebarProps {
  // Nombre comercial del módulo (cabecera de la sidebar).
  moduleName: string
  sidebar: ModuleSidebarDefinition
  // id del item activo.
  activeItemId: string
  onSelectItem: (itemId: string) => void
}

export default function ModuleSidebar({
  moduleName, sidebar, activeItemId, onSelectItem,
}: ModuleSidebarProps) {
  return (
    <aside
      className="shrink-0"
      style={{
        width: 200,
        background: SURFACE,
        borderRight: `0.5px solid ${BORDER}`,
        padding: '16px 10px',
      }}
    >
      <p
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          color: MUTED,
          margin: '0 0 10px 8px',
        }}
      >
        {moduleName}
      </p>

      <nav className="flex flex-col" style={{ gap: 2 }}>
        {sidebar.items.map(item => {
          const Icon = item.icon
          const active = item.id === activeItemId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectItem(item.id)}
              className="flex items-center text-left transition-colors"
              style={{
                gap: 9,
                padding: '8px 10px',
                borderRadius: 8,
                fontSize: 13,
                background: active ? INK : 'transparent',
                color: active ? '#fff' : TEXT,
              }}
            >
              <Icon size={16} />
              {item.label}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
