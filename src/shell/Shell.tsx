// src/shell/Shell.tsx
//
// Contenedor raíz del Shell modular (Bloque G, Sprint 3).
// Monta el TopBar y el área de contenido de la sección activa.
//
// G-4: TopBar + placeholder.
// G-5: el Home general (sección "Inicio") ya renderiza HomeGeneral con sus
//      widgets. El contenido de los MÓDULOS sigue siendo placeholder hasta G-6
//      (ModuleSidebar + render del módulo activo).
//
// Montado tras ruta /shell desde App.tsx — NO es el render por defecto
// todavía (eso es G-8).

import { useState } from 'react'
import ShellTopBar, { HOME_KEY } from './ShellTopBar'
import { getModuleById } from './moduleRegistry'
import HomeGeneral from './home/HomeGeneral'
import { useApp } from '../context/AppContext'

export default function Shell() {
  const [activeKey, setActiveKey] = useState<string>(HOME_KEY)
  const { userProfile } = useApp()

  const activeModule = activeKey === HOME_KEY ? null : getModuleById(activeKey)

  // Nombre real del usuario para el saludo del Home (null → saludo genérico).
  // displayName es nullable en BBDD (invite pendiente, legacy).
  const userName = userProfile?.displayName ?? undefined

  // Iniciales para el avatar del TopBar a partir del displayName.
  const initials = userName
    ? userName.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : 'JG'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#FBFAF7' }}>
      <ShellTopBar activeKey={activeKey} onSelect={setActiveKey} userInitials={initials} />

      <main className="flex-1" style={{ paddingLeft: 26, paddingRight: 26, paddingTop: 24, paddingBottom: 24 }}>
        {activeKey === HOME_KEY ? (
          // G-5: Home general transversal con nombre real del usuario (si existe).
          <HomeGeneral userName={userName} onOpenModule={setActiveKey} />
        ) : (
          // G-6: aquí irá el ModuleSidebar + el contenido del módulo activo.
          <PlaceholderPanel
            title={activeModule?.name ?? activeKey}
            note="Render del módulo con su ModuleSidebar (se construye en G-6)."
          />
        )}
      </main>
    </div>
  )
}

// Placeholder temporal para módulos (se elimina en G-6).
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
