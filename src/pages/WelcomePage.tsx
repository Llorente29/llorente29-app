// src/pages/WelcomePage.tsx
//
// Pantalla de activación de cuenta (D-S2.30 paso 3, D2).
// El user aterriza aquí tras pulsar el enlace del email de invite.
//
// FLOW:
//   1. Aterriza con sesión que supabase-js procesa asíncronamente:
//      - Flow invite legacy: #access_token=... en hash.
//      - Flow PKCE invite: ?code=... en query.
//      Ambos son procesados por detectSessionInUrl: true al cargar el bundle.
//   2. ESPERAR a que el procesamiento termine antes de decidir si redirigir
//      (variable waitingForSession). Sin esta espera, AppContext.authUserId
//      está null durante ~50-300ms y WelcomePage redirigiría a /login.
//   3. User rellena password + repetir password + acepta T&C.
//   4. updateUserPassword(password)
//   5. UPDATE user_profiles SET terms_accepted_at=now(),
//      welcome_completed_at=now() WHERE user_id = auth.uid().
//   6. logSecurityEvent('welcome_completed') (Sprint 2 E1).
//   7. refreshUserProfile() en AppContext.
//   8. checkAccountStatus() → navigate(redirect_to) (Enfoque B).
//
// CHANGELOG Sesión 10 (post-bug Test 2):
//   - Detección de #access_token (invite legacy) y ?code= (PKCE) en URL
//     inicial al montar. Si hay alguno, esperar timeout 3s antes de
//     redirigir, igual que ResetPasswordConfirmPage.
//
// CHANGELOG Sesión 10 E1 (20/05/2026):
//   - logSecurityEvent('welcome_completed') tras UPDATE exitoso.
//
// CHANGELOG Sesión 10 F2 (20/05/2026):
//   - Política password (PASSWORD_MIN_LENGTH + PASSWORD_REGEX) extraída a
//     src/lib/passwordPolicy.ts. Ahora se valida con validatePassword().
//     Mantiene exactamente la misma política client-side (regla F2:
//     refactor sin cambio funcional).

import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../modules/multitenancy/hooks/useAuth'
import { useApp } from '../context/AppContext'
import Logo from '../components/Logo'
import { updateUserPassword, logSecurityEvent } from '../services/authService'
import { checkAccountStatus } from '../services/accountStatusService'
import { supabase } from '../lib/supabase'
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_REGEX,
  validatePassword,
} from '../lib/passwordPolicy'

type FormState = 'idle' | 'submitting' | 'error'

// Tiempo máximo de espera (ms) para que supabase-js procese el token de
// invite antes de dar por inválido el flow. Probado E2E en reset password:
// 3s es margen amplio sobre los 50-300ms reales.
const SESSION_PROCESSING_TIMEOUT_MS = 3000

export default function WelcomePage() {
  const navigate = useNavigate()
  const { user, isAuthenticated, isAuthResolved, signOut } = useAuth()
  const { refreshUserProfile } = useApp()

  // Detección inicial al montar: ¿venimos de un link de invite?
  // Calculado UNA VEZ con useState inicializer porque supabase-js LIMPIA
  // el token tras procesarlo, y leer en cada render daría resultados
  // inconsistentes.
  const [initialHasToken] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    // Hash: #access_token=... (invite legacy implicit flow).
    const hashHasToken = window.location.hash.includes('access_token=')
    // Query: ?code=... (invite PKCE) o ?error=... (token expirado etc.).
    const params = new URLSearchParams(window.location.search)
    const queryHasToken = params.has('code') || params.has('error')
    return hashHasToken || queryHasToken
  })

  // Flag de "estamos esperando que termine el procesamiento del token".
  const [waitingForSession, setWaitingForSession] = useState<boolean>(initialHasToken)

  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [formState, setFormState] = useState<FormState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Timeout de espera: si tras 3s sigue sin haber sesión, declarar
  // inválido el flow.
  useEffect(() => {
    if (!waitingForSession) return

    const timer = setTimeout(() => {
      console.warn('[WelcomePage] Procesamiento de token timeout sin sesión')
      setWaitingForSession(false)
    }, SESSION_PROCESSING_TIMEOUT_MS)

    return () => clearTimeout(timer)
  }, [waitingForSession])

  // Cuando llega sesión, dejar de esperar.
  useEffect(() => {
    if (waitingForSession && isAuthenticated) {
      setWaitingForSession(false)
    }
  }, [waitingForSession, isAuthenticated])

  // Esperar a que Auth resuelva antes de decidir qué pintar.
  if (!isAuthResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <p className="text-sm text-text-secondary">Cargando...</p>
      </div>
    )
  }

  // Aún esperando que supabase-js procese el token → mostrar "Verificando..."
  // en lugar de redirigir a /login (que sería el bug original).
  if (waitingForSession && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <p className="text-sm text-text-secondary">Verificando enlace...</p>
      </div>
    )
  }

  // Sin sesión activa Y sin esperar: el link del invite expiró, ya se usó,
  // o el user navegó manualmente sin haber pasado por el flow.
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
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
    if (!acceptedTerms) {
      setErrorMsg('Debes aceptar los Términos y Condiciones para continuar.')
      setFormState('error')
      return
    }
    if (!user) {
      setErrorMsg('No se pudo identificar tu sesión. Vuelve a entrar.')
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

    // 2) UPDATE user_profiles: terms + welcome en el mismo statement
    //    (CHECK constraint user_profiles_welcome_requires_terms exige
    //    terms_accepted_at IS NOT NULL AND terms_accepted_at <= welcome_completed_at).
    //    RLS policy user_profiles_update permite (user_id = auth.uid()).
    if (!supabase) {
      setErrorMsg('Supabase no disponible.')
      setFormState('error')
      return
    }

    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        terms_accepted_at: now,
        welcome_completed_at: now,
      })
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[WelcomePage] UPDATE user_profiles failed:', updateError)
      setErrorMsg(
        'No se pudo completar la activación. ' +
        'Tu contraseña se guardó, pero contacta con tu administrador.'
      )
      setFormState('error')
      return
    }

    // 3) E1 (20/05/2026): registrar welcome_completed ANTES de refresh.
    //    La sesión está activa y el UPDATE de user_profiles ya fue OK.
    //    actor_user_id resuelve vía getCurrentUser() dentro del logger.
    //    Usamos void para no bloquear el flow con el INSERT.
    void logSecurityEvent('welcome_completed')

    // 4) Refrescar userProfile en AppContext con las columnas actualizadas.
    //    CRÍTICO: si no refrescamos, App.tsx guard 3-bis seguirá viendo
    //    welcome_completed_at=null y rebotará a /welcome.
    const refreshed = await refreshUserProfile()
    if (!refreshed || !refreshed.welcomeCompletedAt) {
      console.error('[WelcomePage] refreshUserProfile devolvió profile sin welcome_completed_at')
      setErrorMsg(
        'Activación guardada, pero no se pudo actualizar la sesión. ' +
        'Recarga la página para continuar.'
      )
      setFormState('error')
      return
    }

    // 5) Resolver redirect post-welcome con checkAccountStatus (Enfoque B).
    try {
      const status = await checkAccountStatus()
      if (status.status === 'ok' && status.redirect_to) {
        navigate(status.redirect_to, { replace: true })
        return
      }
      // Estados terminales (no_active_profile / suspended / deleted).
      await signOut()
      setErrorMsg(
        status.message ??
        'Activación completada pero no se pudo abrir tu cuenta. ' +
        'Vuelve a iniciar sesión.'
      )
      setFormState('error')
    } catch (err) {
      console.error('[WelcomePage] checkAccountStatus failed:', err)
      setErrorMsg(
        'Activación completada. ' +
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
          <Logo size="lg" variant="light" className="mb-2" />
          <p className="text-sm text-text-secondary mt-1">App del equipo</p>
        </div>

        {/* Tarjeta */}
        <div className="bg-card rounded-xl shadow-lg overflow-hidden border border-border-default">
          <div className="px-6 py-4 bg-accent text-text-on-accent">
            <p className="font-display text-lg inline-flex items-center gap-2">
              <CheckCircle2 size={18} /> Activa tu cuenta
            </p>
            <p className="text-xs opacity-90 mt-0.5">
              Crea una contraseña para terminar el alta
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Email (read-only, informativo) */}
            {user?.email && (
              <div>
                <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">
                  Email
                </label>
                <div className="w-full border border-border-default rounded-md px-3 py-2.5 text-base bg-accent-bg text-text-secondary">
                  {user.email}
                </div>
              </div>
            )}

            {/* Password */}
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

            {/* Password repeat */}
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

            {/* Checkbox T&C */}
            <label className="flex items-start gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={e => setAcceptedTerms(e.target.checked)}
                disabled={submitting}
                className="mt-0.5 w-4 h-4 accent-accent shrink-0"
              />
              <span>
                Acepto los{' '}
                <a href="#" className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">
                  Términos y Condiciones
                </a>
                {' '}y la{' '}
                <a href="#" className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">
                  Política de Privacidad
                </a>
                {' '}de Folvy.
              </span>
            </label>

            {/* Error */}
            {errorMsg && (
              <div className="bg-danger-bg border border-danger/30 rounded-md px-3 py-2 text-sm text-danger inline-flex items-start gap-2 w-full">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !password || !passwordRepeat || !acceptedTerms}
              className="w-full py-3 rounded-md bg-accent text-text-on-accent font-semibold disabled:opacity-40 hover:bg-accent-hover transition-base active:scale-[0.98] inline-flex items-center justify-center gap-2"
            >
              {submitting ? 'Activando cuenta...' : <><Lock size={16} /> Activar cuenta</>}
            </button>

            <p className="text-xs text-text-secondary text-center pt-2">
              Una vez activada, podrás entrar con tu email y la nueva contraseña.
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
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Sin conexión. Comprueba tu internet y vuelve a probar.'
  }
  return 'No se pudo guardar la contraseña. Inténtalo de nuevo.'
}
