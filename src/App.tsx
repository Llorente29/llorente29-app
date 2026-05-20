import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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
import AuthRouter from './auth/AuthRouter'
import WelcomePage from './pages/WelcomePage'
import ResetPasswordConfirmPage from './pages/ResetPasswordConfirmPage'
import UsuariosAccesosPage from './pages/UsuariosAccesosPage'
import TodayPage from './modules/appcc/pages/TodayPage'
import ExecutionPage from './modules/appcc/pages/ExecutionPage'
import IncidentsPage from './modules/appcc/pages/IncidentsPage'
import OnboardingPage from './modules/appcc/pages/OnboardingPage'
import ReportsPage from './modules/appcc/pages/ReportsPage'
import TemplateEditorPage from './modules/appcc/pages/TemplateEditorPage'
import AppccDashboardPage from './modules/appcc/pages/AppccDashboardPage'
import AuditsPage from './modules/appcc/audits/AuditsPage'
import AuditExecutionPage from './modules/appcc/audits/AuditExecutionPage'
import AuditTemplateEditorPage from './modules/appcc/audits/AuditTemplateEditorPage'
import LocationSelector from './modules/multitenancy/components/LocationSelector'
import BrandFilterSelector from './modules/multitenancy/components/BrandFilterSelector'
import AccountSelector from './modules/multitenancy/components/AccountSelector'
import BrandsPage from './modules/multitenancy/pages/BrandsPage'
import { useActiveAccount } from './modules/multitenancy/hooks/useActiveAccount'
import { usePermissions } from './modules/multitenancy/hooks/usePermissions'
import { useApp } from './context/AppContext'
import { signOut } from './services/authService'
import { pageToPath, pageToRoute, parseRoute, pathToPage, isPublicAuthRoute } from './routes'
import type { UserProfile } from './types/multitenancy'
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
  brands: 'Marcas',
  appcc_today: 'APPCC: Checklists de hoy',
  appcc_execution: 'APPCC: Ejecutar checklist',
  appcc_incidents: 'APPCC: Incidencias',
  appcc_onboarding: 'APPCC: Configurar',
  appcc_reports: 'APPCC: Informes',
  appcc_templates: 'APPCC: Plantillas',
  appcc_dashboard: 'APPCC: Dashboard',
  appcc_audits: 'APPCC: Auditorías',
  appcc_audit_execution: 'APPCC: Ejecutar auditoría',
  appcc_audit_templates: 'APPCC: Plantillas de auditoría',
}

// Mapeo Page → componente para registrar las rutas en <Routes>.
// Bloque C Fases 2-3 (17/05/2026). Las páginas con :param leen el id con
// useParams; no se les pasa por prop.
// type Page tiene 39 valores; solo ~26 tienen componente activo (el resto
// es legacy del prototipo). Los entries no listados caen al fallback.
const PAGE_COMPONENTS: Partial<Record<Page, () => ReactElement>> = {
  dashboard:              () => <DashboardPage />,
  staff:                  () => <StaffPage />,
  fichajes_global:        () => <FichajesGlobalPage />,
  kiosko_fichaje:         () => <KioskoFichajePage />,
  solicitudes_pendientes: () => <SolicitudesPendientesPage />,
  ahora_mismo:            () => <AhoraMismoPage />,
  turnos_abiertos:        () => <TurnosAbiertosPage />,
  cambios_pendientes:     () => <CambiosPendientesPage />,
  calendario:             () => <CalendarioPage />,
  plantilla_turnos:       () => <PlantillaTurnosPage />,
  informes_personal:      () => <InformesPage />,
  bolsa_horas:            () => <BolsaHorasPage />,
  ventas_analisis:        () => <VentasAnalisisPage />,
  prediccion_personal:    () => <PrediccionPersonalPage />,
  zonas_pedido:           () => <ZonasPedidoPage />,
  locations:              () => <LocationsPage />,
  avisos_settings:        () => <AvisosSettingsPage />,
  brands:                 () => <BrandsPage />,
  appcc_dashboard:        () => <AppccDashboardPage />,
  appcc_today:            () => <TodayPage />,
  appcc_audits:           () => <AuditsPage />,
  appcc_audit_templates:  () => <AuditTemplateEditorPage />,
  appcc_audit_execution:  () => <AuditExecutionPage />,
  appcc_incidents:        () => <IncidentsPage />,
  appcc_reports:          () => <ReportsPage />,
  appcc_templates:        () => <TemplateEditorPage />,
  appcc_execution:        () => <ExecutionPage />,
  appcc_onboarding:       () => <OnboardingPage />,
}

function AuthenticatedApp({ profile, onSignOut }: {
  profile: UserProfile
  onSignOut: () => void | Promise<void>
}) {
  // Bloque C Fases 2-3 (17/05/2026): page deriva de la URL. Cada página
  // hija usa useParams/useSearchParams para leer sus parámetros.
  const location = useLocation()
  const navigate = useNavigate()
  const { rest } = parseRoute(location.pathname)
  const page: Page = pathToPage(rest)

  // Slug de cuenta activa, necesario para construir rutas en redirects.
  const { activeAccount } = useActiveAccount()
  const slug = activeAccount?.slug ?? 'foodint'

  const [collapsed, setCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mode, setMode] = useState<AppMode>('unset')
  const [showUsuariosAccesos, setShowUsuariosAccesos] = useState(false)
  const [forceWorkerMode, setForceWorkerMode] = useState(false)
  // Bloque B-7 (16/05/2026): perms derivado con useMemo de (profile,
  // permissions del context). Ver bloque más abajo.
  // Tasks/incidents del antiguo módulo Operaciones — se reactivarán con APPCC.
  const pending = 0
  const critInc = 0

  // Ref al botón hamburguesa, para devolver el foco ahí al cerrar el drawer
  // (evita warning "aria-hidden Blocked because descendant retained focus")
  const hamburgerRef = useRef<HTMLButtonElement | null>(null)

  // Detectar móvil/tablet (<1024px) — breakpoint lg de Tailwind
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

  // Modo automático según rol.
  // Bloque F-completo (17/05/2026): inlined isWorker / isManagerOrAdmin
  // tras borrar los helpers de authService. Lógica trivial, solo se usa aquí.
  useEffect(() => {
    if (profile.active && profile.role === 'worker') {
      setMode('trabajador')
    } else if (profile.active && (profile.role === 'admin' || profile.role === 'manager')) {
      setMode('gestor')
    }
  }, [profile])

  // Bloque B-7 (16/05/2026): permisos derivados del context.
  // useMemo sobre `permissions` (ya en AppContext) + isFullAccess del hook
  // (admin global o admin de cuenta bypasea). Reactivo: si admin edita
  // permisos en otra pestaña, al refrescar AppContext este useMemo se
  // recalcula automáticamente.
  //
  // Detalle legacy preservado (NO bug del refactor): 6 de 7 toggles APPCC
  // dependen de `showAppccToday`; solo `appcc_incidents` depende de
  // `showAppccIncidents`. Deuda menor, se revisará en sesión APPCC dedicada.
  const { permissions, isFullAccess } = usePermissions()

  const perms = useMemo<Set<Page> | null>(() => {
    // Admin (global o de cuenta) ve todo.
    if (profile.role === 'admin' || isFullAccess) {
      return new Set(NAV.map(n => n.id))
    }
    // Worker: no aplica este Set (worker tiene su propia UI).
    if (profile.role !== 'manager') {
      return null
    }
    // Manager sin permissions cargados aún → Set vacío (no rompe auto-redirect).
    if (!permissions) {
      return new Set<Page>()
    }
    // Manager con permissions: construir el Set declarativamente.
    const allowed = new Set<Page>()
    if (permissions.showDashboard) allowed.add('dashboard')
    if (permissions.showStaff) allowed.add('staff')
    if (permissions.showAhoraMismo) allowed.add('ahora_mismo')
    if (permissions.showFichajesGlobal) allowed.add('fichajes_global')
    if (permissions.showKioskoFichaje) allowed.add('kiosko_fichaje')
    if (permissions.showSolicitudesPendientes) allowed.add('solicitudes_pendientes')
    if (permissions.showTurnosAbiertos) allowed.add('turnos_abiertos')
    if (permissions.showCambiosPendientes) allowed.add('cambios_pendientes')
    if (permissions.showCalendario) allowed.add('calendario')
    if (permissions.showPlantillaTurnos) allowed.add('plantilla_turnos')
    if (permissions.showInformesPersonal) allowed.add('informes_personal')
    if (permissions.showBolsaHoras) allowed.add('bolsa_horas')
    if (permissions.showVentasAnalisis) allowed.add('ventas_analisis')
    if (permissions.showPrediccionPersonal) allowed.add('prediccion_personal')
    if (permissions.showZonasPedido) allowed.add('zonas_pedido')
    if (permissions.showLocations) allowed.add('locations')
    // avisos_settings: visible si el manager tiene showTspoonSettings
    // (compatibilidad temporal hasta renombrar columna).
    if (permissions.showTspoonSettings) allowed.add('avisos_settings')
    // APPCC — comportamiento legacy preservado (deuda apuntada arriba).
    if (permissions.showAppccToday) allowed.add('appcc_dashboard')
    if (permissions.showAppccToday) allowed.add('appcc_today')
    if (permissions.showAppccToday) allowed.add('appcc_audits')
    if (permissions.showAppccToday) allowed.add('appcc_audit_templates')
    if (permissions.showAppccIncidents) allowed.add('appcc_incidents')
    if (permissions.showAppccToday) allowed.add('appcc_reports')
    if (permissions.showAppccToday) allowed.add('appcc_templates')
    return allowed
  }, [profile, permissions, isFullAccess])

  // Bloque C Fases 2-3 (17/05/2026): redirect inicial si la URL es solo
  // /{slug} sin página (rest vacío). Navegamos a dashboard con replace
  // para no romper el botón atrás.
  useEffect(() => {
    if (mode !== 'gestor') return
    if (forceWorkerMode) return
    if (rest === '') {
      navigate(pageToRoute('dashboard', slug), { replace: true })
    }
  }, [mode, forceWorkerMode, rest, slug, navigate])

  // Bloque C Fases 2-3 (17/05/2026): redirect por permisos. Si la URL
  // actual apunta a una página no permitida, redirigir a la primera
  // permitida. Excepciones: appcc_execution, appcc_audit_execution y
  // appcc_onboarding (pueden llegar vía links internos).
  useEffect(() => {
    if (mode !== 'gestor') return
    if (forceWorkerMode) return
    if (!perms || perms.size === 0) return
    if (perms.has(page)) return
    if (page === 'appcc_execution') return
    if (page === 'appcc_audit_execution') return
    if (page === 'appcc_onboarding') return
    const firstAllowed = NAV.find(n => perms.has(n.id))?.id || 'dashboard'
    if (firstAllowed !== page) {
      navigate(pageToRoute(firstAllowed, slug), { replace: true })
    }
  }, [mode, forceWorkerMode, perms, page, slug, navigate])

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
        employeeId={profile.employeeId ?? undefined}
        onExitMode={forceWorkerMode ? () => setForceWorkerMode(false) : onSignOut}
      />
    )
  }

  // Kiosko: ocultamos sidebar y header — pantalla completa.
  // Bloque C Fases 2-3 (17/05/2026): detección por page derivado de URL.
  // Salir del kiosko navega a dashboard.
  const isKiosko = page === 'kiosko_fichaje'
  if (isKiosko) {
    return (
      <div className="min-h-screen bg-page">
        <KioskoFichajePage />
        <button
          onClick={() => navigate(pageToRoute('dashboard', slug))}
          className="fixed bottom-4 left-4 text-xs text-text-secondary hover:text-text-primary"
          title="Salir del kiosko"
        >
          ← salir
        </button>
      </div>
    )
  }

  // visiblePageIds para Sidebar
  const visiblePageIds = perms || new Set<Page>(NAV.map(n => n.id))
  const canSwitchToWorker = profile.role === 'manager' && !!profile.employeeId
  const roleLabel = profile.role === 'admin' ? 'Admin' : profile.role === 'manager' ? 'Encargado' : 'Trabajador'
  const roleIcon = profile.role === 'admin' ? '👑' : profile.role === 'manager' ? '👔' : '👷'

  return (
    <div className="min-h-screen bg-page">
      {/* Sidebar: desktop fijo, móvil drawer controlado por mobileMenuOpen.
          Bloque C Fases 2-3: ya NO recibe page/setPage; deriva de URL. */}
      <Sidebar
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
            {/* Selector de cuenta activa (multi-tenant) — visible si hay 2+ cuentas */}
            <AccountSelector className="hidden sm:inline-flex" />
            {/* Selector de local activo (módulo multitenancy / Stock) — oculto en móvil */}
            <LocationSelector className="hidden sm:inline-flex" />
            {/* Filtro multi-select de marcas (módulo multitenancy / Stock) — oculto en móvil */}
            <BrandFilterSelector className="hidden sm:inline-flex" />
            {/* Botón modo trabajador (solo manager con employee_id) — oculto en móvil */}
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
          {showUsuariosAccesos ? (
            <UsuariosAccesosPage />
          ) : (
            // Bloque C Fases 2-3: <Routes> sustituye al switch (page). Cada
            // Route mapea el path declarado en routes.ts al componente.
            // basename del BrowserRouter elimina '/llorente29-app'; las
            // rutas anidan: '/:slug/<rest>'.
            <Routes>
              {(Object.keys(PAGE_COMPONENTS) as Page[]).map(p => {
                const Comp = PAGE_COMPONENTS[p]
                if (!Comp) return null
                const path = pageToPath(p)
                return (
                  <Route
                    key={p}
                    path={`:slug/${path}`}
                    element={<Comp />}
                  />
                )
              })}
              {/* Fallback: ruta no reconocida bajo el slug → Dashboard.
                  La URL no se cambia aquí; el redirect inicial/por permisos
                  se hace en los useEffect de arriba. */}
              <Route path="*" element={<DashboardPage />} />
            </Routes>
          )}
        </main>
      </div>
    </div>
  )
}

/* =====================================================
   APP RAÍZ CON AUTH
   ===================================================== */

export default function App() {
  // Bloque B-6b (17/05/2026): App raíz consume AppContext en lugar de
  // hacer su propia query a `getCurrentProfile()`. Sin query duplicada,
  // sin useState<UserProfile> propio, sin useEffect de loadProfile, sin
  // subscription propia a onAuthStateChange (AppContext la tiene).
  //
  // Feature flags (gate.load) se invocan desde aquí en useEffect dependiente
  // de userProfile para cargar/limpiar automáticamente al cambiar sesión.
  const { authResolved, authUserId, userProfile, accountsLoading } = useApp()
  const location = useLocation()

  // Cargar/limpiar feature flags según userProfile.
  useEffect(() => {
    if (userProfile) {
      void gate.load().then(state => {
        if (state) {
          console.log('[platform] Cuenta cargada:', state.account.name,
            `| ${state.flags.size} feature flags activos`)
        }
      }).catch(err => {
        console.error('[platform] Error cargando feature flags:', err)
      })
    } else {
      gate.clear()
    }
  }, [userProfile])

  async function handleSignOut() {
    await signOut()
    gate.clear()
    // setProfile(null) no hace falta: AppContext escucha SIGNED_OUT vía
    // onAuthStateChange y resetea authUserId/userProfile automáticamente.
  }

  // 1. Auth aún sin resolver (Supabase tarda ~50ms en saber si hay sesión).
  if (!authResolved) {
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

  // 1-bis. PROTECCIÓN INTEGRAL DE RUTAS PÚBLICAS DE AUTH — Sesión 9.
  //
  //        Estas rutas (/login, /welcome, /reset-password, /reset-password/confirm)
  //        viven FUERA del namespace de cuenta. Si el user las visita con
  //        sesión activa, NO debemos meterlo automáticamente al Shell:
  //
  //          - /login: aunque haya sesión, si vino aquí manualmente quizá
  //            quiere cambiar de cuenta; respetar la pantalla.
  //          - /welcome: forzado por guard 3-bis cuando welcome IS NULL.
  //          - /reset-password: pidiendo email de reset. El user explícitamente
  //            quiso entrar aquí; no expulsarle.
  //          - /reset-password/confirm: SECURITY-CRITICAL. El user vino
  //            de un link de reset. Si le metemos al Shell sin completar
  //            el form, alguien que intercepte el email entra al sistema
  //            sin cambiar la password. Vulnerabilidad.
  //
  //        Comportamiento:
  //          - /reset-password/confirm → renderiza siempre el componente
  //            (esté autenticado o no). El componente decide qué hacer.
  //          - /login, /welcome, /reset-password → AuthRouter, que ya
  //            maneja estos paths declarativamente y respeta la sesión.
  //
  //        ESTO BLOQUEA el flow del bug Sesión 9 ("nueva pestaña abre
  //        logueada sin haber cambiado password"): la entrada al Shell
  //        se prohíbe cuando la URL es ruta pública, sin importar lo
  //        que diga authUserId.
  if (location.pathname === '/reset-password/confirm') {
    return <ResetPasswordConfirmPage />
  }
  if (isPublicAuthRoute(location.pathname)) {
    return <AuthRouter />
  }

  // 2. Sin sesión → AuthRouter (D-S2.30 Opción B, 19/05/2026).
  //    AuthRouter maneja /login, /welcome y /reset-password.
  //    /reset-password/confirm vive fuera de AuthRouter (ver 1-bis).
  if (!authUserId) {
    return <AuthRouter />
  }

  // 3. Hay sesión, AppContext aún cargando accounts/userProfile.
  if (accountsLoading || !userProfile) {
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

  // 3-bis. Sesión válida pero welcome_completed_at IS NULL.
  //        D-S2.30 paso 3-bis (20/05/2026): el user fue invitado y aún no
  //        ha completado la activación (set password + T&C). Forzar paso
  //        por /welcome antes de entrar al Shell.
  //
  //        Mini-router propio (no <AuthRouter>): aquí ya HAY sesión, por
  //        lo que el flow es distinto al pre-sesión. WelcomePage consume
  //        userProfile vía useApp() y llama a refreshUserProfile() tras
  //        completar el UPDATE; cuando el state se refresque,
  //        welcome_completed_at dejará de ser null y este guard ya no
  //        atrapará la rama → cae al paso 4 con redirect_to del status.
  if (!userProfile.welcomeCompletedAt) {
    return (
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    )
  }

  // 4. Sesión válida + welcome completado → app autenticada.
  // Bloque F-completo (17/05/2026): userProfile directo (sin adaptador).
  // AuthenticatedApp consume multitenancy.UserProfile nativo.
  return <AuthenticatedApp profile={userProfile} onSignOut={handleSignOut} />
}
