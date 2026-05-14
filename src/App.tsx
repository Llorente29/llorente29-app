import { useEffect, useRef, useState } from 'react'
import type { Page } from './types'
import { LogoSquare } from './components/Logo'
import StaffPage from './pages/StaffPage'
import FichajesGlobalPage from './pages/FichajesGlobalPage'
import InformesPage from './pages/InformesPage'
import CalendarioPage from './pages/CalendarioPage'
import PlantillaTurnosPage from './pages/PlantillaTurnosPage'
import VentasAnalisisPage from './pages/VentasAnalisisPage'
import PrediccionPersonalPage from './pages/PrediccionPersonalPage'
import ZonasPedidoPage from './pages/ZonasPedidoPage'
import KioskoFichajePage from './pages/KioskoFichajePage'
import SolicitudesPendientesPage from './pages/SolicitudesPendientesPage'
import AhoraMismoPage from './pages/AhoraMismoPage'
import AvisosSettingsPage from './pages/AvisosSettingsPage'
import TurnosAbiertosPage from './pages/TurnosAbiertosPage'
import BolsaHorasPage from './pages/BolsaHorasPage'
import CambiosPendientesPage from './pages/CambiosPendientesPage'
import TrabajadorApp from './pages/trabajador/TrabajadorApp'
import LoginPage from './pages/LoginPage'
import UsuariosAccesosPage from './pages/UsuariosAccesosPage'
import TodayPage from './modules/appcc/pages/TodayPage'
import ExecutionPage from './modules/appcc/pages/ExecutionPage'
import IncidentsPage from './modules/appcc/pages/IncidentsPage'
import OnboardingPage from './modules/appcc/pages/OnboardingPage'
import {
  getCurrentProfile,
  signOut,
  onAuthStateChange,
  isManagerOrAdmin,
  isWorker,
} from './services/authService'
import type { UserProfile } from './services/authService'
import {
  DashboardPage, LocationsPage
} from './pages/OtherPages'
import { gate } from '@/platform/feature-gate/featureGateService'

type AppMode = 'gestor' | 'trabajador' | 'unset'

// Items del menú lateral. `roleRequired` opcional: si está, solo se muestra
// a usuarios con ese rol. Ahora mismo lo usamos para 'admin' (configuración APPCC).
const NAV: { id: Page; label: string; icon: string; section?: string; roleRequired?: 'admin' }[] = [
  { id: 'dashboard',              label: 'Dashboard',           icon: '⊞' },
  { id: 'staff',                  label: 'Personal',            icon: '👤', section: 'Personal' },
  { id: 'ahora_mismo',            label: 'Ahora mismo',         icon: '🟢' },
  { id: 'fichajes_global',        label: 'Control Horario',     icon: '⏰' },
  { id: 'kiosko_fichaje',         label: 'Kiosko Fichaje',      icon: '🕐' },
  { id: 'solicitudes_pendientes', label: 'Solicitudes',         icon: '📨' },
  { id: 'turnos_abiertos',        label: 'Turnos abiertos',     icon: '🪑' },
  { id: 'cambios_pendientes',     label: 'Cambios de turno',    icon: '🔄' },
  { id: 'calendario',             label: 'Calendario',          icon: '📅' },
  { id: 'plantilla_turnos',       label: 'Plantilla turnos',    icon: '🗂️' },
  { id: 'informes_personal',      label: 'Informes Gestoría',   icon: '📄' },
  { id: 'bolsa_horas',            label: 'Bolsa de horas',      icon: '💰' },
  { id: 'ventas_analisis',        label: 'Análisis de Ventas',  icon: '📊', section: 'Ventas' },
  { id: 'prediccion_personal',    label: 'Predicción Personal', icon: '🔮' },
  { id: 'zonas_pedido',           label: 'Zonas de Pedido',     icon: '🛵' },
  { id: 'appcc_today',            label: 'APPCC: Hoy',          icon: '🍃', section: 'APPCC' },
  { id: 'appcc_incidents',        label: 'APPCC: Incidencias',  icon: '⚠️' },
  { id: 'appcc_onboarding',       label: 'APPCC: Configurar',   icon: '⚙️', roleRequired: 'admin' },
  { id: 'locations',              label: 'Locales',             icon: '📍', section: 'Configuración' },
  { id: 'avisos_settings',        label: 'Avisos',              icon: '🔔' },
]

const PAGE_TITLES: Partial<Record<Page, string>> = {
  dashboard: 'Dashboard',
  staff: 'Personal',
  fichajes_global: 'Control Horario',
  kiosko_fichaje: 'Kiosko Fichaje',
  solicitudes_pendientes: 'Solicitudes pendientes',
  ahora_mismo: 'Ahora mismo',
  turnos_abiertos: 'Turnos abiertos',
  cambios_pendientes: 'Cambios de turno',
  calendario: 'Calendario de Horarios',
  plantilla_turnos: 'Plantilla de turnos',
  informes_personal: 'Informes Gestoría',
  bolsa_horas: 'Bolsa de horas',
  ventas_analisis: 'Análisis de Ventas',
  prediccion_personal: 'Predicción de Personal',
  zonas_pedido: 'Zonas de Pedido',
  locations: 'Locales',
  avisos_settings: 'Configuración de Avisos',
  appcc_today: 'APPCC: Checklists de hoy',
  appcc_execution: 'APPCC: Ejecutar checklist',
  appcc_incidents: 'APPCC: Incidencias',
  appcc_onboarding: 'APPCC: Configurar',
}

interface RenderPageContext {
  currentExecutionId: string | null
  openExecution: (id: string) => void
  closeExecution: () => void
  currentOnboardingLocationId: string | null
  openOnboarding: (locationId?: string | null) => void
  closeOnboarding: (result: { saved: boolean; locationId: string | null }) => void
}

function renderPage(page: Page, ctx: RenderPageContext) {
  switch (page) {
    case 'dashboard':         return <DashboardPage />
    case 'staff':             return <StaffPage />
    case 'fichajes_global':   return <FichajesGlobalPage />
    case 'kiosko_fichaje':    return <KioskoFichajePage />
    case 'solicitudes_pendientes': return <SolicitudesPendientesPage />
    case 'ahora_mismo':       return <AhoraMismoPage />
    case 'turnos_abiertos':   return <TurnosAbiertosPage />
    case 'cambios_pendientes': return <CambiosPendientesPage />
    case 'calendario':        return <CalendarioPage />
    case 'plantilla_turnos':  return <PlantillaTurnosPage />
    case 'informes_personal': return <InformesPage />
    case 'bolsa_horas':       return <BolsaHorasPage />
    case 'ventas_analisis':   return <VentasAnalisisPage />
    case 'prediccion_personal': return <PrediccionPersonalPage />
    case 'zonas_pedido':      return <ZonasPedidoPage />
    case 'locations':         return <LocationsPage />
    case 'avisos_settings':   return <AvisosSettingsPage />
    case 'appcc_today':       return <TodayPage onOpenExecution={ctx.openExecution} />
    case 'appcc_incidents':   return <IncidentsPage />
    case 'appcc_execution':
      if (!ctx.currentExecutionId) {
        // Sin id, no podemos renderizar. Volvemos a Hoy.
        ctx.closeExecution()
        return <TodayPage onOpenExecution={ctx.openExecution} />
      }
      return <ExecutionPage executionId={ctx.currentExecutionId} onBack={ctx.closeExecution} />
    case 'appcc_onboarding':
      return (
        <OnboardingPage
          initialLocationId={ctx.currentOnboardingLocationId}
          onFinish={ctx.closeOnboarding}
        />
      )
    default:                  return <DashboardPage />
  }
}

/* =====================================================
   SIDEBAR — desktop fijo / móvil drawer
   ===================================================== */

function Sidebar({
  page, setPage, collapsed, setCollapsed, visiblePageIds,
  isMobile, mobileOpen, onCloseMobile,
}: {
  page: Page
  setPage: (p: Page) => void
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  visiblePageIds: Set<Page>
  isMobile: boolean
  mobileOpen: boolean
  onCloseMobile: () => void
}) {
  // Tasks e incidents del antiguo módulo Operaciones se reactivarán cuando exista el nuevo módulo APPCC.
  const pendingTasks = 0
  const openInc = 0
  const [pendingVacations, setPendingVacations] = useState(0)
  const [pendingSwaps, setPendingSwaps] = useState(0)

  // NAV filtrado según permisos del usuario
  const visibleNav = NAV.filter(item => visiblePageIds.has(item.id))

  // Cargar conteo de vacaciones pendientes
  useEffect(() => {
    let cancel = false
    async function load() {
      try {
        const mod = await import('./services/vacationsService')
        const list = await mod.fetchPendingVacations()
        if (!cancel) setPendingVacations((list || []).length)
      } catch { /* ignore */ }
    }
    load()
    const id = setInterval(load, 30000) // refrescar cada 30s
    return () => { cancel = true; clearInterval(id) }
  }, [])

  // Cargar conteo de cambios de turno pendientes
  useEffect(() => {
    let cancel = false
    async function load() {
      try {
        const mod = await import('./services/shiftSwapService')
        const list = await mod.listPendingForManager()
        if (!cancel) setPendingSwaps((list || []).length)
      } catch { /* ignore */ }
    }
    load()
    const id = setInterval(load, 30000)
    return () => { cancel = true; clearInterval(id) }
  }, [])

  const badge = (id: Page) =>
    id === 'solicitudes_pendientes' ? pendingVacations
    : id === 'cambios_pendientes' ? pendingSwaps
    : 0

  // Variables usadas más adelante en el módulo APPCC (declaradas aquí solo para evitar warning)
  void pendingTasks; void openInc

  // Cuando pulsamos un item en móvil, cerramos el drawer
  function handleSelect(p: Page) {
    setPage(p)
    if (isMobile) onCloseMobile()
  }

  // ====== Cálculo de clases del aside ======
  // En desktop: fijo, ancho según collapsed (64px / 224px)
  // En móvil: drawer 280px que entra desde la izquierda, controlado por mobileOpen
  const widthClass = collapsed && !isMobile ? 'w-[64px]' : 'w-[280px] lg:w-56'

  const translateClass = isMobile
    ? (mobileOpen ? 'translate-x-0' : '-translate-x-full')
    : 'translate-x-0'

  // ARIA: solo marcar aria-hidden cuando está cerrado Y no es desktop
  // (en desktop el sidebar siempre es visible y accesible)
  const ariaHidden = isMobile && !mobileOpen

  // INERT: bloquea totalmente la interacción y el foco dentro del aside
  // cuando está oculto. Evita el warning "Blocked aria-hidden because
  // descendant retained focus".
  const inert = ariaHidden ? true : undefined

  return (
    <aside
      // @ts-expect-error - 'inert' es una prop de HTML estándar pero el tipado de React puede no incluirla en versiones antiguas
      inert={inert}
      className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-white border-r border-gray-200 transition-transform duration-200 ease-out ${widthClass} ${translateClass}`}
      aria-hidden={ariaHidden}
    >
      <div className={`h-14 flex items-center border-b gap-3 shrink-0 ${collapsed && !isMobile ? 'px-3.5' : 'px-4'}`}>
        <LogoSquare size={32} />
        {(!collapsed || isMobile) && (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold tracking-tight truncate">Foodint</p>
            <p className="text-[10px] text-gray-400 truncate">App del equipo</p>
          </div>
        )}
        {/* Botón cerrar drawer solo en móvil */}
        {isMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Cerrar menú"
            className="ml-auto p-2 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <span className="text-lg leading-none">✕</span>
          </button>
        )}
      </div>

      <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
        {visibleNav.map((item, idx) => {
          const isActive = page === item.id
          const showSection = item.section && (idx === 0 || visibleNav[idx - 1].section !== item.section)
          const b = badge(item.id)
          const showLabel = !collapsed || isMobile
          return (
            <div key={item.id}>
              {showSection && showLabel && (
                <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest px-2 pt-3 pb-1">{item.section}</p>
              )}
              {showSection && !showLabel && <div className="border-t border-gray-100 my-1.5 mx-1" />}
              <button
                title={!showLabel ? item.label : undefined}
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive ? 'bg-[#F5E9D9] text-[#7C1A1A]' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <span className="relative shrink-0 text-base leading-none">
                  {item.icon}
                  {b > 0 && (
                    <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">{b}</span>
                  )}
                </span>
                {showLabel && <span className="truncate text-sm">{item.label}</span>}
              </button>
            </div>
          )
        })}
      </nav>

      {/* Botón contraer solo en desktop */}
      {!isMobile && (
        <div className="p-2 border-t">
          <button onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-xs text-gray-400 hover:bg-gray-100">
            <span className="text-sm">{collapsed ? '→' : '←'}</span>
            {!collapsed && <span>Contraer</span>}
          </button>
        </div>
      )}
    </aside>
  )
}

function AuthenticatedApp({ profile, onSignOut }: {
  profile: UserProfile
  onSignOut: () => void | Promise<void>
}) {
  const [page, setPage] = useState<Page>('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mode, setMode] = useState<AppMode>('unset')
  const [showUsuariosAccesos, setShowUsuariosAccesos] = useState(false)
  const [forceWorkerMode, setForceWorkerMode] = useState(false)
  const [perms, setPerms] = useState<Set<Page> | null>(null)
  // Para navegación a la página de ejecución de un checklist APPCC
  const [currentExecutionId, setCurrentExecutionId] = useState<string | null>(null)
  // Para el wizard de onboarding APPCC
  const [currentOnboardingLocationId, setCurrentOnboardingLocationId] = useState<string | null>(null)
  // Tasks e incidents del antiguo módulo Operaciones — se reactivarán con módulo APPCC
  const pending = 0
  const critInc = 0

  // Ref al botón hamburguesa, para devolver el foco ahí al cerrar el drawer
  // (evita el warning "aria-hidden Blocked because descendant retained focus")
  const hamburgerRef = useRef<HTMLButtonElement | null>(null)

  // Detectar si estamos en móvil/tablet (<1024px) — coincide con breakpoint lg de Tailwind
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false
  )
  useEffect(() => {
    function onResize() {
      const mobile = window.innerWidth < 1024
      setIsMobile(mobile)
      // Si pasamos de móvil a desktop, cerramos el drawer por limpieza
      if (!mobile) setMobileMenuOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Bloquear scroll del body mientras el drawer móvil esté abierto
  useEffect(() => {
    if (mobileMenuOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [mobileMenuOpen])

  /**
   * Cierra el drawer móvil. Antes de aplicar aria-hidden al aside, devuelve
   * el foco al botón hamburguesa.
   */
  function handleCloseMobileMenu() {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    if (hamburgerRef.current) {
      hamburgerRef.current.focus()
    }
    setMobileMenuOpen(false)
  }

  // Determinar el modo automáticamente según el rol
  useEffect(() => {
    if (isWorker(profile)) {
      setMode('trabajador')
    } else if (isManagerOrAdmin(profile)) {
      setMode('gestor')
    }
  }, [profile])

  // Cargar permisos del usuario según su rol
  useEffect(() => {
    async function loadPerms() {
      // Admin: ve todo (incluyendo entradas con roleRequired)
      if (profile.role === 'admin') {
        setPerms(new Set(NAV.map(n => n.id)))
        return
      }
      // Manager: cargar permisos individuales de manager_permissions
      // OJO: items con roleRequired='admin' nunca se añaden al set, así que
      // los managers no los verán aunque tengan permisos amplios.
      if (profile.role === 'manager') {
        try {
          const mod = await import('./services/managerPermissionsService')
          const p = await mod.getManagerPermissions(profile.id)
          const allowed = new Set<Page>()
          if (p.show_dashboard) allowed.add('dashboard')
          if (p.show_staff) allowed.add('staff')
          if (p.show_ahora_mismo) allowed.add('ahora_mismo')
          if (p.show_fichajes_global) allowed.add('fichajes_global')
          if (p.show_kiosko_fichaje) allowed.add('kiosko_fichaje')
          if (p.show_solicitudes_pendientes) allowed.add('solicitudes_pendientes')
          if (p.show_turnos_abiertos) allowed.add('turnos_abiertos')
          if (p.show_cambios_pendientes) allowed.add('cambios_pendientes')
          if (p.show_calendario) allowed.add('calendario')
          if (p.show_plantilla_turnos) allowed.add('plantilla_turnos')
          if (p.show_informes_personal) allowed.add('informes_personal')
          if (p.show_bolsa_horas) allowed.add('bolsa_horas')
          if (p.show_ventas_analisis) allowed.add('ventas_analisis')
          if (p.show_prediccion_personal) allowed.add('prediccion_personal')
          if (p.show_zonas_pedido) allowed.add('zonas_pedido')
          if (p.show_locations) allowed.add('locations')
          // avisos_settings se mantiene visible si el manager tiene el flag antiguo show_tspoon_settings
          // (compatibilidad temporal hasta que se renombre la columna en Sprint 1)
          if (p.show_tspoon_settings) allowed.add('avisos_settings')
          // Nota: appcc_today, appcc_incidents y appcc_onboarding NO están
          // todavía en manager_permissions, así que los managers no los ven.
          // Apuntar como TODO para Sprint 3.
          setPerms(allowed)
        } catch (e) {
          console.error('[perms] load:', e)
          setPerms(new Set())
        }
      }
    }
    loadPerms()
  }, [profile])

  // Modo no definido — esperando carga de rol
  if (mode === 'unset') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9]">
        <p className="text-sm text-gray-500">Cargando...</p>
      </div>
    )
  }

  // Modo trabajador — UI específica del empleado
  if (mode === 'trabajador' || forceWorkerMode) {
    return (
      <TrabajadorApp
        employeeId={profile.employeeId}
        onExitMode={forceWorkerMode ? () => setForceWorkerMode(false) : onSignOut}
      />
    )
  }

  // Auto-redirigir a primera página permitida si la actual no lo está
  // (excepciones: appcc_execution y appcc_onboarding se permiten si el usuario
  // llegó vía TodayPage o vía un callback interno)
  if (
    perms && !perms.has(page) && perms.size > 0
    && page !== 'appcc_execution'
    && page !== 'appcc_onboarding'
  ) {
    const firstAllowed = NAV.find(n => perms.has(n.id))?.id || 'dashboard'
    if (firstAllowed !== page) {
      setTimeout(() => setPage(firstAllowed), 0)
    }
  }

  // En el kiosko ocultamos sidebar y header — pantalla completa
  const isKiosko = page === 'kiosko_fichaje'

  if (isKiosko) {
    return (
      <div className="min-h-screen bg-gray-50">
        <KioskoFichajePage />
        <button
          onClick={() => setPage('dashboard')}
          className="fixed bottom-4 left-4 text-xs text-gray-300 hover:text-gray-500"
          title="Salir del kiosko"
        >
          ← salir
        </button>
      </div>
    )
  }

  // Calcular visiblePageIds para Sidebar
  const visiblePageIds = perms || new Set<Page>(NAV.map(n => n.id))
  const canSwitchToWorker = profile.role === 'manager' && !!profile.employeeId
  const roleLabel = profile.role === 'admin' ? 'Admin' : profile.role === 'manager' ? 'Encargado' : 'Trabajador'
  const roleIcon = profile.role === 'admin' ? '👑' : profile.role === 'manager' ? '👔' : '👷'

  // Callbacks de navegación APPCC
  const renderCtx: RenderPageContext = {
    currentExecutionId,
    openExecution: (id: string) => {
      setCurrentExecutionId(id)
      setPage('appcc_execution')
    },
    closeExecution: () => {
      setCurrentExecutionId(null)
      setPage('appcc_today')
    },
    currentOnboardingLocationId,
    openOnboarding: (locationId?: string | null) => {
      setCurrentOnboardingLocationId(locationId ?? null)
      setPage('appcc_onboarding')
    },
    closeOnboarding: (result) => {
      setCurrentOnboardingLocationId(null)
      // Si guardó, llevarlo a Hoy del local configurado.
      // Si canceló, volverlo a la página anterior (o Hoy por defecto).
      setPage('appcc_today')
      void result // se usa por TodayPage para refrescar cuando recibe el callback
    },
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar — siempre en el DOM. En desktop fijo, en móvil drawer controlado por mobileMenuOpen */}
      <Sidebar
        page={page}
        setPage={setPage}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        visiblePageIds={visiblePageIds}
        isMobile={isMobile}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={handleCloseMobileMenu}
      />

      {/* Overlay oscuro detrás del drawer en móvil */}
      {isMobile && mobileMenuOpen && (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={handleCloseMobileMenu}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      <div className={`transition-all duration-200 ${collapsed ? 'lg:ml-[64px]' : 'lg:ml-56'}`}>
        <header className="h-14 border-b border-gray-200 bg-white/90 backdrop-blur-sm flex items-center justify-between gap-2 px-3 sm:px-5 shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            {/* Botón hamburguesa solo en móvil */}
            <button
              ref={hamburgerRef}
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menú"
              aria-expanded={mobileMenuOpen}
              className="lg:hidden p-2 -ml-2 rounded-md text-gray-600 hover:bg-gray-100"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <h1 className="text-base sm:text-lg font-semibold truncate" style={{ fontFamily: 'Instrument Serif, serif' }}>
              {showUsuariosAccesos ? '👥 Usuarios y Accesos' : PAGE_TITLES[page]}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {pending > 0 && !showUsuariosAccesos && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                {pending} tarea{pending > 1 ? 's' : ''}
              </span>
            )}
            {critInc > 0 && !showUsuariosAccesos && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200 animate-pulse">
                ⚠️ {critInc} crítica{critInc > 1 ? 's' : ''}
              </span>
            )}
            {/* Info del usuario actual */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-gray-50 border border-gray-200">
              <span>{roleIcon}</span>
              <span className="font-medium text-gray-700 max-w-[120px] truncate">
                {profile.displayName || 'Usuario'}
              </span>
              <span className="text-gray-400">·</span>
              <span className="text-gray-500">{roleLabel}</span>
            </div>
            {/* Botón modo trabajador (solo manager con employee_id) — oculto en móvil para ahorrar espacio */}
            {canSwitchToWorker && (
              <button
                onClick={() => setForceWorkerMode(true)}
                title="Ver app de trabajador"
                className="hidden sm:inline-flex text-xs px-2 py-1 rounded-md font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
              >
                👤 Modo trabajador
              </button>
            )}
            {/* Botón Usuarios y Accesos (solo admin) — oculto en móvil */}
            {profile.role === 'admin' && (
              <button
                onClick={() => setShowUsuariosAccesos(!showUsuariosAccesos)}
                title={showUsuariosAccesos ? 'Volver' : 'Usuarios y Accesos'}
                className={`hidden sm:inline-flex text-xs px-2 py-1 rounded-md font-medium transition ${
                  showUsuariosAccesos
                    ? 'bg-[#7C1A1A] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {showUsuariosAccesos ? '← Volver' : '👥 Usuarios'}
              </button>
            )}
            <button
              onClick={onSignOut}
              title={`Cerrar sesión (${profile.displayName || profile.role})`}
              className="hover:opacity-80 transition-opacity shrink-0"
            >
              <LogoSquare size={28} />
            </button>
          </div>
        </header>
        <main className="p-4 sm:p-6">
          {showUsuariosAccesos ? <UsuariosAccesosPage /> : renderPage(page, renderCtx)}
        </main>
      </div>
    </div>
  )
}

/* =====================================================
   APP RAÍZ CON AUTH
   ===================================================== */

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  // Cargar perfil al arrancar y suscribirse a cambios de auth
  useEffect(() => {
    let cancel = false

    async function loadProfile() {
      setLoading(true)
      const p = await getCurrentProfile()
      if (!cancel) {
        setProfile(p)
        setLoading(false)

        // Cargar feature flags de la plataforma para esta cuenta
        // (necesario para que el resto de componentes sepa qué puede mostrar)
        if (p) {
          const state = await gate.load()
          if (state) {
            console.log('[platform] Cuenta cargada:', state.account.name,
              `| ${state.flags.size} feature flags activos`)
          }
        } else {
          gate.clear()
        }
      }
    }

    // Carga inicial
    loadProfile()

    // Suscribirse a cambios de auth (login, logout, token refresh)
    const unsub = onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        loadProfile()
      }
    })

    return () => {
      cancel = true
      unsub()
    }
  }, [])

  async function handleSignOut() {
    await signOut()
    gate.clear()      // limpiar feature flags al cerrar sesión
    setProfile(null)
  }

  // Loading inicial
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9]">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ fontFamily: 'Instrument Serif, serif', color: '#7C1A1A' }}>
            Foodint
          </p>
          <p className="text-sm text-gray-500">Cargando...</p>
        </div>
      </div>
    )
  }

  // Sin sesión o sin perfil → mostrar Login
  if (!profile) {
    return <LoginPage onCheckSession={() => window.location.reload()} />
  }

  // Sesión válida → renderizar app autenticada
  return <AuthenticatedApp profile={profile} onSignOut={handleSignOut} />
}
