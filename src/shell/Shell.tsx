// src/shell/Shell.tsx
//
// Contenedor raíz del Shell modular (Bloque G, Sprint 3).
//
// G-8.1: el Shell navega por RUTAS. La sección activa se deriva del pathname.
// G-8.6 (opción C): el Shell vive en la RAÍZ, sin prefijo /shell ni slug.
//
// R1.2 (responsive móvil): ShellBottomNav, barra inferior del 1er nivel, solo
//        en móvil (useIsMobile).
// R1.3a: en móvil, dentro de módulo, el ModuleSidebar (208px) se sustituye por
//        MobileModuleTabs (sub-pestañas del 2º nivel) y el layout pasa a vertical.
// R1.3b: Folvy AI como HÉROE central de la barra inferior. El Shell posee el
//        estado abierto/cerrado del chat (aiOpen) y se lo pasa a FolvyAIBubble
//        (controlado). En móvil esconde el launcher flotante (hideLauncher) — lo
//        abre el héroe de la barra. En escritorio NO cambia nada: la burbuja
//        sigue con su botón flotante (controlado por el mismo estado).

import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Routes, Route } from 'react-router-dom'
import ShellTopBar, { HOME_KEY } from './ShellTopBar'
import ModuleSidebar from './ModuleSidebar'
import MobileModuleTabs from './MobileModuleTabs'
import ShellBottomNav from './ShellBottomNav'
import { getModuleById, getModuleByBasePath } from './moduleRegistry'
import { configuracionModule } from '../modules/configuracion/module'
import HomeGeneral from './home/HomeGeneral'
import TrabajadorApp from '../pages/trabajador/TrabajadorApp'
import { useApp } from '../context/AppContext'
import { useIsMobile } from './useIsMobile'
import { usePlatformAdmin } from '@/platform/usePlatformAdmin'
import { listAccounts } from '@/modules/multitenancy/services/accountsService'
import type { Account } from '@/types/multitenancy'
import { FolvyAIBubble } from '../modules/folvy-ai/components/FolvyAIBubble'

const SETTINGS_BASE = 'configuracion'

export default function Shell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userProfile, accounts, activeAccount, activeAccountId, setActiveAccountId } = useApp()
  const { isPlatformAdmin } = usePlatformAdmin()

  // Lista de cuentas para el selector. Usuario normal: solo SUS cuentas (accounts
  // del contexto). Platform admin: TODAS (puede gestionar cualquier cliente).
  const [allAccounts, setAllAccounts] = useState<Account[]>([])
  useEffect(() => {
    if (!isPlatformAdmin) return
    let alive = true
    listAccounts({ includeInternal: true })
      .then(rows => { if (alive) setAllAccounts(rows) })
      .catch(() => { if (alive) setAllAccounts([]) })
    return () => { alive = false }
  }, [isPlatformAdmin])
  const selectorAccounts = isPlatformAdmin ? allAccounts : accounts

  // Cuenta activa mostrada: para platform admin sale de allAccounts (resuelve
  // aunque la cuenta no esté entre las del usuario); si no, la del contexto.
  const shownAccount = isPlatformAdmin
    ? (allAccounts.find(a => a.id === activeAccountId) ?? activeAccount)
    : activeAccount

  // Cambiar de cliente (EXCLUSIVO platform admin): fija la cuenta activa y va
  // al inicio del nuevo cliente. El AppContext recarga perfil/permisos/datos solo.
  function switchAccount(accountId: string) {
    setActiveAccountId(accountId)
    navigate('/')
  }

  // R1.2/R1.3a/R1.3b: ¿viewport móvil? (< 768px). Decide barra inferior,
  // sub-pestañas vs sidebar, paddings y modo controlado de la IA.
  const isMobile = useIsMobile()

  // R1.3b: estado del panel de Folvy AI, gobernado desde aquí para que tanto el
  // héroe de la barra (móvil) como el launcher flotante (escritorio) lo abran.
  const [aiOpen, setAiOpen] = useState(false)

  // Paddings del <main>. En móvil: laterales ajustados y abajo hueco para la
  // barra fija (56px) + safe-area. En escritorio: los de siempre (26 / 24 / 24).
  const mainPadX = isMobile ? 16 : 26
  const mainPadTop = isMobile ? 16 : 24
  const mainPaddingBottom = isMobile
    ? 'calc(56px + env(safe-area-inset-bottom) + 24px)'
    : 24

  // Modo trabajador del encargado dual (alterna Shell ↔ TrabajadorApp).
  const [workerMode, setWorkerMode] = useState(false)

  // Derivar sección activa del pathname.
  const rest = location.pathname.replace(/^\/+|\/+$/g, '')
  const segments = rest === '' ? [] : rest.split('/')
  const moduleBasePath = segments[0] ?? ''            // '' = Home
  const itemPathFromUrl = segments.slice(1).join('/') // resto = path del item

  const activeModule = moduleBasePath === ''
    ? null
    : moduleBasePath === SETTINGS_BASE
      ? configuracionModule          // módulo especial: no está en el registry
      : getModuleByBasePath(moduleBasePath)

  const settingsActive = moduleBasePath === SETTINGS_BASE
  const activeKey = (activeModule && !settingsActive) ? activeModule.id : HOME_KEY

  const activeItem = activeModule
    ? (activeModule.sidebar.items.find(i => i.path === itemPathFromUrl)
       ?? activeModule.sidebar.items[0])
    : undefined

  const userName = userProfile?.displayName ?? undefined
  const initials = userName
    ? userName.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : 'JG'

  // Navega a una sección desde el TopBar/barra inferior.
  function goToKey(key: string) {
    if (key === HOME_KEY) {
      navigate('/')
      return
    }
    const mod = getModuleById(key)
    if (mod) navigate(`/${mod.basePath}`)
  }

  function openSettings() {
    navigate(`/${SETTINGS_BASE}`)
  }

  function goToItemPath(itemPath: string) {
    if (!activeModule) return
    const suffix = itemPath === '' ? '' : `/${itemPath}`
    navigate(`/${activeModule.basePath}${suffix}`)
  }

  // Selección de item del 2º nivel (ModuleSidebar en escritorio, MobileModuleTabs
  // en móvil: misma lógica, un solo sitio).
  function handleSelectItem(itemId: string) {
    if (!activeModule) return
    const item = activeModule.sidebar.items.find(i => i.id === itemId)
    if (item) goToItemPath(item.path)
  }

  if (workerMode && userProfile?.employeeId) {
    return (
      <TrabajadorApp
        employeeId={userProfile.employeeId}
        onExitMode={() => setWorkerMode(false)}
        exitLabel="back-to-management"
      />
    )
  }

  // Rutas reales del módulo activo (una vez; reutilizadas en móvil y escritorio).
  const moduleRoutesEl = activeModule ? (
    <Routes>
      {activeModule.routes.map(r => {
        const full = `${activeModule.basePath}/${r.path ?? ''}`.replace(/\/+$/, '')
        return <Route key={r.path ?? 'index'} path={full} element={r.element} />
      })}
    </Routes>
  ) : null

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
        activeAccount={shownAccount}
        accounts={selectorAccounts}
        onSwitchAccount={isPlatformAdmin ? switchAccount : undefined}
      />

      {/* Banda "Estás gestionando: [cliente]" — EXCLUSIVO platform admin. Deja
          claro en qué cliente se está operando al saltar entre cuentas. */}
      {isPlatformAdmin && shownAccount && (
        <div
          className="flex items-center gap-2"
          style={{
            background: 'var(--color-accent-bg, #eef2f7)',
            borderBottom: '1px solid var(--color-border-default, #e5e5e5)',
            color: 'var(--color-accent, #1E3A5F)',
            fontSize: 13,
            padding: isMobile ? '6px 16px' : '7px 26px',
          }}
        >
          <span>Estás gestionando: <b>{shownAccount.name}</b></span>
        </div>
      )}
      {activeModule ? (
        isMobile ? (
          <div className="flex-1 flex flex-col">
            <MobileModuleTabs
              sidebar={activeModule.sidebar}
              activeItemId={activeItem?.id ?? ''}
              onSelectItem={handleSelectItem}
            />
            <main className="flex-1" style={{ paddingLeft: mainPadX, paddingRight: mainPadX, paddingTop: mainPadTop, paddingBottom: mainPaddingBottom }}>
              {moduleRoutesEl}
            </main>
          </div>
        ) : (
          <div className="flex-1 flex">
            <ModuleSidebar
              moduleName={activeModule.name}
              sidebar={activeModule.sidebar}
              activeItemId={activeItem?.id ?? ''}
              onSelectItem={handleSelectItem}
            />
            <main className="flex-1" style={{ paddingLeft: mainPadX, paddingRight: mainPadX, paddingTop: mainPadTop, paddingBottom: mainPaddingBottom }}>
              {moduleRoutesEl}
            </main>
          </div>
        )
      ) : (
        <main className="flex-1" style={{ paddingLeft: mainPadX, paddingRight: mainPadX, paddingTop: mainPadTop, paddingBottom: mainPaddingBottom }}>
          <HomeGeneral userName={userName} onOpenModule={goToKey} />
        </main>
      )}

      {/* R1.3b: el chat de IA, controlado por el Shell. En móvil sin launcher
          flotante (lo abre el héroe de la barra); en escritorio, su botón
          flotante de siempre, ahora gobernado por el mismo estado. */}
      <FolvyAIBubble open={aiOpen} onOpenChange={setAiOpen} hideLauncher={isMobile} module={activeModule?.id} />

      {/* R1.2/R1.3b: barra inferior solo en móvil, con la IA como héroe central. */}
      {isMobile && (
        <ShellBottomNav
          activeKey={activeKey}
          onSelect={goToKey}
          onOpenAI={() => setAiOpen(true)}
          aiActive={aiOpen}
        />
      )}
    </div>
  )
}
