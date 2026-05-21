// src/admin/AdminShell.tsx
//
// Shell del panel superadmin Folvy (portal de staff). Sesión 15 + Sesión 16.
//
// Opción A (decisión Sesión 15): el panel admin NO es un módulo del Shell de
// cliente. Es una carcasa propia, separada, con su layout y su routing. App.tsx
// la monta en la rama /_admin con gating por usePlatformAdmin (solo platform
// admins llegan aquí; el gating ya está hecho en App.tsx antes de renderizar
// este componente).
//
// Estructura URL: vive bajo /_admin/*. AppContext exime estas rutas de la
// sincronización slug↔cuenta (isAdminRoute en routes.ts).
//
// Sesión 16: portal de staff. La entrada es /_admin/inicio (AdminHomePage), con
// tarjetas a las secciones. Hoy activa: Cuentas. Próximas (Métricas, Staff,
// Auditoría, Impersonation) se añaden como nuevas <Route> aquí.

import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import AdminHomePage from './pages/AdminHomePage'
import NuevaCuentaPage from './pages/NuevaCuentaPage'
import CuentasListPage from './pages/CuentasListPage'
import CuentaDetallePage from './pages/CuentaDetallePage'

interface NavItem {
  label: string
  to: string
  matchPrefix: string
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Inicio', to: '/_admin/inicio', matchPrefix: '/_admin/inicio' },
  { label: 'Cuentas', to: '/_admin/cuentas', matchPrefix: '/_admin/cuentas' },
]

export default function AdminShell() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg-page)' }}>
      {/* Cabecera del portal de staff — azul marino, separada visualmente del
          Shell de cliente para dejar claro que es otro plano. */}
      <header
        className="flex items-center gap-6 px-6"
        style={{ background: 'var(--color-accent)', height: 68 }}
      >
        <button
          type="button"
          onClick={() => navigate('/_admin/inicio')}
          className="text-xl font-display font-medium"
          style={{ color: 'var(--color-bg-page)' }}
        >
          Folvy Admin
        </button>
        <nav className="flex items-center gap-4">
          {NAV_ITEMS.map(item => (
            <button
              key={item.to}
              type="button"
              onClick={() => navigate(item.to)}
              className="text-sm"
              style={{
                color: 'var(--color-bg-page)',
                opacity: location.pathname.startsWith(item.matchPrefix) ? 1 : 0.7,
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-sm"
            style={{ color: 'var(--color-bg-page)', opacity: 0.7 }}
          >
            ← Volver a la app
          </button>
        </div>
      </header>

      <main className="flex-1" style={{ paddingLeft: 26, paddingRight: 26, paddingTop: 24, paddingBottom: 24 }}>
        <Routes>
          {/* /_admin → home del portal */}
          <Route path="/_admin" element={<Navigate to="/_admin/inicio" replace />} />
          <Route path="/_admin/inicio" element={<AdminHomePage />} />
          <Route path="/_admin/cuentas" element={<CuentasListPage />} />
          <Route path="/_admin/cuentas/nueva" element={<NuevaCuentaPage />} />
          <Route path="/_admin/cuentas/:accountId" element={<CuentaDetallePage />} />
          {/* Fallback: cualquier /_admin/... desconocido → home */}
          <Route path="*" element={<Navigate to="/_admin/inicio" replace />} />
        </Routes>
      </main>
    </div>
  )
}
