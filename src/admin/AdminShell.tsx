// src/admin/AdminShell.tsx
//
// Shell del panel superadmin Folvy (plano de control). Sesión 15.
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
// G-9 / Porteria: la primera página es el alta de cuenta (/_admin/cuentas/nueva).
// El resto del panel (dashboard, listado de cuentas, impersonation, etc.) se
// añadirá en sesiones posteriores como nuevas <Route> aquí.

import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import NuevaCuentaPage from './pages/NuevaCuentaPage'
import CuentasListPage from './pages/CuentasListPage'
import CuentaDetallePage from './pages/CuentaDetallePage'

export default function AdminShell() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg-page)' }}>
      {/* Cabecera del panel admin — azul marino, separada visualmente del
          Shell de cliente para dejar claro que es otro plano. */}
      <header
        className="flex items-center gap-6 px-6"
        style={{ background: 'var(--color-accent)', height: 68 }}
      >
        <span className="text-xl font-display font-medium" style={{ color: 'var(--color-bg-page)' }}>
          Folvy Admin
        </span>
        <nav className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/_admin/cuentas')}
            className="text-sm"
            style={{
              color: 'var(--color-bg-page)',
              opacity: location.pathname.startsWith('/_admin/cuentas') ? 1 : 0.7,
            }}
          >
            Cuentas
          </button>
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
          {/* /_admin → redirige al listado de cuentas */}
          <Route path="/_admin" element={<Navigate to="/_admin/cuentas" replace />} />
          <Route path="/_admin/cuentas" element={<CuentasListPage />} />
          <Route path="/_admin/cuentas/nueva" element={<NuevaCuentaPage />} />
          <Route path="/_admin/cuentas/:accountId" element={<CuentaDetallePage />} />
          {/* Fallback: cualquier /_admin/... desconocido → listado */}
          <Route path="*" element={<Navigate to="/_admin/cuentas" replace />} />
        </Routes>
      </main>
    </div>
  )
}
