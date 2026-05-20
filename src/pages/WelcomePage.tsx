// src/pages/WelcomePage.tsx
//
// Pantalla de activación de cuenta (D-S2.30 paso 3, D2).
// El user aterriza aquí tras pulsar el enlace del email de invite.
// La plantilla "Invite user" de Supabase usa {{ .ConfirmationURL }}, así que
// al llegar a /welcome ya hay sesión activa (detectSessionInUrl: true).
//
// FLOW:
//   1. Aterriza con sesión activa (sin token a verificar manualmente).
//   2. Si no hay sesión → <Navigate to="/login" /> declarativo (sin
//      side-effects en render).
//   3. User rellena password + repetir password + acepta T&C.
//   4. updateUserPassword(password)
//   5. UPDATE user_profiles SET terms_accepted_at=now(),
//      welcome_completed_at=now() WHERE user_id = auth.uid()
//      (CHECK constraint exige terms_accepted_at <= welcome_completed_at:
//      por eso van en el mismo statement).
//   6. refreshUserProfile() en AppContext: re-carga el profile con las
//      columnas welcome_completed_at/terms_accepted_at actualizadas. CRÍTICO:
//      sin este refresh, App.tsx guard 3-bis vería el profile stale y
//      forzaría a /welcome en bucle tras navegar al Shell.
//   7. checkAccountStatus() → navigate(redirect_to) (Enfoque B post-welcome).
//
// CHANGELOG D-S2.30 paso 3-bis (20/05/2026):
//   - Movido el guard `!isAuthenticated` de side-effect-en-render a
//     <Navigate> declarativo. Antes era `if (!isAuthenticated) {
//     navigate('/login'); return null }` en render, que viola las reglas
//     de React 18 strict mode.
//   - Añadida llamada a refreshUserProfile() tras UPDATE exitoso, antes
//     del checkAccountStatus()+navigate. Cierra el bucle "welcome OK pero
//     state stale" detectado en review.
//   - Si refreshUserProfile() falla, NO navegamos: mostramos error pidiendo
//     al user recargar la página (Opción A acordada en review).
//   - Cast `as unknown as RowUserProfileUpdate` del payload del UPDATE
//     para esquivar el tipo Row* desfasado en src/types/database.ts (las
//     columnas terms_accepted_at, welcome_completed_at y last_password_change_at
//     existen en BBDD desde Sesión 6 pero no en el tipo autogenerado). Sigue
//     el idiom canónico del proyecto (regla técnica "doble cast as unknown
//     as Json"). Deuda registrada: regenerar database.ts con `npm run
//     types:gen` post-Sprint 2.

import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../modules/multitenancy/hooks/useAuth'
import { useApp } from '../context/AppContext'
import { updateUserPassword } from '../services/authService'
import { checkAccountStatus } from '../services/accountStatusService'
import { supabase } from '../lib/supabase'
import type { RowUserProfileUpdate } from '../types/multitenancy'

type FormState = 'idle' | 'submitting' | 'error'

// Política password Supabase D-S2.14: min 8, lowercase + uppercase + digits.
// Validación cliente preventiva; Supabase la valida también server-side.
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/

export default function WelcomePage() {
  const navigate = useNavigate()
  const { user, isAuthenticated, isAuthResolved, signOut } = useAuth()
  const { refreshUserProfile } = useApp()

  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
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

  // Sin sesión activa → no estamos en flow de invite válido. Redirect
  // declarativo a /login (sin side-effects en render).
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg(null)

    // Validación cliente
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
    //
    //    DEUDA: el doble cast `as unknown as RowUserProfileUpdate` esquiva
    //    el tipo Row* desfasado de database.ts. Las columnas terms_accepted_at,
    //    welcome_completed_at y last_password_change_at existen en BBDD desde
    //    Sesión 6 pero no aparecen en el tipo autogenerado. En runtime
    //    Supabase recibe el JSON literal tal cual y Postgres lo aplica.
    //    Se resuelve regenerando database.ts con `npm run types:gen`.
    //    Apuntado en CONTEXTO_ESTADO.
    if (!supabase) {
      setErrorMsg('Supabase no disponible.')
      setFormState('error')
      return
    }

    const now = new Date().toISOString()
    const updatePayload = {
      terms_accepted_at: now,
      welcome_completed_at: now,
    } as unknown as RowUserProfileUpdate

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update(updatePayload)
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

    // 3) Refrescar userProfile en AppContext con las columnas actualizadas.
    //    CRÍTICO: si no refrescamos, App.tsx guard 3-bis seguirá viendo
    //    welcome_completed_at=null y rebotará a /welcome.
    //
    //    Opción A acordada en review: si refresh falla, NO navegamos.
    //    El UPDATE en BBDD ya se hizo; pedimos recargar página para que
    //    AppContext reinicie limpio.
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

    // 4) Resolver redirect post-welcome con checkAccountStatus (Enfoque B).
    try {
      const status = await checkAccountStatus()
      if (status.status === 'ok' && status.redirect_to) {
        navigate(status.redirect_to, { replace: true })
        return
      }
      // Estados terminales (no_active_profile / suspended / deleted).
      // No debería ocurrir tras un welcome OK, pero por defensividad
      // cerramos sesión y mostramos error.
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
                {' '}de Foodint.
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
          Foodint · Hostelería Pro
        </p>
      </div>
    </div>
  )
}

/* =====================================================
   Helper: traducir errores de updateUserPassword
   ===================================================== */

/**
 * updateUserPassword devuelve errores Supabase en inglés. Los traducimos
 * sin exponer el original al user. Si no reconocemos, mensaje genérico.
 */
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
