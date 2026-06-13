import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AuthRouter from './auth/AuthRouter'
import WelcomePage from './pages/WelcomePage'
import ResetPasswordConfirmPage from './pages/ResetPasswordConfirmPage'
import AccesoClaimPage from './pages/AccesoClaimPage'
import { useApp } from './context/AppContext'
import { isPublicAuthRoute, isAdminRoute } from './routes'
import { gate } from '@/platform/feature-gate/featureGateService'
import { usePlatformAdmin } from '@/platform/usePlatformAdmin'
import AdminShell from './admin/AdminShell'
import Shell from './shell/Shell'
import AccountStatusGate from './components/AccountStatusGate'
import TrabajadorApp from './pages/trabajador/TrabajadorApp'
import { useAuth } from './modules/multitenancy/hooks/useAuth'
import KdsKioskRoute from './modules/kds/KdsKioskRoute'

// G-8.6 (Sprint 3): App.tsx reducido. El render autenticado es el Shell modular
// (src/shell/Shell.tsx), que vive en la raíz y resuelve la cuenta por AppContext.
// El antiguo AuthenticatedApp + Sidebar legacy + mapeo PAGE_COMPONENTS se
// retiraron en la limpieza G-8.7 (este commit). La lógica de auth (rutas
// públicas, welcome, loading) se conserva intacta.

export default function App() {
  // Bloque B-6b: App raíz consume AppContext (sin query duplicada de perfil).
  // Feature flags (gate.load) se cargan/limpian según userProfile.
  const { authResolved, authUserId, userProfile, accountsLoading } = useApp()
  const location = useLocation()
  // Sesión 15 (Porteria/Panel Admin): platform-admin para gating de /_admin.
  // Hook independiente que lee el claim folvy.is_platform_admin del JWT.
  // Se llama aquí arriba (no dentro de un if) para respetar las reglas de hooks.
  const { isPlatformAdmin, loading: platformAdminLoading } = usePlatformAdmin()
  // Frente "Acceso del trabajador" (Modelo C1): signOut para el onExitMode
  // del TrabajadorApp en el caso de worker puro. Ver gate 3-quater más abajo.
  const { signOut } = useAuth()

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

  // 1. Auth aún sin resolver (Supabase tarda ~50ms en saber si hay sesión).
  if (!authResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <div className="text-center">
          <p className="text-2xl font-display font-medium mb-2 text-accent">
            Folvy
          </p>
          <p className="text-sm text-text-secondary">Cargando...</p>
        </div>
      </div>
    )
  }

  // 1-bis. PROTECCIÓN INTEGRAL DE RUTAS PÚBLICAS DE AUTH — Sesión 9.
  //        /login, /welcome, /reset-password, /reset-password/confirm viven
  //        FUERA del namespace de cuenta. Con sesión activa NO se mete al user
  //        automáticamente al Shell.
  //          - /reset-password/confirm: SECURITY-CRITICAL. Renderiza siempre el
  //            componente; si no, alguien que intercepte el email entraría sin
  //            cambiar password (vulnerabilidad Sesión 9).
  //          - /login, /welcome, /reset-password → AuthRouter (respeta sesión).
  if (location.pathname === '/reset-password/confirm') {
    return <ResetPasswordConfirmPage />
  }
  // Aterrizaje del enlace de acceso del trabajador (Modelo C1). Ruta pública:
  // canjea el token y establece sesión antes de cualquier gate.
  if (location.pathname === '/acceso') {
    return <AccesoClaimPage />
  }
  // Modo KIOSCO del KDS (frontera de token, sin sesión). Ruta pública /kds:
  // el dispositivo se identifica con su token (?token= o localStorage) y la RPC
  // kds_board deriva el local. Va ANTES de los gates de sesión/cuenta. NB: las
  // rutas del Shell viven bajo /:slug/kds (no empiezan por '/kds'), así que este
  // startsWith solo captura el kiosco público.
  if (location.pathname.startsWith('/kds')) {
    return <KdsKioskRoute />
  }
  if (isPublicAuthRoute(location.pathname)) {
    return <AuthRouter />
  }

  // 2. Sin sesión → AuthRouter (maneja /login, /welcome, /reset-password).
  if (!authUserId) {
    return <AuthRouter />
  }

  // 3. Hay sesión, AppContext aún cargando accounts/userProfile.
  if (accountsLoading || !userProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <div className="text-center">
          <p className="text-2xl font-display font-medium mb-2 text-accent">
            Folvy
          </p>
          <p className="text-sm text-text-secondary">Cargando...</p>
        </div>
      </div>
    )
  }

  // 3-bis. Sesión válida pero welcome_completed_at IS NULL → forzar /welcome
  //        (user invitado que aún no completó activación: password + T&C).
  if (!userProfile.welcomeCompletedAt) {
    return (
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    )
  }

  // 3-ter. PANEL SUPERADMIN FOLVY (/_admin) — Sesión 15.
  //        Plano de control separado del plano de cliente (Opción A: el panel
  //        NO es un módulo del Shell, es una rama de render propia con su
  //        AdminShell). Gating estricto por platform-admin (claim del JWT).
  //          - Si aún resolviendo el claim → loading.
  //          - Si platform-admin → AdminShell (layout y routing propios).
  //          - Si NO platform-admin → fuera, al Shell de cliente (no se filtra
  //            la existencia del panel: simplemente redirige a la raíz).
  if (isAdminRoute(location.pathname)) {
    if (platformAdminLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-page">
          <div className="text-center">
            <p className="text-2xl font-display font-medium mb-2 text-accent">
              Folvy
            </p>
            <p className="text-sm text-text-secondary">Cargando...</p>
          </div>
        </div>
      )
    }
    if (!isPlatformAdmin) {
      return <Navigate to="/" replace />
    }
    return <AdminShell />
  }

  // 3-quater. GATE DE ROL WORKER — Frente "Acceso del trabajador" (Modelo C1).
  //           Worker puro (role='worker' con employeeId) → TrabajadorApp en vez
  //           del Shell. NO afecta al encargado dual (role='manager' con
  //           employeeId): éste cae al Shell por defecto y entrará al portal
  //           vía el botón "Ver como trabajador" del Shell (paso 5 del frente).
  //           onExitMode = signOut: para el worker puro, "salir" es cerrar
  //           sesión (no tiene vista de Gestión a la que volver).
  if (userProfile.role === 'worker' && userProfile.employeeId) {
    return (
      <TrabajadorApp
        employeeId={userProfile.employeeId}
        onExitMode={() => { void signOut() }}
      />
    )
  }

  // 4. Sesión válida + welcome completado → Shell modular (render por defecto).
  //    G-8.6: el Shell vive en la raíz (sin slug, opción C) y resuelve la
  //    cuenta activa por AppContext.
  return (
    <AccountStatusGate>
      <Shell />
    </AccountStatusGate>
  )
}
