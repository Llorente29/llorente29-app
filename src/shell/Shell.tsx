// src/shell/Shell.tsx
//
// Contenedor raíz del Shell modular (Bloque G, Sprint 3).
// Monta el TopBar y el área de contenido de la sección activa.
//
// G-4: TopBar + placeholder.
// G-5: Home general (sección "Inicio") con sus widgets.
// G-6 (opción A): cuando hay un módulo activo, layout de TRES ZONAS:
//      TopBar (arriba) + ModuleSidebar (izquierda) + contenido. El contenido
//      de cada item del sidebar es PLACEHOLDER honesto: enchufar las páginas
//      reales (TodayPage, AuditsPage, etc.) con su contexto/slug se hará en
//      una fase posterior bien acotada (resolver slug/AppContext sin romper
//      Llorente29). Aquí solo se valida el layout y la navegación interna.
//
// Montado tras ruta /shell desde App.tsx — NO es el render por defecto
// todavía (eso es G-8).

import { useEffect, useState } from 'react'
import ShellTopBar, { HOME_KEY } from './ShellTopBar'
import ModuleSidebar from './ModuleSidebar'
import { getModuleById } from './moduleRegistry'
import HomeGeneral from './home/HomeGeneral'
import { useApp } from '../context/AppContext'

export default function Shell() {
  const [activeKey, setActiveKey] = useState<string>(HOME_KEY)
  // Item activo dentro del módulo (id del ModuleSidebarItem).
  const [activeItemId, setActiveItemId] = useState<string>('')
  const { userProfile } = useApp()

  const activeModule = activeKey === HOME_KEY ? null : getModuleById(activeKey)

  // Al entrar a un módulo, seleccionar su primer item del sidebar por defecto.
  useEffect(() => {
    if (activeModule && activeModule.sidebar.items.length > 0) {
      setActiveItemId(activeModule.sidebar.items[0].id)
    }
  }, [activeModule])

  // Nombre real del usuario para el saludo del Home (null → saludo genérico).
  // displayName es nullable en BBDD (invite pendiente, legacy).
  const userName = userProfile?.displayName ?? undefined

  // Iniciales para el avatar del TopBar a partir del displayName.
  const initials = userName
    ? userName.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : 'JG'

  const activeItem = activeModule?.sidebar.items.find(i => i.id === activeItemId)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#FBFAF7' }}>
      <ShellTopBar activeKey={activeKey} onSelect={setActiveKey} userInitials={initials} />

      {activeKey === HOME_KEY ? (
        // Home general transversal (sin ModuleSidebar, es del Shell).
        <main className="flex-1" style={{ paddingLeft: 26, paddingRight: 26, paddingTop: 24, paddingBottom: 24 }}>
          <HomeGeneral userName={userName} onOpenModule={setActiveKey} />
        </main>
      ) : activeModule ? (
        // Módulo activo: layout de tres zonas (sidebar + contenido).
        <div className="flex-1 flex">
          <ModuleSidebar
            moduleName={activeModule.name}
            sidebar={activeModule.sidebar}
            activeItemId={activeItemId}
            onSelectItem={setActiveItemId}
          />
          <main className="flex-1" style={{ paddingLeft: 26, paddingRight: 26, paddingTop: 24, paddingBottom: 24 }}>
            <PlaceholderPanel
              title={activeItem?.label ?? activeModule.name}
              note={`Contenido de "${activeItem?.label ?? ''}" (${activeModule.name}). Las páginas reales se enchufan en la fase siguiente.`}
            />
          </main>
        </div>
      ) : (
        // Módulo no encontrado en el registry (no debería pasar).
        <main className="flex-1" style={{ padding: 26 }}>
          <PlaceholderPanel title={activeKey} note="Módulo no registrado." />
        </main>
      )}
    </div>
  )
}

// Placeholder de contenido (provisional hasta enchufar páginas reales).
function PlaceholderPanel({ title, note }: { title: string; note: string }) {
  return (
    <div className="max-w-2xl">
      <h1
        className="text-2xl mb-1"
        style={{ fontFamily: 'Fraunces, Georgia, serif', color: '#1E3A5F', fontWeight: 500 }}
      >
        {title}
      </h1>
      <p className="text-sm" style={{ color: '#8A8780' }}>{note}</p>
    </div>
  )
}
