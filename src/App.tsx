import { useEffect, useRef, useState } from 'react'
import type { Page } from './types'
import { LogoSquare } from './components/Logo'
import Sidebar, { NAV } from './components/Sidebar'
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
import ReportsPage from './modules/appcc/pages/ReportsPage'
import TemplateEditorPage from './modules/appcc/pages/TemplateEditorPage'
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
  appcc_reports: 'APPCC: Informes',
  appcc_templates: 'APPCC: Plantillas',
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
    case 'appcc_reports':     return <ReportsPage />
    case 'appcc_templates':   return <TemplateEditorPage onBack={ctx.closeExecution} />
    case 'appcc_execution':
      if (!ctx.currentExecutionId) {
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
          // APPCC
          if ((p as unknown as Record<string, unknown>).show_appcc_today) allowed.add('appcc_today')
          if ((p as unknown as Record<string, unknown>).show_appcc_incidents) allowed.add('appcc_incidents')
          if ((p as unknown as Record<string, unknown>).show_appcc_today) allowed.add('appcc_reports')
          if ((p as unknown as Record<string, unknown>).show_appcc_today) allowed.add('appcc_templates')
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
      <div className="min-h-screen flex items-center justify-center bg-page">
        <p className="text-sm text-text-secondary">Cargando...</p>
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
      <div className="min-h-screen bg-page">
        <KioskoFichajePage />
        <button
          onClick={() => setPage('dashboard')}
          className="fixed bottom-4 left-4 text-xs text-text-secondary hover:text-text-primary"
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
    <div className="min-h-screen bg-page">
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
        <header className="h-14 border-b border-border-default bg-card/90 backdrop-blur-sm flex items-center justify-between gap-2 px-3 sm:px-5 shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            {/* Botón hamburguesa solo en móvil */}
            <button
              ref={hamburgerRef}
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menú"
              aria-expanded={mobileMenuOpen}
              className="lg:hidden p-2 -ml-2 rounded-md text-text-secondary hover:bg-page"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <h1 className="text-lg sm:text-xl font-display font-medium truncate text-text-primary">
              {showUsuariosAccesos ? 'Usuarios y Accesos' : PAGE_TITLES[page]}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {pending > 0 && !showUsuariosAccesos && (
              <span className="text-xs font-medium px-2 py-1 rounded-md bg-warning-bg text-warning border border-warning/20">
                {pending} tarea{pending > 1 ? 's' : ''}
              </span>
            )}
            {critInc > 0 && !showUsuariosAccesos && (
              <span className="text-xs font-medium px-2 py-1 rounded-md bg-danger-bg text-danger border border-danger/20 animate-pulse">
                {critInc} crítica{critInc > 1 ? 's' : ''}
              </span>
            )}
            {/* Info del usuario actual */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-accent-bg border border-border-default">
              <span>{roleIcon}</span>
              <span className="font-medium text-text-primary max-w-[120px] truncate">
                {profile.displayName || 'Usuario'}
              </span>
              <span className="text-text-secondary">·</span>
              <span className="text-text-secondary">{roleLabel}</span>
            </div>
            {/* Botón modo trabajador (solo manager con employee_id) — oculto en móvil para ahorrar espacio */}
            {canSwitchToWorker && (
              <button
                onClick={() => setForceWorkerMode(true)}
                title="Ver app de trabajador"
                className="hidden sm:inline-flex text-xs px-2 py-1 rounded-md font-medium bg-accent-bg text-text-secondary hover:bg-page hover:text-text-primary"
              >
                Modo trabajador
              </button>
            )}
            {/* Botón Usuarios y Accesos (solo admin) — oculto en móvil */}
            {profile.role === 'admin' && (
              <button
                onClick={() => setShowUsuariosAccesos(!showUsuariosAccesos)}
                title={showUsuariosAccesos ? 'Volver' : 'Usuarios y Accesos'}
                className={`hidden sm:inline-flex text-xs px-2 py-1 rounded-md font-medium transition-base ${
                  showUsuariosAccesos
                    ? 'bg-accent text-text-on-accent'
                    : 'bg-accent-bg text-text-secondary hover:bg-page hover:text-text-primary'
                }`}
              >
                {showUsuariosAccesos ? '← Volver' : 'Usuarios'}
              </button>
            )}
            <button
              onClick={onSignOut}
              title={`Cerrar sesión (${profile.displayName || profile.role})`}
              className="hover:opacity-80 transition-base shrink-0"
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
      <div className="min-h-screen flex items-center justify-center bg-page">
        <div className="text-center">
          <p className="text-2xl font-display font-medium mb-2 text-accent">
            Foodint
          </p>
          <p className="text-sm text-text-secondary">Cargando...</p>
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
