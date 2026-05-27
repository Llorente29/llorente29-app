// src/shell/Shell.tsx
//
// Contenedor raíz del Shell modular (Bloque G, Sprint 3).
//
// G-4: TopBar + placeholder.
// G-5: Home general con widgets.
// G-6: ModuleSidebar + layout tres zonas (contenido placeholder).
// G-8.1: el Shell navega por RUTAS (no useState). La sección activa se deriva
//        del pathname:
//          /shell                  → Home general
//          /shell/:base            → módulo (primer item del sidebar)
//          /shell/:base/:itemPath  → item concreto del módulo
//        TopBar y ModuleSidebar navegan con navigate(). Esto prepara el
//        enchufado de páginas reales (G-8.2) y el cambio de default (G-8.6).
//        Sigue tras la ruta /shell — NO es el render por defecto todavía.

import { useState } from 'react'
import { useNavigate, useLocation, Routes, Route } from 'react-router-dom'
import ShellTopBar, { HOME_KEY } from './ShellTopBar'
import ModuleSidebar from './ModuleSidebar'
import { getModuleById, getModuleByBasePath } from './moduleRegistry'
import { configuracionModule } from '../modules/configuracion/module'
import HomeGeneral from './home/HomeGeneral'
import TrabajadorApp from '../pages/trabajador/TrabajadorApp'
import { useApp } from '../context/AppContext'
import { FolvyAIBubble } from '../modules/folvy-ai/components/FolvyAIBubble'

// G-8.6 (opción C): el Shell vive en la RAÍZ, sin prefijo /shell ni slug.
// Las URLs son /, /appcc/hoy, /configuracion/locales, etc. La cuenta activa
// se resuelve por AppContext, no por la URL (no se pierde multi-tenancy).
const SETTINGS_BASE = 'configuracion'

export default function Shell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userProfile } = useApp()

  // Modo trabajador del encargado dual: alterna en el cliente entre Shell de
  // gestión y TrabajadorApp sin tocar App.tsx ni AppContext. Solo activable si
  // el user tiene employee_id (encargado con ficha); para un admin sin ficha
  // el botón del TopBar no se renderiza (ver onEnterWorkerMode más abajo).
  const [workerMode, setWorkerMode] = useState(false)

  // Derivar sección activa del pathname. Con SHELL_BASE='' el pathname ES
  // directamente /:base/:item (sin prefijo). rest = pathname sin barras.
  const rest = location.pathname.replace(/^\/+|\/+$/g, '')
  const segments = rest === '' ? [] : rest.split('/')
  const moduleBasePath = segments[0] ?? ''            // '' = Home
  const itemPathFromUrl = segments.slice(1).join('/') // resto = path del item

  const activeModule = moduleBasePath === ''
    ? null
    : moduleBasePath === SETTINGS_BASE
      ? configuracionModule          // módulo especial: no está en el registry
      : getModuleByBasePath(moduleBasePath)

  // ¿Estamos en Configuración? (para marcar el engranaje activo).
  const settingsActive = moduleBasePath === SETTINGS_BASE

  // activeKey para el TopBar: HOME_KEY o el id del módulo activo. Configuración
  // NO es pestaña del TopBar, así que cuando está activa ninguna pestaña queda
  // resaltada (lo lleva el engranaje).
  const activeKey = (activeModule && !settingsActive) ? activeModule.id : HOME_KEY

  // Item activo del módulo: el que matchea el path de la URL, o el primero.
  const activeItem = activeModule
    ? (activeModule.sidebar.items.find(i => i.path === itemPathFromUrl)
       ?? activeModule.sidebar.items[0])
    : undefined

  const userName = userProfile?.displayName ?? undefined
  const initials = userName
    ? userName.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : 'JG'

  // Navega a una sección desde el TopBar. HOME_KEY → raíz; módulo → /:base.
  function goToKey(key: string) {
    if (key === HOME_KEY) {
      navigate('/')
      return
    }
    const mod = getModuleById(key)
    if (mod) navigate(`/${mod.basePath}`)
  }

  // Abre Configuración (engranaje).
  function openSettings() {
    navigate(`/${SETTINGS_BASE}`)
  }

  // Navega a un item del módulo activo. itemPath es relativo al basePath.
  function goToItemPath(itemPath: string) {
    if (!activeModule) return
    const suffix = itemPath === '' ? '' : `/${itemPath}`
    navigate(`/${activeModule.basePath}${suffix}`)
  }

  // Si el encargado dual ha entrado en "Ver como trabajador", renderizamos
  // TrabajadorApp en lugar del layout normal. onExitMode SOLO vuelve a gestión:
  // NO cierra sesión (eso es competencia del menú de usuario del TopBar).
  if (workerMode && userProfile?.employeeId) {
    return (
      <TrabajadorApp
        employeeId={userProfile.employeeId}
        onExitMode={() => setWorkerMode(false)}
        exitLabel="back-to-management"
      />
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg-page)' }}>
      <ShellTopBar
        activeKey={activeKey}
        onSelect={goToKey}
        onOpenSettings={openSettings}
        settingsActive={settingsActive}
        userInitials={initials}
        currentEmployeeId={userProfile?.employeeId ?? null}
        onEnterWorkerMode={userProfile?.employeeId ? () => setWorkerMode(true) : undefined}
      />

      {activeModule ? (
        <div className="flex-1 flex">
          <ModuleSidebar
            moduleName={activeModule.name}
            sidebar={activeModule.sidebar}
            activeItemId={activeItem?.id ?? ''}
            onSelectItem={(itemId) => {
              const item = activeModule.sidebar.items.find(i => i.id === itemId)
              if (item) goToItemPath(item.path)
            }}
          />
          <main className="flex-1" style={{ paddingLeft: 26, paddingRight: 26, paddingTop: 24, paddingBottom: 24 }}>
            {/* G-8.2: rutas reales del módulo. El <Routes> del Shell ve el
                pathname COMPLETO (no relativo), porque el Shell se monta fuera
                del <Routes> raíz de App.tsx. Por eso el path incluye el prefijo
                'shell/:base/'. r.path es relativo al basePath. */}
            <Routes>
              {activeModule.routes.map(r => {
                const full = `${activeModule.basePath}/${r.path ?? ''}`.replace(/\/+$/, '')
                return <Route key={r.path ?? 'index'} path={full} element={r.element} />
              })}
            </Routes>
          </main>
        </div>
      ) : (
        <main className="flex-1" style={{ paddingLeft: 26, paddingRight: 26, paddingTop: 24, paddingBottom: 24 }}>
          <HomeGeneral userName={userName} onOpenModule={goToKey} />
        </main>
      )}

      <FolvyAIBubble />
    </div>
  )
}
