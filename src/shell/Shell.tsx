// src/shell/Shell.tsx
//
// Contenedor raíz del Shell modular (Bloque G-4, Sprint 3).
// Monta el TopBar y el área de contenido de la sección activa.
//
// G-4: el área de contenido es un placeholder. El Home general (G-5) y el
// render de módulos con su ModuleSidebar (G-6) se cablean después.
//
// Montado tras flag (?shell=1) desde App.tsx — NO es el render por defecto
// todavía (eso es G-8).

import { useState } from 'react'
import ShellTopBar, { HOME_KEY } from './ShellTopBar'
import { getModuleById } from './moduleRegistry'

export default function Shell() {
  const [activeKey, setActiveKey] = useState<string>(HOME_KEY)

  const activeModule = activeKey === HOME_KEY ? null : getModuleById(activeKey)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#FBFAF7' }}>
      <ShellTopBar activeKey={activeKey} onSelect={setActiveKey} />

      <main className="flex-1" style={{ paddingLeft: 26, paddingRight: 26, paddingTop: 24, paddingBottom: 24 }}>
        {activeKey === HOME_KEY ? (
          <PlaceholderPanel
            title="Inicio"
            note="Home general transversal (se construye en G-5)."
          />
        ) : (
          <PlaceholderPanel
            title={activeModule?.name ?? activeKey}
            note="Render del módulo con su ModuleSidebar (se construye en G-6)."
          />
        )}
      </main>
    </div>
  )
}

// Placeholder temporal de G-4 (se elimina en G-5/G-6).
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
