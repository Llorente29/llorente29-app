import { useState, useEffect } from 'react'
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

const NAV: { id: Page; label: string; icon: string; section?: string }[] = [
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
}

function renderPage(page: Page) {
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
    default:                  return <DashboardPage />
  }
}

function Sidebar({ page, setPage, collapsed, setCollapsed, visiblePageIds }: {
  page: Page; setPage: (p: Page) => void; collapsed: boolean; setCollapsed: (v: boolean) => void
  visiblePageIds: Set<Page>
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

  return (
    <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-white border-r border-gray-200 transition-all duration-200 ${collapsed ? 'w-[64px]' : 'w-56'}`}>
      <div className={`h-14 flex items-center border-b gap-3 shrink-0 ${collapsed ? 'px-3.5' : 'px-4'}`}>
        <LogoSquare size={32} />
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight truncate">Foodint</p>
            <p className="text-[10px] text-gray-400 truncate">App del equipo</p>
          </div>
        )}
      </div>

      <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
        {visibleNav.map((item, idx) => {
          const isActive = page === item.id
          const showSection = item.section && (idx === 0 || visibleNav[idx - 1].section !== item.section)
          const b = badge(item.id)
          return (
            <div key={item.id}>
              {showSection && !collapsed && (
                <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest px-2 pt-3 pb-1">{item.section}</p>
              )}
              {showSection && collapsed && <div className="border-t border-gray-100 my-1.5 mx-1" />}
              <button
                title={collapsed ? item.label : undefined}
                onClick={() => setPage(item.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive ? 'bg-[#F5E9D9] text-[#7C1A1A]' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <span className="relative shrink-0 text-base leading-none">
                  {item.icon}
                  {b > 0 && (
                    <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">{b}</span>
                  )}
                </span>
                {!collapsed && <span className="truncate text-sm">{item.label}</span>}
              </button>
            </div>
          )
        })}
      </nav>

      <div className="p-2 border-t">
        <button onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-xs text-gray-400 hover:bg-gray-100">
          <span className="text-sm">{collapsed ? '→' : '←'}</span>
          {!collapsed && <span>Contraer</span>}
        </button>
      </div>
    </aside>
  )
}

function BottomNav({ page, setPage, visiblePageIds }: {
  page: Page; setPage: (p: Page) => void; visiblePageIds: Set<Page>
}) {
  const main: Page[] = ['dashboard', 'staff', 'kiosko_fichaje', 'ahora_mismo', 'locations']
  const icons: Record<string, string> = { dashboard: '⊞', staff: '👤', kiosko_fichaje: '🕐', ahora_mismo: '🟢', locations: '📍' }
  const visibleMain = main.filter(id => visiblePageIds.has(id))
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex items-center justify-around py-1 px-1 lg:hidden">
      {visibleMain.map(id => (
        <button key={id} onClick={() => setPage(id)}
          className={`flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg min-w-0 ${page === id ? 'text-[#7C1A1A]' : 'text-gray-400'}`}>
          <span className="text-xl leading-none">{icons[id]}</span>
          <span className="text-[9px] font-medium truncate">{PAGE_TITLES[id as Page]?.split(' ')[0] ?? id}</span>
        </button>
      ))}
    </nav>
  )
}

function AuthenticatedApp({ profile, onSignOut }: {
  profile: UserProfile
  onSignOut: () => void | Promise<void>
}) {
  const [page, setPage] = useState<Page>('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [mode, setMode] = useState<AppMode>('unset')
  const [showUsuariosAccesos, setShowUsuariosAccesos] = useState(false)
  const [forceWorkerMode, setForceWorkerMode] = useState(false)
  const [perms, setPerms] = useState<Set<Page> | null>(null)
  // Tasks e incidents del antiguo módulo Operaciones — se reactivarán con módulo APPCC
  const pending = 0
  const critInc = 0

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
      // Admin: ve todo
      if (profile.role === 'admin') {
        setPerms(new Set(NAV.map(n => n.id)))
        return
      }
      // Manager: cargar permisos individuales de manager_permissions
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
  // También se entra si el manager pulsó "Modo trabajador" voluntariamente
  if (mode === 'trabajador' || forceWorkerMode) {
    return (
      <TrabajadorApp
        employeeId={profile.employeeId}
        onExitMode={forceWorkerMode ? () => setForceWorkerMode(false) : onSignOut}
      />
    )
  }

  // Auto-redirigir a primera página permitida si la actual no lo está
  if (perms && !perms.has(page) && perms.size > 0) {
    const firstAllowed = NAV.find(n => perms.has(n.id))?.id || 'dashboard'
    if (firstAllowed !== page) {
      setTimeout(() => setPage(firstAllowed), 0)
    }
  }

  // Modo gestor — la app completa de siempre
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

  // Calcular visiblePageIds para Sidebar y BottomNav
  const visiblePageIds = perms || new Set<Page>(NAV.map(n => n.id))
  const canSwitchToWorker = profile.role === 'manager' && !!profile.employeeId
  const roleLabel = profile.role === 'admin' ? 'Admin' : profile.role === 'manager' ? 'Encargado' : 'Trabajador'
  const roleIcon = profile.role === 'admin' ? '👑' : profile.role === 'manager' ? '👔' : '👷'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="hidden lg:block">
        <Sidebar page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed} visiblePageIds={visiblePageIds} />
      </div>
      <BottomNav page={page} setPage={setPage} visiblePageIds={visiblePageIds} />
      <div className={`transition-all duration-200 ${collapsed ? 'lg:ml-[64px]' : 'lg:ml-56'}`}>
        <header className="h-14 border-b border-gray-200 bg-white/90 backdrop-blur-sm flex items-center justify-between px-5 shrink-0 sticky top-0 z-30">
          <h1 className="text-lg font-semibold" style={{ fontFamily: 'Instrument Serif, serif' }}>
            {showUsuariosAccesos ? '👥 Usuarios y Accesos' : PAGE_TITLES[page]}
          </h1>
          <div className="flex items-center gap-2">
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
            {/* Botón modo trabajador (solo manager con employee_id) */}
            {canSwitchToWorker && (
              <button
                onClick={() => setForceWorkerMode(true)}
                title="Ver app de trabajador"
                className="text-xs px-2 py-1 rounded-md font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
              >
                👤 Modo trabajador
              </button>
            )}
            {/* Botón Usuarios y Accesos (solo admin) */}
            {profile.role === 'admin' && (
              <button
                onClick={() => setShowUsuariosAccesos(!showUsuariosAccesos)}
                title={showUsuariosAccesos ? 'Volver' : 'Usuarios y Accesos'}
                className={`text-xs px-2 py-1 rounded-md font-medium transition ${
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
              className="hover:opacity-80 transition-opacity"
            >
              <LogoSquare size={28} />
            </button>
          </div>
        </header>
        <main className="p-4 sm:p-6 pb-24 lg:pb-6">
          {showUsuariosAccesos ? <UsuariosAccesosPage /> : renderPage(page)}
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
