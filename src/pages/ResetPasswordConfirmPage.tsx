// src/pages/ResetPasswordConfirmPage.tsx
//
// Pantalla de confirmación de reset password (D-S2.30 paso 5 / D4).
// El user aterriza aquí tras pulsar el link del email de reset.
// El cliente PKCE (detectSessionInUrl: true) ya intercambió el code por
// sesión activa antes de que esta página se monte.
//
// FLOW:
//   1. Aterriza con sesión activa (PKCE ya procesó el code).
//   2. Si no hay sesión → <Navigate to="/login" /> declarativo.
//   3. User introduce password nueva + repetir.
//   4. updateUserPassword(password).
//   5. Decisión 1 (Sesión 9): NO redirect a /login. Llamamos
//      checkAccountStatus() y navegamos directo al Shell (Enfoque B,
//      consistente con WelcomePage). El user ya está autenticado.
//
// DIFERENCIAS RESPECTO A WelcomePage:
//   - NO UPDATE a user_profiles (terms ya aceptados en welcome inicial).
//   - NO refreshUserProfile (las columnas welcome/terms no cambian aquí).
//   - SÍ valida password con misma política (D-S2.14).
//
// PENDIENTE Bloque E1: insertar logSecurityEvent('password_reset_completed')
//   tras éxito del updateUserPassword.

import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Lock, AlertCircle, KeyRound } from 'lucide-react'
import { useAuth } from '../modules/multitenancy/hooks/useAuth'
import { updateUserPassword } from '../services/authService'
import { checkAccountStatus } from '../services/accountStatusService'

type FormState = 'idle' | 'submitting' | 'error'

// Política password Supabase D-S2.14: min 8, lowercase + uppercase + digits.
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/

export default function ResetPasswordConfirmPage() {
  const navigate = useNavigate()
  const { isAuthenticated, isAuthResolved, signOut } = useAuth()

  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [formState, setFormState] = useState<FormState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Esperar a que Auth resuelva antes de decidir qué pintar.
  if (!isAuthResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <p className="text-sm text-text-secondary">Cargando...</p>
      </div>
    )
  }

  // Sin sesión activa: el link del email expiró, ya se usó, o el user
  // navegó manualmente sin haber pasado por el flow.
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg(null)

    if (password.length < PASSWORD_MIN_LENGTH) {
      setErrorMsg(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`)
      setFormState('error')
      return
    }
    if (!PASSWORD_REGEX.test(password)) {
      setErrorMsg('La contraseña debe incluir mayúsculas, minúsculas y números.')
      setFormState('error')
      return
    }
    if (password !== passwordRepeat) {
      setErrorMsg('Las contraseñas no coinciden.')
      setFormState('error')
      return
    }

    setFormState('submitting')

    // 1) Actualizar password en Supabase Auth
    const pwdResult = await updateUserPassword(password)
    if (!pwdResult.ok) {
      setErrorMsg(translatePasswordError(pwdResult.error))
      setFormState('error')
      return
    }

    // 2) Resolver redirect al Shell con checkAccountStatus (Enfoque B,
    //    Decisión 1 Sesión 9). El user ya tiene sesión válida; no
    //    necesita reentrar.
    try {
      const status = await checkAccountStatus()
      if (status.status === 'ok' && status.redirect_to) {
        navigate(status.redirect_to, { replace: true })
        return
      }
      // Estados terminales improbables (la sesión existe). Por defensividad
      // cerramos y mostramos el mensaje del status.
      await signOut()
      setErrorMsg(
        status.message ??
        'Contraseña actualizada pero no se pudo abrir tu cuenta. ' +
        'Vuelve a iniciar sesión.'
      )
      setFormState('error')
    } catch (err) {
      console.error('[ResetPasswordConfirm] checkAccountStatus failed:', err)
      setErrorMsg(
        'Contraseña actualizada. ' +
        'No se pudo abrir tu cuenta automáticamente, inicia sesión.'
      )
      setFormState('error')
    }
  }

  // Validación visual del estado de la password (sin bloquear inputs)
  const passwordTooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH
  const passwordWeak = password.length >= PASSWORD_MIN_LENGTH && !PASSWORD_REGEX.test(password)
  const passwordsDiffer = passwordRepeat.length > 0 && password !== passwordRepeat
  const submitting = formState === 'submitting'

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Cabecera */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-display text-accent">Foodint</h1>
          <p className="text-sm text-text-secondary mt-1">App del equipo</p>
        </div>

        {/* Tarjeta */}
        <div className="bg-card rounded-xl shadow-lg overflow-hidden border border-border-default">
          <div className="px-6 py-4 bg-accent text-text-on-accent">
            <p className="font-display text-lg inline-flex items-center gap-2">
              <KeyRound size={18} /> Nueva contraseña
            </p>
            <p className="text-xs opacity-90 mt-0.5">
              Introduce una contraseña nueva
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">
                Contraseña nueva
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                autoFocus
                required
                disabled={submitting}
                className="w-full border border-border-default rounded-md px-3 py-2.5 text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-50"
              />
              <p className="text-xs text-text-secondary mt-1">
                Mínimo 8 caracteres, con mayúsculas, minúsculas y números.
              </p>
              {passwordTooShort && (
                <p className="text-xs text-warning mt-1">Demasiado corta.</p>
              )}
              {passwordWeak && (
                <p className="text-xs text-warning mt-1">
                  Añade mayúsculas, minúsculas y números.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">
                Repite la contraseña
              </label>
              <input
                type="password"
                value={passwordRepeat}
                onChange={e => setPasswordRepeat(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
                disabled={submitting}
                className="w-full border border-border-default rounded-md px-3 py-2.5 text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-50"
              />
              {passwordsDiffer && (
                <p className="text-xs text-danger mt-1">Las contraseñas no coinciden.</p>
              )}
            </div>

            {errorMsg && (
              <div className="bg-danger-bg border border-danger/30 rounded-md px-3 py-2 text-sm text-danger inline-flex items-start gap-2 w-full">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !password || !passwordRepeat}
              className="w-full py-3 rounded-md bg-accent text-text-on-accent font-semibold disabled:opacity-40 hover:bg-accent-hover transition-base active:scale-[0.98] inline-flex items-center justify-center gap-2"
            >
              {submitting ? 'Guardando...' : <><Lock size={16} /> Guardar contraseña</>}
            </button>

            <p className="text-xs text-text-secondary text-center pt-2">
              Una vez guardada, entrarás directamente en tu cuenta.
            </p>
          </form>
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
   Helper: traducir errores de updateUserPassword
   ===================================================== */

function translatePasswordError(supabaseError: string): string {
  const msg = supabaseError.toLowerCase()
  if (msg.includes('at least 8') || msg.includes('weak password')) {
    return 'La contraseña no cumple los requisitos mínimos.'
  }
  if (msg.includes('leaked') || msg.includes('pwned')) {
    return 'Esta contraseña aparece en filtraciones públicas. Elige otra.'
  }
  if (msg.includes('lowercase') || msg.includes('uppercase') || msg.includes('digits')) {
    return 'La contraseña debe incluir mayúsculas, minúsculas y números.'
  }
  if (msg.includes('auth session missing')) {
    return 'Tu sesión ha caducado. Vuelve a abrir el enlace del email.'
  }
  if (msg.includes('same password') || msg.includes('new password should be different')) {
    return 'La nueva contraseña debe ser distinta de la anterior.'
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Sin conexión. Comprueba tu internet y vuelve a probar.'
  }
  return 'No se pudo guardar la contraseña. Inténtalo de nuevo.'
}
