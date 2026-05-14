// src/pages/LoginPage.tsx
// Pantalla de inicio de sesión con Magic Link.
// Tras pedir email, envía un enlace y muestra confirmación.

import { useState } from 'react'
import { sendMagicLink } from '../services/authService'
import { Lock, Mail, MailCheck, AlertCircle } from 'lucide-react'

interface Props {
  onCheckSession?: () => void
}

export default function LoginPage({ onCheckSession }: Props) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      setError('Introduce un email válido')
      return
    }

    setSubmitting(true)
    const result = await sendMagicLink(trimmed, false)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error || 'No se ha podido enviar el enlace')
      return
    }
    setSent(true)
  }

  function handleTryAgain() {
    setSent(false)
    setEmail('')
    setError(null)
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
          {!sent ? (
            <>
              {/* Header tarjeta */}
              <div className="px-6 py-4 bg-accent text-text-on-accent">
                <p className="font-display text-lg inline-flex items-center gap-2">
                  <Lock size={18} /> Inicio de sesión
                </p>
                <p className="text-xs opacity-90 mt-0.5">Te enviaremos un enlace al email</p>
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
                    className="w-full border border-border-default rounded-md px-3 py-2.5 text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                  />
                </div>

                {error && (
                  <div className="bg-danger-bg border border-danger/30 rounded-md px-3 py-2 text-sm text-danger inline-flex items-start gap-2 w-full">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !email.trim()}
                  className="w-full py-3 rounded-md bg-accent text-text-on-accent font-semibold disabled:opacity-40 hover:bg-accent-hover transition-base active:scale-[0.98] inline-flex items-center justify-center gap-2"
                >
                  {submitting
                    ? 'Enviando enlace...'
                    : <><Mail size={16} /> Enviar enlace</>
                  }
                </button>

                <p className="text-xs text-text-secondary text-center">
                  Solo pueden entrar usuarios autorizados.
                  Si no tienes cuenta, pídele acceso a tu administrador.
                </p>
              </form>
            </>
          ) : (
            <>
              {/* Mensaje de éxito */}
              <div className="p-8 text-center space-y-3">
                <MailCheck size={48} className="text-success mx-auto" />
                <p className="text-lg font-display text-text-primary">¡Enlace enviado!</p>
                <p className="text-sm text-text-secondary">
                  Hemos enviado un enlace de acceso a:
                </p>
                <p className="text-sm font-semibold text-accent">
                  {email}
                </p>
                <p className="text-xs text-text-secondary pt-2">
                  Revisa tu bandeja de entrada (y la carpeta de spam si no aparece).
                  Pulsa el botón <strong>"Entrar a Foodint"</strong> que verás en el email.
                </p>
                <p className="text-xs text-text-secondary pt-1">
                  El enlace caduca en 1 hora.
                </p>

                <div className="pt-4 flex flex-col gap-2">
                  <button
                    onClick={handleTryAgain}
                    className="text-sm text-text-secondary hover:text-accent underline transition-base"
                  >
                    Usar otro email
                  </button>
                  {onCheckSession && (
                    <button
                      onClick={onCheckSession}
                      className="text-xs text-text-secondary hover:text-text-primary transition-base"
                    >
                      Ya he pulsado el enlace, recargar
                    </button>
                  )}
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
