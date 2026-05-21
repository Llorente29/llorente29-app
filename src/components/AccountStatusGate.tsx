// src/components/AccountStatusGate.tsx
//
// Capa A (Sesión 16): bloqueo efectivo según account.status.
// Envuelve el Shell de cliente. NO envuelve el AdminShell.
//   - suspended/canceled → forceLogout inmediato (signOut) + pantalla "saliendo".
//   - past_due           → banner persistente con días de gracia + children.
//   - resto              → children tal cual.

import { useEffect, useRef, type ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import { signOut } from '../services/authService'

const GRACE_PERIOD_DAYS = 7

function graceDaysLeft(pastDueAt: string | null): number {
  if (!pastDueAt) return GRACE_PERIOD_DAYS
  const start = new Date(pastDueAt).getTime()
  const elapsedDays = Math.floor((Date.now() - start) / 86_400_000)
  const left = GRACE_PERIOD_DAYS - elapsedDays
  return left > 0 ? left : 0
}

export default function AccountStatusGate({ children }: { children: ReactNode }) {
  const { activeAccount } = useApp()
  const status = activeAccount?.status
  const blocked = status === 'suspended' || status === 'canceled'

  // forceLogout una sola vez si la cuenta está bloqueada (guard anti-bucle).
  const firedRef = useRef(false)
  useEffect(() => {
    if (blocked && !firedRef.current) {
      firedRef.current = true
      void signOut()
    }
  }, [blocked])

  // No interferir mientras carga la cuenta.
  if (!activeAccount) return <>{children}</>

  if (blocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <div className="text-center max-w-md px-6">
          <p className="text-2xl font-display font-medium mb-2 text-accent">Folvy</p>
          <p className="text-sm text-text-secondary">
            Esta cuenta no está activa. Cerrando sesión…
          </p>
        </div>
      </div>
    )
  }

  if (status === 'past_due') {
    const days = graceDaysLeft(activeAccount.pastDueAt)
    const dayLabel = days === 1 ? 'día' : 'días'
    return (
      <>
        <div
          className="w-full text-center text-sm py-2 px-4 font-medium"
          style={{ background: '#FBF0DC', color: '#8A6516' }}
        >
          {days > 0
            ? `Pago pendiente. Te ${days === 1 ? 'queda' : 'quedan'} ${days} ${dayLabel} para regularizar antes de la suspensión.`
            : 'Pago pendiente. El periodo de gracia ha finalizado; la cuenta puede ser suspendida.'}
        </div>
        {children}
      </>
    )
  }

  return <>{children}</>
}
