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
//
// IMG-1 (pulido de imagen 01/07): el contenido de página se centra a un ANCHO
//        MÁXIMO cómodo (CONTENT_MAX_PX). En monitores anchos evita que las
//        tablas se estiren de borde a borde dejando columnas gigantes y océano
//        gris (la sensación de "pantalla vacía"). En móvil no tiene efecto
//        (el viewport es menor que el tope). Patrón de Toast/R365/Apicbase/Linear.

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, Routes, Route } from 'react-router-dom'
import ShellTopBar, { HOME_KEY, PENDIENTES_KEY } from './ShellTopBar'
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
import PendientesPage from '../modules/pendientes/PendientesPage'
import AvisoNuevaVersion from './version/AvisoNuevaVersion'
import { usePendingBoard } from '../modules/pendientes/hooks/usePendingBoard'

const SETTINGS_BASE = 'configuracion'

// IMG-1: ancho máximo del contenido de página en escritorio. Centrado con
// margin auto. En móvil/tablet estrecho no aplica (viewport < tope). Tuneable.
const CONTENT_MAX_PX = 1560

export default function Shell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userProfile, accounts, activeAccount, activeAccountId, setActiveAccountId } = useApp()
  const { isPlatformAdmin } = usePlatformAdmin()
  // ENCARGO CODE (14/08) Pendientes Fase 1, B.1 — un solo fetch aquí; el
  // contador se pasa al TopBar y decide el aterrizaje en Home. NUNCA cuenta
  // 'salud' (solo ahora+semana, ver usePendingBoard).
  const {
    actionableCount: pendingActionableCount,
    actionableFreshCount: pendingFreshCount,
    loading: pendingLoading,
  } = usePendingBoard()

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

  // Paddings del contenido. En móvil: laterales ajustados y abajo hueco para la
  // barra fija (56px) + safe-area. En escritorio: los de siempre (26 / 24 / 24).
  const mainPadX = isMobile ? 16 : 26
  const mainPadTop = isMobile ? 16 : 24
  const mainPaddingBottom = isMobile
    ? 'calc(56px + env(safe-area-inset-bottom) + 24px)'
    : 24

  // IMG-1: estilo del contenedor de contenido — centrado a ancho máximo con los
  // paddings de arriba. El <main> queda como flex-1 a ancho completo; este div
  // interior es el que se centra y se limita.
  const contentStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: CONTENT_MAX_PX,
    marginLeft: 'auto',
    marginRight: 'auto',
    paddingLeft: mainPadX,
    paddingRight: mainPadX,
    paddingTop: mainPadTop,
    paddingBottom: mainPaddingBottom,
  }

  // Modo trabajador del encargado dual (alterna Shell ↔ TrabajadorApp).
  const [workerMode, setWorkerMode] = useState(false)

  // Derivar sección activa del pathname.
  const rest = location.pathname.replace(/^\/+|\/+$/g, '')
  const segments = rest === '' ? [] : rest.split('/')
  const moduleBasePath = segments[0] ?? ''            // '' = Home
  const itemPathFromUrl = segments.slice(1).join('/') // resto = path del item

  const pendientesActive = moduleBasePath === PENDIENTES_KEY
  const activeModule = (moduleBasePath === '' || pendientesActive)
    ? null
    : moduleBasePath === SETTINGS_BASE
      ? configuracionModule          // módulo especial: no está en el registry
      : getModuleByBasePath(moduleBasePath)

  const settingsActive = moduleBasePath === SETTINGS_BASE
  const activeKey = pendientesActive
    ? PENDIENTES_KEY
    : (activeModule && !settingsActive) ? activeModule.id : HOME_KEY

  // B.1 — aterrizaje: al ENTRAR a la aplicación, si hay algo en ahora+semana,
  // /pendientes es la pantalla de aterrizaje. Si no hay nada, se entra donde se
  // entraba antes. Espera a que cargue (pendingLoading) para no redirigir en
  // falso con el contador todavía a 0.
  //
  // ── AL ENTRAR, UNA VEZ, Y NO CADA VEZ QUE SE PISA LA RAÍZ (02/09) ─────────
  // Esto redirigía en CADA llegada a '/', y pulsar «Inicio» navega justo a '/'.
  // Con 66 líneas pendientes el contador nunca baja de 0, así que la pestaña
  // Inicio rebotaba a Pendientes SIEMPRE: el dashboard llevaba todo el día sin
  // poder abrirse, y no por un permiso ni por una ruta mal puesta, sino porque
  // una regla de aterrizaje se estaba aplicando a un gesto deliberado.
  //
  // Un aterrizaje es una decisión sobre POR DÓNDE ENTRAS. En cuanto el usuario
  // pide una pantalla a propósito, la regla ha terminado su trabajo: pulsar
  // Inicio y no ir a Inicio no es una sugerencia, es la pantalla desobedeciendo.
  const aterrizajeConsumido = useRef(false)
  useEffect(() => {
    if (aterrizajeConsumido.current) return
    if (moduleBasePath !== '') return          // no se entra por la raíz: nada que decidir
    if (pendingLoading) return                 // todavía no se sabe si hay algo
    aterrizajeConsumido.current = true         // decidido: no se vuelve a decidir
    // LO RECIENTE, no el historico. Con el contador total, ocho filas viejas
    // —dos borradores de albaran de julio y seis lineas sin coste desde el
    // 16/06— mandaban a Pendientes todos los dias, para siempre. Un aviso
    // permanente deja de ser un aviso: se ve una vez y se deja de mirar, y
    // entonces el dia que aparece algo de verdad tampoco se mira.
    // La pestaña sigue contando las 18 y la pantalla sigue enseñandolas: el
    // umbral vive solo en lo que INTERRUMPE (Regla 7).
    if (pendingFreshCount > 0) {
      navigate('/pendientes', { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleBasePath, pendingLoading, pendingFreshCount])

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
      // Pulsar Inicio es un gesto deliberado: desactiva el aterrizaje aunque
      // todavía no se hubiera llegado a decidir (por ejemplo si el contador
      // seguía cargando cuando se abrió la aplicación).
      aterrizajeConsumido.current = true
      navigate('/')
      return
    }
    if (key === PENDIENTES_KEY) {
      navigate('/pendientes')
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
        pendingCount={pendingActionableCount}
      />

      {/* Banda "Estás gestionando: [cliente]" — EXCLUSIVO platform admin. Deja
          claro en qué cliente se está operando al saltar entre cuentas. Full-width
          a propósito (banner global, no contenido de página). */}
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
            <main className="flex-1 w-full min-w-0">
              <div style={contentStyle}>
                {moduleRoutesEl}
              </div>
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
            <main className="flex-1 w-full min-w-0">
              <div style={contentStyle}>
                {moduleRoutesEl}
              </div>
            </main>
          </div>
        )
      ) : pendientesActive ? (
        <main className="flex-1 w-full min-w-0">
          <div style={contentStyle}>
            <PendientesPage />
          </div>
        </main>
      ) : (
        <main className="flex-1 w-full min-w-0">
          <div style={contentStyle}>
            <HomeGeneral userName={userName} />
          </div>
        </main>
      )}

      {/* R1.3b: el chat de IA, controlado por el Shell. En móvil sin launcher
          flotante (lo abre el héroe de la barra); en escritorio, su botón
          flotante de siempre, ahora gobernado por el mismo estado. */}
      <FolvyAIBubble open={aiOpen} onOpenChange={setAiOpen} hideLauncher={isMobile} module={activeModule?.id} />

      {/* 01/09: el aviso de versión nueva. Vive en el Shell porque el problema
          no era de ninguna pantalla en concreto: la SPA pide index.html UNA vez
          y nada la obliga a volver a pedirlo, así que sin esto nadie se entera
          de un despliegue hasta que cierra la pestaña. En oficina AVISA y deja
          decidir; la recarga sola es cosa de la tablet, que no tiene a nadie
          delante (ver TabletStationRoute). */}
      <AvisoNuevaVersion />

      {/* R1.2/R1.3b: barra inferior solo en móvil, con la IA como héroe central. */}
      {isMobile && (
        <ShellBottomNav
          activeKey={activeKey}
          onSelect={goToKey}
          onOpenAI={() => setAiOpen(true)}
          aiActive={aiOpen}
          pendingCount={pendingActionableCount}
        />
      )}
    </div>
  )
}
