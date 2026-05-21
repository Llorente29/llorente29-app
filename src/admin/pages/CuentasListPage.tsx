// src/admin/pages/CuentasListPage.tsx
//
// Listado de cuentas cliente — panel superadmin. Sesión 15.
//
// Reusa listAccounts() del service de multitenancy (ya existente). Solo lectura.
// RLS hace el scope real; como platform admin, se ven todas las cuentas.
// includeInternal: true para ver tambien la cuenta interna 'Folvy Interno'.
//
// Acciones: boton "Nueva cuenta" -> wizard de alta (/_admin/cuentas/nueva).
// La edicion de cada cuenta (detalle, modulos, suspender...) es la SIGUIENTE
// pieza, aun no construida. Por ahora la tabla es informativa.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listAccounts } from '@/modules/multitenancy/services/accountsService'
import type { Account } from '@/types/multitenancy'

type LoadState =
  | { state: 'loading' }
  | { state: 'ready'; accounts: Account[] }
  | { state: 'error'; message: string }

// Etiqueta + color por status (espejo de los status del modelo).
function statusBadge(status: string): { label: string; bg: string; fg: string } {
  switch (status) {
    case 'active':    return { label: 'Activa',    bg: '#E3F0E6', fg: '#1F6B3B' }
    case 'trial':
    case 'trialing':  return { label: 'Trial',     bg: '#FBF0DC', fg: '#8A6516' }
    case 'past_due':  return { label: 'Impago',    bg: '#FDECEC', fg: '#A12626' }
    case 'suspended': return { label: 'Suspendida', bg: '#FDECEC', fg: '#A12626' }
    case 'canceled':  return { label: 'Cancelada', bg: '#ECECEC', fg: '#666' }
    default:          return { label: status,      bg: '#ECECEC', fg: '#666' }
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

export default function CuentasListPage() {
  const navigate = useNavigate()
  const [load, setLoad] = useState<LoadState>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const accounts = await listAccounts({ includeInternal: true })
        if (!cancelled) setLoad({ state: 'ready', accounts })
      } catch (e) {
        if (!cancelled) {
          setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) })
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-medium" style={{ color: 'var(--color-accent)' }}>
          Cuentas
        </h1>
        <button
          type="button"
          onClick={() => navigate('/_admin/cuentas/nueva')}
          className="px-4 py-2 rounded-md text-sm font-medium"
          style={{ background: 'var(--color-terracota)', color: '#fff' }}
        >
          + Nueva cuenta
        </button>
      </div>

      {load.state === 'loading' && (
        <p className="text-sm" style={{ color: 'var(--color-text-secondary, #666)' }}>Cargando cuentas...</p>
      )}

      {load.state === 'error' && (
        <div className="rounded-lg p-4" style={{ background: '#FDECEC', border: '1px solid #E5A0A0' }}>
          <p className="text-sm font-medium" style={{ color: '#A12626' }}>Error cargando cuentas</p>
          <p className="text-xs mt-1" style={{ color: '#A12626' }}>{load.message}</p>
        </div>
      )}

      {load.state === 'ready' && load.accounts.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--color-text-secondary, #666)' }}>
          No hay cuentas todavía. Crea la primera con "+ Nueva cuenta".
        </p>
      )}

      {load.state === 'ready' && load.accounts.length > 0 && (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border, #e5e5e5)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--color-bg-surface, #faf9f7)' }}>
                <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--color-text-secondary, #555)' }}>Nombre</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--color-text-secondary, #555)' }}>Slug</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--color-text-secondary, #555)' }}>Estado</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--color-text-secondary, #555)' }}>Alta</th>
              </tr>
            </thead>
            <tbody>
              {load.accounts.map(acc => {
                const badge = statusBadge(acc.status)
                return (
                  <tr
                    key={acc.id}
                    onClick={() => navigate(`/_admin/cuentas/${acc.id}`)}
                    style={{ borderTop: '1px solid var(--color-border, #eee)', cursor: 'pointer' }}
                  >
                    <td className="px-4 py-3" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>
                      {acc.name}
                      {acc.isInternal && (
                        <span className="ml-2 text-xs" style={{ color: 'var(--color-text-secondary, #999)' }}>(interna)</span>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-text-secondary, #666)' }}>{acc.slug}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: badge.bg, color: badge.fg }}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-text-secondary, #666)' }}>{formatDate(acc.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
