// src/components/trabajador/BottomTabBar.tsx
// Barra de navegación inferior del portal del trabajador (móvil-first).
// Patrón estándar HIG/Material: 4 destinos de primer nivel, barra fija abajo,
// tab activo en navy. Se monta SOLO en pantallas de primer nivel; las pantallas
// profundas (ejecutar checklist, subpáginas del portal) no la muestran para no
// chocar con su flecha de volver.
//
// Es un componente "tonto": no navega por sí mismo, solo pinta y avisa por
// onSelect. El orquestador (TrabajadorApp) decide qué hace cada tab.

import { Home, LogIn, ClipboardCheck, LayoutGrid } from 'lucide-react'

export type WorkerTab = 'inicio' | 'fichar' | 'tareas' | 'mas'

interface TabDef {
  id: WorkerTab
  label: string
  icon: typeof Home
}

const TABS: TabDef[] = [
  { id: 'inicio', label: 'Inicio', icon: Home },
  { id: 'fichar', label: 'Fichar', icon: LogIn },
  { id: 'tareas', label: 'Tareas', icon: ClipboardCheck },
  { id: 'mas',    label: 'Más',    icon: LayoutGrid },
]

interface Props {
  /** Tab actualmente activo (se resalta en navy). */
  active: WorkerTab
  /** Aviso al pulsar un tab. El orquestador decide la navegación. */
  onSelect: (tab: WorkerTab) => void
  /** Si el local no tiene APPCC, se puede ocultar el tab Tareas. */
  showTareas?: boolean
}

export default function BottomTabBar({ active, onSelect, showTareas = true }: Props) {
  const tabs = showTareas ? TABS : TABS.filter(t => t.id !== 'tareas')

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border-default"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Navegación principal"
    >
      <div className="max-w-md mx-auto flex items-stretch">
        {tabs.map(tab => {
          const Icon = tab.icon
          const isActive = tab.id === active
          return (
            <button
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-base ${
                isActive ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
              }`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.label}
            >
              <Icon size={22} strokeWidth={isActive ? 2.4 : 2} />
              <span className={`text-[11px] ${isActive ? 'font-semibold' : 'font-medium'}`}>
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
