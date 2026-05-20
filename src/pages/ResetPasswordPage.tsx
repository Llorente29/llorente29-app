// src/pages/ResetPasswordPage.tsx
//
// Pantalla de inicio de reset password (D-S2.30 paso 5 / D3).
// El user introduce su email; Supabase envía un email con link tipo:
//   {VITE_APP_URL}/reset-password/confirm?code=XXX&type=recovery
// Al pulsar el link, PKCE intercambia el code por sesión activa y aterriza
// en ResetPasswordConfirmPage para introducir nueva password.
//
// FLOW:
//   1. User introduce email + submit.
//   2. resetPasswordForEmail(email) en authService.
//   3. logSecurityEvent('password_reset_requested', { email }) (Sprint 2 E1).
//   4. Mensaje neutro siempre (evita enumeración de cuentas, CWE-203).
//
// DISEÑO Sesión 9:
//   - Decisión 2: si el user ya está autenticado, NO redirigimos. Permitimos
//     iniciar el flow igualmente (caso "cambiar password sin logout previo").
//   - Mensaje neutro en éxito Y en fallo silenciable. Solo errores técnicos
//     visibles (network, supabase down) muestran detalle real.
//
// CHANGELOG Sesión 10 E1 (20/05/2026):
//   - Se loggea password_reset_requested incluso cuando el error es
//     silenciado al usuario. Esto da visibilidad en auditoría sobre intentos
//     de reset (incluso a emails que no existen). Útil para detectar
//     reconnaissance.
//   - actor_user_id será null en la mayoría de casos (no hay sesión).
//     El email queda en details para correlación.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react'
import { resetPasswordForEmail, logSecurityEvent } from '../services/authService'
import Logo from '../components/Logo'

type FormState = 'idle' | 'submitting' | 'sent' | 'error'

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [formState, setFormState] = useState<FormState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg(null)

    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setErrorMsg('Introduce un email válido.')
      setFormState('error')
      return
    }

    setFormState('submitting')

    const result = await resetPasswordForEmail(trimmedEmail)

    // E1 (20/05/2026): registrar el intento de reset SIEMPRE, antes de
    // decidir qué mostrar al user. Independientemente de si el email
    // existe o no, queremos visibilidad en auditoría:
    //  - Para detectar intentos de reconnaissance (probar emails al azar).
    //  - Para correlacionar con login_failed cuando se sospeche credential
    //    stuffing.
    // Usamos void para no bloquear el flow principal con el await del INSERT.
    void logSecurityEvent('password_reset_requested', {
      email: trimmedEmail,
      ok: result.ok,
    })

    // Importante: SIEMPRE mostramos éxito al usuario, incluso si Supabase
    // devolvió error (puede ser email inexistente). Solo errores técnicos
    // claros (network, supabase down) los mostramos como error real, para
    // que el user sepa que algo va mal en el sistema y no que su email
    // no existe.
    if (!result.ok) {
      const errLower = result.error.toLowerCase()
      const isTechnicalError =
        errLower.includes('network') ||
        errLower.includes('fetch') ||
        errLower.includes('supabase no')
      if (isTechnicalError) {
        setErrorMsg(translateResetError(result.error))
        setFormState('error')
        return
      }
      // Cualquier otro error: lo silenciamos y mostramos éxito.
      console.warn('[ResetPasswordPage] silenciando error no técnico:', result.error)
    }

    setFormState('sent')
  }

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
          {formState !== 'sent' ? (
            <>
              <div className="px-6 py-4 bg-accent text-text-on-accent">
                <p className="font-display text-lg inline-flex items-center gap-2">
                  <Mail size={18} /> Recuperar contraseña
                </p>
                <p className="text-xs opacity-90 mt-0.5">
                  Te enviaremos un enlace por email
                </p>
              </div>

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

                {errorMsg && (
                  <div className="bg-danger-bg border border-danger/30 rounded-md px-3 py-2 text-sm text-danger inline-flex items-start gap-2 w-full">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={formState === 'submitting' || !email.trim()}
                  className="w-full py-3 rounded-md bg-accent text-text-on-accent font-semibold disabled:opacity-40 hover:bg-accent-hover transition-base active:scale-[0.98] inline-flex items-center justify-center gap-2"
                >
                  {formState === 'submitting'
                    ? 'Enviando...'
                    : <><Mail size={16} /> Enviar enlace</>
                  }
                </button>

                <Link
                  to="/login"
                  className="block text-center text-sm text-text-secondary hover:text-accent transition-base pt-2 inline-flex items-center justify-center gap-1 w-full"
                >
                  <ArrowLeft size={14} /> Volver a inicio de sesión
                </Link>
              </form>
            </>
          ) : (
            <>
              {/* Estado sent: mensaje neutro de éxito (evita enumeración) */}
              <div className="p-8 text-center space-y-3">
                <CheckCircle2 size={48} className="text-success mx-auto" />
                <p className="text-lg font-display text-text-primary">
                  Revisa tu email
                </p>
                <p className="text-sm text-text-secondary">
                  Si <strong className="text-text-primary">{email}</strong> está
                  registrado en Folvy, recibirás un enlace para crear una
                  nueva contraseña en los próximos minutos.
                </p>
                <p className="text-xs text-text-secondary pt-2">
                  Si no ves el email, revisa tu carpeta de spam.
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
            </>
          )}
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
   Helper: traducir errores técnicos
   ===================================================== */

/**
 * Solo se llama para errores técnicos claros (network, supabase no
 * disponible). Otros errores van silenciados (ver handleSubmit).
 */
function translateResetError(supabaseError: string): string {
  const msg = supabaseError.toLowerCase()
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Sin conexión. Comprueba tu internet y vuelve a probar.'
  }
  if (msg.includes('supabase no')) {
    return 'Servicio no disponible temporalmente. Inténtalo en unos minutos.'
  }
  return 'No se pudo enviar el enlace. Inténtalo de nuevo.'
}
