// src/pages/AccesoTrabajadorPage.tsx
//
// Pantalla de acceso para trabajadores (Modelo C1, Frente "Acceso del trabajador").
//
// Modelo C1: el trabajador entra con USUARIO + CONTRASEÑA prefijada por su
// encargado. El usuario se traduce a un email sintético interno
// {username}@empleado.folvy.app que el trabajador NUNCA ve. Reutiliza el
// mismo supabase.auth.signInWithPassword del manager, sin cambios en backend
// de auth.
//
// FLOW:
//   1. Trabajador introduce usuario + contraseña.
//   2. Normalizar usuario (trim, lowercase, sin tildes via NFD, solo [a-z0-9._]).
//   3. Construir email sintético {username}@empleado.folvy.app.
//   4. signIn(emailSintetico, password) via useAuth().
//   5. checkAccountStatus() — Edge Function decide redirect post-login.
//   6. navigate(redirect_to, { replace: true }) o signOut + mensaje (fail-closed).
//
// LO QUE NO HAY (a propósito):
//   - "¿Olvidaste tu contraseña?": en C1 V1 solo el encargado regenera password.
//   - Enlaces a otros flows: pantalla aislada, el trabajador no debe salir de aquí.
//   - Login por email: para eso ya existe /login (manager/admin).
//
// UI mobile-first: el trabajador entrará casi siempre desde el móvil.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../modules/multitenancy/hooks/useAuth'
import { checkAccountStatus } from '../services/accountStatusService'
import { LogoSquare } from '../components/Logo'
import { Lock, User, AlertCircle, LogIn } from 'lucide-react'

type FormState = 'idle' | 'submitting' | 'error' | 'blocked'

const SYNTHETIC_EMAIL_DOMAIN = 'empleado.folvy.app'

/**
 * Normaliza el usuario tecleado para construir el email sintético:
 *   - trim + lowercase.
 *   - Quita tildes (NFD + remove diacríticos).
 *   - Filtra a [a-z0-9._] (resto fuera).
 *
 * Resultado garantiza que el local-part del email sintético es válido para
 * Supabase Auth (sin espacios, sin símbolos exóticos, sin mayúsculas).
 */
function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9._]/g, '')
}

export default function AccesoTrabajadorPage() {
  const navigate = useNavigate()
  const { signIn, signOut } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [formState, setFormState] = useState<FormState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg(null)
    setBlockedMsg(null)

    const normalized = normalizeUsername(username)
    if (!normalized) {
      setErrorMsg('Introduce tu usuario')
      setFormState('error')
      return
    }
    if (!password) {
      setErrorMsg('Introduce tu contraseña')
      setFormState('error')
      return
    }

    setFormState('submitting')

    const syntheticEmail = `${normalized}@${SYNTHETIC_EMAIL_DOMAIN}`

    // 1) Login con email sintético + password
    const loginResult = await signIn(syntheticEmail, password)
    if (!loginResult.ok) {
      // Mensaje neutro (anti-enumeración): no revelamos si el usuario existe
      // ni si la contraseña es correcta por separado.
      setErrorMsg('Usuario o contraseña incorrectos.')
      setFormState('error')
      return
    }

    // 2) Resolver redirect post-login con la Edge Function check-account-status.
    //    Mismo patrón fail-closed que LoginPage: ante cualquier fallo, signOut.
    try {
      const status = await checkAccountStatus()

      if (status.status === 'ok' && status.redirect_to) {
        navigate(status.redirect_to, { replace: true })
        return
      }

      const msg =
        status.message ??
        'Tu acceso no está disponible. Habla con tu encargado.'
      await signOut()
      setBlockedMsg(msg)
      setFormState('blocked')
      setPassword('')
    } catch (e) {
      console.error('[AccesoTrabajadorPage] checkAccountStatus failed:', e)
      await signOut()
      setErrorMsg(
        'No se pudo verificar tu acceso. Vuelve a intentarlo en unos segundos.'
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
      <div className="w-full max-w-sm">
        {/* Cabecera: isotipo Empleados (no el wordmark del manager) */}
        <div className="text-center mb-6">
          <LogoSquare size={72} variant="empleados" className="mx-auto mb-3" />
          <p className="font-display text-lg text-text-primary">Folvy</p>
          <p className="text-sm text-text-secondary mt-0.5">Acceso empleados</p>
        </div>

        {/* Tarjeta */}
        <div className="bg-card rounded-xl shadow-lg overflow-hidden border border-border-default">
          {formState !== 'blocked' ? (
            <>
              <div className="px-6 py-4 bg-accent text-text-on-accent">
                <p className="font-display text-lg inline-flex items-center gap-2">
                  <Lock size={18} /> Inicio de sesión
                </p>
                <p className="text-xs opacity-90 mt-0.5">
                  Introduce tu usuario y contraseña
                </p>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">
                    Usuario
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="tu.usuario"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="text"
                    autoFocus
                    required
                    disabled={formState === 'submitting'}
                    className="w-full border border-border-default rounded-md px-3 py-3 text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-50"
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
                    className="w-full border border-border-default rounded-md px-3 py-3 text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-50"
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
                  disabled={formState === 'submitting' || !username.trim() || !password}
                  className="w-full py-3 rounded-md bg-accent text-text-on-accent font-semibold disabled:opacity-40 hover:bg-accent-hover transition-base active:scale-[0.98] inline-flex items-center justify-center gap-2"
                >
                  {formState === 'submitting'
                    ? 'Iniciando sesión...'
                    : <><LogIn size={16} /> Entrar</>
                  }
                </button>

                <p className="text-xs text-text-secondary text-center pt-1">
                  Si no recuerdas tus credenciales, pide a tu encargado que las regenere.
                </p>
              </form>
            </>
          ) : (
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
                  <User size={14} /> Probar con otro usuario
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-text-secondary mt-4">
          Folvy · Restauración Profesional
        </p>
      </div>
    </div>
  )
}
