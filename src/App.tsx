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
import TabletStationRoute from './modules/tablet/TabletStationRoute'
import RepartidorRoute from './modules/repartidor/RepartidorRoute'
import SeguimientoRoute from './modules/seguimiento/SeguimientoRoute'
import ShopHubRoute from './modules/shop/ShopHubRoute'
import { isShopHost } from './modules/shop/shopHost'

// G-8.6 (Sprint 3): App.tsx reducido. El render autenticado es el Shell modular
// (src/shell/Shell.tsx), que vive en la raÃ­z y resuelve la cuenta por AppContext.
// El antiguo AuthenticatedApp + Sidebar legacy + mapeo PAGE_COMPONENTS se
// retiraron en la limpieza G-8.7 (este commit). La lÃ³gica de auth (rutas
// pÃºblicas, welcome, loading) se conserva intacta.

export default function App() {
  // Bloque B-6b: App raÃ­z consume AppContext (sin query duplicada de perfil).
  // Feature flags (gate.load) se cargan/limpian segÃºn userProfile.
  const { authResolved, authUserId, userProfile, accountsLoading } = useApp()
  const location = useLocation()
  // SesiÃ³n 15 (Porteria/Panel Admin): platform-admin para gating de /_admin.
  // Hook independiente que lee el claim folvy.is_platform_admin del JWT.
  // Se llama aquÃ­ arriba (no dentro de un if) para respetar las reglas de hooks.
  const { isPlatformAdmin, loading: platformAdminLoading } = usePlatformAdmin()
  // Frente "Acceso del trabajador" (Modelo C1): signOut para el onExitMode
  // del TrabajadorApp en el caso de worker puro. Ver gate 3-quater mÃ¡s abajo.
  const { signOut } = useAuth()

  // Cargar/limpiar feature flags segÃºn userProfile.
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

  // 1. Auth aÃºn sin resolver (Supabase tarda ~50ms en saber si hay sesiÃ³n).
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

  // Folvy Shop por SUBDOMINIO de tienda (<slug>.folvy.app). Un subdominio de
  // tienda SIEMPRE sirve la tienda, con independencia del path (la tienda vive
  // en la raÃ­z de su host). Va lo primero: en app.folvy.app / localhost /
  // previews isShopHost() es false y esto es un no-op (todo sigue igual).
  if (isShopHost()) {
    return <ShopHubRoute />
  }

  // 1-bis. PROTECCIÃ“N INTEGRAL DE RUTAS PÃšBLICAS DE AUTH â€” SesiÃ³n 9.
  //        /login, /welcome, /reset-password, /reset-password/confirm viven
  //        FUERA del namespace de cuenta. Con sesiÃ³n activa NO se mete al user
  //        automÃ¡ticamente al Shell.
  //          - /reset-password/confirm: SECURITY-CRITICAL. Renderiza siempre el
  //            componente; si no, alguien que intercepte el email entrarÃ­a sin
  //            cambiar password (vulnerabilidad SesiÃ³n 9).
  //          - /login, /welcome, /reset-password â†’ AuthRouter (respeta sesiÃ³n).
  if (location.pathname === '/reset-password/confirm') {
    return <ResetPasswordConfirmPage />
  }
  // Aterrizaje del enlace de acceso del trabajador (Modelo C1). Ruta pÃºblica:
  // canjea el token y establece sesiÃ³n antes de cualquier gate.
  if (location.pathname === '/acceso') {
    return <AccesoClaimPage />
  }
  // Modo COCINA-TV del KDS (frontera de token, sin sesiÃ³n). Ruta pÃºblica propia,
  // separada del mÃ³dulo KDS del Shell (/kds, /kds/ajustes) para no colisionar:
  // el Shell monta los mÃ³dulos en la raÃ­z (/kds), asÃ­ que el kiosco NO puede
  // compartir ese prefijo. El dispositivo se identifica con su token (?token= o
  // localStorage) y la RPC kds_board deriva el local. Va ANTES de los gates.
  if (location.pathname.startsWith('/cocina-tv')) {
    return <KdsKioskRoute />
  }
  // Modo ESTACIÃ“N DE TABLET (frontera de token, sin sesiÃ³n). Ruta pÃºblica propia,
  // hermana de /cocina-tv: un terminal a pantalla completa con pestaÃ±as
  // (Pedidos Â· Cocina Â· Disponibilidad). Mismo token de dispositivo. Va ANTES
  // de los gates de sesiÃ³n por la misma razÃ³n que el kiosco.
  if (location.pathname.startsWith('/estacion')) {
    return <TabletStationRoute />
  }
  // PWA del REPARTIDOR (frontera de token, sin sesiÃ³n). Ruta pÃºblica propia,
  // hermana de /estacion: el repartidor entra por su enlace personal
  // /repartidor?token=cour_... El token identifica al courier (courier.access_token).
  // Va ANTES de los gates de sesiÃ³n por la misma razÃ³n que el kiosco/estaciÃ³n.
  if (location.pathname.startsWith('/repartidor')) {
    return <RepartidorRoute />
  }
  // Hub pÃºblico de Folvy Shop (tienda multi-marca, sin sesiÃ³n). Ruta /t/:slug,
  // hermana de /cocina-tv y /estacion. Va antes de los gates de sesiÃ³n.
  if (location.pathname.startsWith('/seguir')) {
    return <SeguimientoRoute />
  }
  if (location.pathname.startsWith('/t/')) {
    return <ShopHubRoute />
  }
  if (isPublicAuthRoute(location.pathname)) {
    return <AuthRouter />
  }

  // 2. Sin sesiÃ³n â†’ AuthRouter (maneja /login, /welcome, /reset-password).
  if (!authUserId) {
    return <AuthRouter />
  }

  // 3. Hay sesiÃ³n, AppContext aÃºn cargando accounts/userProfile.
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

  // 3-bis. SesiÃ³n vÃ¡lida pero welcome_completed_at IS NULL â†’ forzar /welcome
  //        (user invitado que aÃºn no completÃ³ activaciÃ³n: password + T&C).
  if (!userProfile.welcomeCompletedAt) {
    return (
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    )
  }

  // 3-ter. PANEL SUPERADMIN FOLVY (/_admin) â€” SesiÃ³n 15.
  //        Plano de control separado del plano de cliente (OpciÃ³n A: el panel
  //        NO es un mÃ³dulo del Shell, es una rama de render propia con su
  //        AdminShell). Gating estricto por platform-admin (claim del JWT).
  //          - Si aÃºn resolviendo el claim â†’ loading.
  //          - Si platform-admin â†’ AdminShell (layout y routing propios).
  //          - Si NO platform-admin â†’ fuera, al Shell de cliente (no se filtra
  //            la existencia del panel: simplemente redirige a la raÃ­z).
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

  // 3-quater. GATE DE ROL WORKER â€” Frente "Acceso del trabajador" (Modelo C1).
  //           Worker puro (role='worker' con employeeId) â†’ TrabajadorApp en vez
  //           del Shell. NO afecta al encargado dual (role='manager' con
  //           employeeId): Ã©ste cae al Shell por defecto y entrarÃ¡ al portal
  //           vÃ­a el botÃ³n "Ver como trabajador" del Shell (paso 5 del frente).
  //           onExitMode = signOut: para el worker puro, "salir" es cerrar
  //           sesiÃ³n (no tiene vista de GestiÃ³n a la que volver).
  if (userProfile.role === 'worker' && userProfile.employeeId) {
    return (
      <TrabajadorApp
        employeeId={userProfile.employeeId}
        onExitMode={() => { void signOut() }}
      />
    )
  }

  // 4. SesiÃ³n vÃ¡lida + welcome completado â†’ Shell modular (render por defecto).
  //    G-8.6: el Shell vive en la raÃ­z (sin slug, opciÃ³n C) y resuelve la
  //    cuenta activa por AppContext.
  return (
    <AccountStatusGate>
      <Shell />
    </AccountStatusGate>
  )
}
