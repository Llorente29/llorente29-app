// src/pages/LoginPage.tsx
// Pantalla de inicio de sesión con Magic Link.
// Tras pedir email, envía un enlace y muestra confirmación.

import { useState } from 'react'
import { sendMagicLink } from '../services/authService'

interface Props {
  onCheckSession?: () => void  // callback para forzar revisión de sesión (opcional)
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
    <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / cabecera */}
        <div className="text-center mb-8">
          <h1
            className="text-5xl font-bold"
            style={{ fontFamily: 'Instrument Serif, Georgia, serif', color: '#7C1A1A' }}
          >
            Foodint
          </h1>
          <p className="text-sm text-gray-500 mt-1">App del equipo</p>
        </div>

        {/* Tarjeta */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {!sent ? (
            <>
              {/* Header tarjeta */}
              <div className="px-6 py-4" style={{ backgroundColor: '#7C1A1A', color: 'white' }}>
                <p className="font-semibold text-lg">🔐 Inicio de sesión</p>
                <p className="text-xs opacity-90 mt-0.5">Te enviaremos un enlace al email</p>
              </div>

              {/* Formulario */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
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
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:border-[#7C1A1A]"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !email.trim()}
                  className="w-full py-3 rounded-lg text-white font-semibold disabled:opacity-40 transition active:scale-[0.98]"
                  style={{ backgroundColor: '#7C1A1A' }}
                >
                  {submitting ? 'Enviando enlace...' : '✉️ Enviar enlace'}
                </button>

                <p className="text-[11px] text-gray-500 text-center">
                  Solo pueden entrar usuarios autorizados.
                  Si no tienes cuenta, pídele acceso a tu administrador.
                </p>
              </form>
            </>
          ) : (
            <>
              {/* Mensaje de éxito */}
              <div className="p-8 text-center space-y-3">
                <div className="text-5xl">📬</div>
                <p className="text-lg font-semibold text-gray-900">¡Enlace enviado!</p>
                <p className="text-sm text-gray-600">
                  Hemos enviado un enlace de acceso a:
                </p>
                <p className="text-sm font-semibold" style={{ color: '#7C1A1A' }}>
                  {email}
                </p>
                <p className="text-xs text-gray-500 pt-2">
                  Revisa tu bandeja de entrada (y la carpeta de spam si no aparece).
                  Pulsa el botón <strong>"Entrar a Foodint"</strong> que verás en el email.
                </p>
                <p className="text-[11px] text-gray-400 pt-1">
                  El enlace caduca en 1 hora.
                </p>

                <div className="pt-4 flex flex-col gap-2">
                  <button
                    onClick={handleTryAgain}
                    className="text-sm text-gray-500 hover:text-[#7C1A1A] underline"
                  >
                    Usar otro email
                  </button>
                  {onCheckSession && (
                    <button
                      onClick={onCheckSession}
                      className="text-xs text-gray-400 hover:text-gray-600"
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
        <p className="text-center text-xs text-gray-400 mt-4">
          Foodint · Hostelería Pro
        </p>
      </div>
    </div>
  )
}
