// src/pages/ResetPasswordConfirmPage.tsx
//
// Pantalla de confirmación de reset password (D-S2.30 paso 5 / D4).
// El user aterriza aquí tras pulsar el link del email de reset.
// El cliente PKCE (detectSessionInUrl: true) intercambia el code por
// sesión activa de forma asíncrona.
//
// CONTRATO CON App.tsx (Sesión 9):
//   App.tsx paso 1-bis garantiza que esta pantalla se monta SIEMPRE que
//   pathname === '/reset-password/confirm', sin importar el estado de
//   auth. NO debemos preocuparnos por "qué pasa si no hay sesión y no
//   hay code en URL" más allá de mostrar un mensaje al user.
//
//   Esto previene el bug Sesión 9 ("flow reset entra al Shell sin
//   cambiar password"): la pantalla controla la salida del flow, no el
//   routing global.
//
// FLOW:
//   1. Aterriza con ?code=XXX en la URL.
//   2. supabase-js detecta code y procesa async → crea sesión.
//   3. Esperar a que termine el procesamiento (variable waitingForPkce).
//   4. Una vez hay sesión: user introduce password nueva + repetir.
//   5. updateUserPassword(password).
//   6. logSecurityEvent('password_reset_completed') (Sprint 2 E1).
//   7. Decisión 1 (Sesión 9): NO redirect a /login. checkAccountStatus
//      + navigate al Shell (Enfoque B, consistente con WelcomePage).
//
// CHANGELOG Sesión 10 E1 (20/05/2026):
//   - logSecurityEvent('password_reset_completed') tras updateUserPassword OK.
//
// CHANGELOG Sesión 10 F2 (20/05/2026):
//   - Política password (PASSWORD_MIN_LENGTH + PASSWORD_REGEX) extraída a
//     src/lib/passwordPolicy.ts. Ahora se valida con validatePassword().
//     Misma política client-side; sin cambio funcional.

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Lock, AlertCircle, KeyRound, ArrowLeft } from 'lucide-react'
import { useAuth } from '../modules/multitenancy/hooks/useAuth'
import { updateUserPassword, logSecurityEvent } from '../services/authService'
import Logo from '../components/Logo'
import { checkAccountStatus } from '../services/accountStatusService'
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_REGEX,
  validatePassword,
} from '../lib/passwordPolicy'

type FormState = 'idle' | 'submitting' | 'error'

// Tiempo máximo de espera (ms) para que PKCE procese el ?code= antes de
// dar por inválido el flow. supabase-js suele tardar 50-200ms; damos 3s
// de margen amplio.
const PKCE_PROCESSING_TIMEOUT_MS = 3000

export default function ResetPasswordConfirmPage() {
  const navigate = useNavigate()
  const { isAuthenticated, isAuthResolved, signOut } = useAuth()

  // Detección inicial de ?code= en la URL al montar el componente. Si
  // existe, supabase-js está procesándolo y debemos esperar.
  //
  // Calculado UNA VEZ al montar (useState inicializer), no en cada render,
  // porque supabase-js LIMPIA el code tras procesarlo y leer la URL en
  // cada render daría resultados inconsistentes.
  const [initialHasCode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    return params.has('code') || params.has('error')
  })

  // Flag de "estamos esperando que termine el procesamiento PKCE".
  const [waitingForPkce, setWaitingForPkce] = useState<boolean>(initialHasCode)

  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [formState, setFormState] = useState<FormState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Timeout de espera PKCE: si tras 3s sigue sin haber sesión y aún
  // estamos esperando, declarar inválido el flow.
  useEffect(() => {
    if (!waitingForPkce) return

    const timer = setTimeout(() => {
      console.warn('[ResetPasswordConfirm] PKCE procesamiento timeout sin sesión')
      setWaitingForPkce(false)
    }, PKCE_PROCESSING_TIMEOUT_MS)

    return () => clearTimeout(timer)
  }, [waitingForPkce])

  // Cuando llega sesión, dejar de esperar PKCE.
  useEffect(() => {
    if (waitingForPkce && isAuthenticated) {
      setWaitingForPkce(false)
    }
  }, [waitingForPkce, isAuthenticated])

  // Esperar a que Auth resuelva antes de decidir qué pintar.
  if (!isAuthResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <p className="text-sm text-text-secondary">Cargando...</p>
      </div>
    )
  }

  // Aún esperando que PKCE procese el ?code= → mostrar "Verificando enlace..."
  if (waitingForPkce && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <p className="text-sm text-text-secondary">Verificando enlace...</p>
      </div>
    )
  }

  // Sin sesión activa Y sin esperar: el link del email expiró, ya se usó,
  // o el user navegó manualmente sin haber pasado por el flow.
  //
  // En lugar de Navigate forzado (que podría causar loops si algo cambia
  // entre renders), mostramos un mensaje claro con link manual.
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <Logo size="xl" variant="light" className="mb-2" />
            <p className="text-sm text-text-secondary mt-1">App del equipo</p>
          </div>
          <div className="bg-card rounded-xl shadow-lg overflow-hidden border border-border-default">
            <div className="p-8 text-center space-y-3">
              <AlertCircle size={48} className="text-warning mx-auto" />
              <p className="text-lg font-display text-text-primary">
                Enlace no válido
              </p>
              <p className="text-sm text-text-secondary">
                Este enlace de recuperación ha caducado, ya se usó, o no es válido.
                Solicita uno nuevo desde la pantalla de inicio de sesión.
              </p>
              <div className="pt-4">
                <Link
                  to="/login"
                  className="text-sm text-accent hover:underline transition-base inline-flex items-center gap-2"
                >
                  <ArrowLeft size={14} /> Volver a inicio de sesión
                </Link>
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-text-secondary mt-4">
            Folvy · Restauración Profesional
          </p>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg(null)

    // F2 Sesión 10: validación delegada a passwordPolicy.validatePassword.
    const pwdValidation = validatePassword(password)
    if (!pwdValidation.ok) {
      if (pwdValidation.reason === 'too_short' || pwdValidation.reason === 'empty') {
        setErrorMsg(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`)
      } else {
        setErrorMsg('La contraseña debe incluir mayúsculas, minúsculas y números.')
      }
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

    // 2) E1 (20/05/2026): registrar password_reset_completed. En este
    //    punto la sesión está activa (PKCE ya intercambió el code) y
    //    updateUserPassword devolvió ok, así que actor_user_id resuelve
    //    correctamente vía getCurrentUser() dentro de logSecurityEvent.
    //    Usamos void para no bloquear el flow principal con el INSERT.
    void logSecurityEvent('password_reset_completed')

    // 3) Resolver redirect al Shell con checkAccountStatus (Enfoque B,
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

  // Validación visual del estado de la password (sin bloquear inputs).
  // F2: usa las constantes importadas. NO redefine PASSWORD_REGEX local.
  const passwordTooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH
  const passwordWeak = password.length >= PASSWORD_MIN_LENGTH && !PASSWORD_REGEX.test(password)
  const passwordsDiffer = passwordRepeat.length > 0 && password !== passwordRepeat
  const submitting = formState === 'submitting'

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Cabecera */}
        <div className="text-center mb-8">
          <Logo size="xl" variant="light" className="mb-2" />
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
          Folvy · Restauración Profesional
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
