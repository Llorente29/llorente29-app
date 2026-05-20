// src/pages/LoginPage.tsx
//
// Pantalla de inicio de sesión Folvy V1 (Sprint 2 Bloque D1).
// Flow email + password con PKCE + redirect post-login basado en
// check-account-status.
//
// Reemplaza el LoginPage Foodint legacy (Magic Link) que queda
// archivado como LoginPageMagicLink.tsx por si necesitamos restaurarlo
// en Sprint 3 (decisión D-S2.29).
//
// API:
//   <LoginPage onCheckSession={() => window.location.reload()} />
//   La prop onCheckSession se mantiene por compatibilidad con App.tsx
//   pero NO se usa en este flow (no hay paso "ya pulsé el enlace").
//   En su lugar usamos navigate(redirect_to) tras login OK.
//
// FLOW:
//   1. User introduce email + password.
//   2. Submit → useAuth().signIn(email, password).
//   3. Si ok=false → mostrar error.
//   4. Si ok=true → llamar checkAccountStatus():
//      - status='ok' → navigate(redirect_to).
//      - status='no_active_profile' → mostrar mensaje + signOut.
//      - status='all_accounts_suspended' → mostrar mensaje + signOut.
//      - status='all_accounts_deleted' → mostrar mensaje + signOut.
//
// UI:
//   Reusa los design tokens Foodint (D-S2.31 Opción I): bg-card,
//   text-accent, etc. Rebrand visual completo en Sprint 3.
//
// CHANGELOG Sesión 9 (D-S2.30 paso 4):
//   - Añadido link "¿Olvidaste tu contraseña?" → /reset-password (D3).
//   - Eliminado bloque PENDIENTES obsoleto del header.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../modules/multitenancy/hooks/useAuth'
import { checkAccountStatus } from '../services/accountStatusService'
import { Lock, Mail, AlertCircle, LogIn } from 'lucide-react'

interface Props {
  /**
   * Heredada del LoginPage legacy (Magic Link).
   * En Folvy V1 NO se usa: el redirect se hace via navigate().
   * Mantenida para no romper App.tsx línea 541.
   */
  onCheckSession?: () => void
}

type FormState = 'idle' | 'submitting' | 'error' | 'blocked'

export default function LoginPage({ onCheckSession: _onCheckSession }: Props) {
  const navigate = useNavigate()
  const { signIn, signOut } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formState, setFormState] = useState<FormState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg(null)
    setBlockedMsg(null)

    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setErrorMsg('Introduce un email válido')
      setFormState('error')
      return
    }
    if (!password) {
      setErrorMsg('Introduce tu contraseña')
      setFormState('error')
      return
    }

    setFormState('submitting')

    // 1) Login email + password
    const loginResult = await signIn(trimmedEmail, password)
    if (!loginResult.ok) {
      setErrorMsg(translateLoginError(loginResult.error))
      setFormState('error')
      return
    }

    // 2) Resolver redirect post-login con la Edge Function
    try {
      const status = await checkAccountStatus()

      if (status.status === 'ok' && status.redirect_to) {
        // Login completo. Navegar a la ruta correspondiente.
        navigate(status.redirect_to, { replace: true })
        return
      }

      // Acceso denegado por estado de cuentas. Cerrar sesión y mostrar mensaje.
      const msg =
        status.message ??
        'Tu acceso no está disponible. Contacta con tu administrador.'
      await signOut()
      setBlockedMsg(msg)
      setFormState('blocked')
      setPassword('')
    } catch (e) {
      // Error técnico llamando a la Edge Function. Cerrar sesión por seguridad
      // (el user quedó autenticado en Supabase pero no podemos confirmar acceso).
      console.error('[LoginPage] checkAccountStatus failed:', e)
      await signOut()
      setErrorMsg(
        'No se pudo verificar el estado de tu cuenta. ' +
        'Inténtalo de nuevo en unos segundos.'
      )
      setFormState('error')
      setPassword('')
    }
  }

  function handleTryAgain() {
    setErrorMsg(null)
    setBlockedMsg(null)
    setFormState('idle')
    setPassword('')
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / cabecera */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-display text-accent">
            Foodint
          </h1>
          <p className="text-sm text-text-secondary mt-1">App del equipo</p>
        </div>

        {/* Tarjeta */}
        <div className="bg-card rounded-xl shadow-lg overflow-hidden border border-border-default">
          {formState !== 'blocked' ? (
            <>
              {/* Header tarjeta */}
              <div className="px-6 py-4 bg-accent text-text-on-accent">
                <p className="font-display text-lg inline-flex items-center gap-2">
                  <Lock size={18} /> Inicio de sesión
                </p>
                <p className="text-xs opacity-90 mt-0.5">
                  Introduce tu email y contraseña
                </p>
              </div>

              {/* Formulario */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    autoComplete="email"
                    autoFocus
                    required
                    disabled={formState === 'submitting'}
                    className="w-full border border-border-default rounded-md px-3 py-2.5 text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    disabled={formState === 'submitting'}
                    className="w-full border border-border-default rounded-md px-3 py-2.5 text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-50"
                  />
                </div>

                {errorMsg && (
                  <div className="bg-danger-bg border border-danger/30 rounded-md px-3 py-2 text-sm text-danger inline-flex items-start gap-2 w-full">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={formState === 'submitting' || !email.trim() || !password}
                  className="w-full py-3 rounded-md bg-accent text-text-on-accent font-semibold disabled:opacity-40 hover:bg-accent-hover transition-base active:scale-[0.98] inline-flex items-center justify-center gap-2"
                >
                  {formState === 'submitting'
                    ? 'Iniciando sesión...'
                    : <><LogIn size={16} /> Entrar</>
                  }
                </button>

                {/* Link a reset password (D-S2.30 paso 4, Sesión 9) */}
                <div className="text-center pt-1">
                  <Link
                    to="/reset-password"
                    className="text-sm text-accent hover:underline transition-base"
                  >
                    ¿Olvidaste tu contraseña?
                  </Link>
                </div>

                <p className="text-xs text-text-secondary text-center pt-1">
                  Solo pueden entrar usuarios autorizados.
                  Si no tienes acceso, contacta con tu administrador.
                </p>
              </form>
            </>
          ) : (
            <>
              {/* Estado blocked: acceso denegado por estado de cuentas */}
              <div className="p-8 text-center space-y-3">
                <AlertCircle size={48} className="text-danger mx-auto" />
                <p className="text-lg font-display text-text-primary">
                  Acceso no disponible
                </p>
                <p className="text-sm text-text-secondary">
                  {blockedMsg}
                </p>
                <div className="pt-4">
                  <button
                    onClick={handleTryAgain}
                    className="text-sm text-accent hover:underline transition-base inline-flex items-center gap-2"
                  >
                    <Mail size={14} /> Probar con otro email
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Pie */}
        <p className="text-center text-xs text-text-secondary mt-4">
          Foodint · Hostelería Pro
        </p>
      </div>
    </div>
  )
}

/* =====================================================
   Helper: traducir errores de Supabase a mensajes UX
   ===================================================== */

/**
 * Supabase Auth devuelve mensajes en inglés tipo "Invalid login credentials",
 * "Email not confirmed", "Too many requests", etc. Los traducimos a español
 * con tono útil al usuario final.
 *
 * Si no reconocemos el error, devolvemos un mensaje genérico (NO el original
 * de Supabase, para no exponer detalles técnicos al user).
 */
function translateLoginError(supabaseError: string): string {
  const msg = supabaseError.toLowerCase()

  if (msg.includes('invalid login credentials')) {
    return 'Email o contraseña incorrectos.'
  }
  if (msg.includes('email not confirmed')) {
    return 'Aún no has activado tu cuenta. Revisa tu email.'
  }
  if (msg.includes('too many requests') || msg.includes('rate limit')) {
    return 'Demasiados intentos. Espera unos minutos antes de volver a probar.'
  }
  if (msg.includes('user not found')) {
    return 'Email o contraseña incorrectos.'
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Sin conexión. Comprueba tu internet y vuelve a probar.'
  }

  return 'No se pudo iniciar sesión. Vuelve a intentarlo.'
}
