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
// tarjetas a las secciones. Hoy activa: Cuentas.
//
// AÑADIDO: selector de cliente en la cabecera (saltar de cliente a cliente) +
// banda "Estás gestionando: [Cliente]" visible cuando estás dentro de uno, para
// que sea imposible confundir en qué cliente se está operando.

import { useEffect, useMemo, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Building2, ChevronDown } from 'lucide-react'
import AdminHomePage from './pages/AdminHomePage'
import NuevaCuentaPage from './pages/NuevaCuentaPage'
import CuentasListPage from './pages/CuentasListPage'
import CuentaDetallePage from './pages/CuentaDetallePage'
import { listAccounts } from '@/modules/multitenancy/services/accountsService'
import type { Account } from '@/types/multitenancy'

interface NavItem {
  label: string
  to: string
  matchPrefix: string
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Inicio', to: '/_admin/inicio', matchPrefix: '/_admin/inicio' },
  { label: 'Cuentas', to: '/_admin/cuentas', matchPrefix: '/_admin/cuentas' },
]

// Extrae el accountId de la URL si estamos en la ficha de un cliente
// (/_admin/cuentas/:accountId). 'nueva' no es un id de cliente.
function useActiveAccountId(): string | null {
  const location = useLocation()
  const m = location.pathname.match(/^\/_admin\/cuentas\/([^/]+)/)
  const id = m?.[1] ?? null
  return id && id !== 'nueva' ? id : null
}

export default function AdminShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const activeAccountId = useActiveAccountId()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  // Cargar la lista de clientes una vez (para el selector).
  useEffect(() => {
    let alive = true
    listAccounts({ includeInternal: true })
      .then(rows => { if (alive) setAccounts(rows) })
      .catch(() => { if (alive) setAccounts([]) })
    return () => { alive = false }
  }, [])

  const activeAccount = useMemo(
    () => accounts.find(a => a.id === activeAccountId) ?? null,
    [accounts, activeAccountId],
  )

  function goToAccount(id: string) {
    setMenuOpen(false)
    navigate(`/_admin/cuentas/${id}`)
  }

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

        {/* Selector de cliente — saltar de cliente a cliente desde cualquier sitio. */}
        <div className="ml-auto flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-base"
              style={{
                background: 'rgba(255,255,255,0.12)',
                color: 'var(--color-bg-page)',
              }}
            >
              <Building2 size={15} />
              <span className="max-w-[180px] truncate">
                {activeAccount ? activeAccount.name : 'Elegir cliente'}
              </span>
              <ChevronDown size={14} className={menuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>

            {menuOpen && (
              <>
                {/* Capa para cerrar al hacer clic fuera */}
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div
                  className="absolute right-0 mt-1 z-20 w-64 max-h-80 overflow-auto rounded-lg border bg-card shadow-lg py-1"
                  style={{ borderColor: 'var(--color-border-default)' }}
                >
                  {accounts.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-tertiary">Cargando clientes…</div>
                  ) : (
                    accounts.map(a => {
                      const isActive = a.id === activeAccountId
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => goToAccount(a.id)}
                          className={`w-full text-left px-3 py-2 text-sm transition-base flex items-center gap-2 ${
                            isActive ? 'bg-accent-bg text-accent font-medium' : 'text-text-primary hover:bg-page'
                          }`}
                        >
                          <Building2 size={14} className="shrink-0 opacity-70" />
                          <span className="flex-1 min-w-0 truncate">{a.name}</span>
                          {isActive && <span className="text-[10px] text-accent">actual</span>}
                        </button>
                      )
                    })
                  )}
                </div>
              </>
            )}
          </div>

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

      {/* Banda de cliente activo — visible SOLO cuando estás dentro de un cliente.
          Hace imposible confundir en qué cuenta se está operando. */}
      {activeAccountId && (
        <div
          className="flex items-center gap-2 px-6 py-2 text-sm border-b"
          style={{
            background: 'var(--color-accent-bg)',
            borderColor: 'var(--color-border-default)',
            color: 'var(--color-accent)',
          }}
        >
          <Building2 size={15} />
          <span>
            Estás gestionando:{' '}
            <b>{activeAccount ? activeAccount.name : '…'}</b>
          </span>
        </div>
      )}

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
