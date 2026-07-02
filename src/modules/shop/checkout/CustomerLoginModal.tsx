// src/modules/shop/checkout/CustomerLoginModal.tsx
//
// Modal de login del comensal por código mágico (OTP). Dos pasos:
//   1) email  -> requestLoginCode (envía el código por email)
//   2) código -> verifyLoginCode  (crea la sesión persistente)
// Al entrar, llama onLoggedIn(name) para que el contenedor refresque su estado.
//
// Autocontenido (paleta propia); reutilizable desde la topbar del hub y el checkout.

import { useState } from 'react'
import { requestLoginCode, verifyLoginCode } from '@/modules/shop/checkout/customerAuthService'

const C = {
  ink: '#16140F', inkDim: '#6E6960', line: '#E6E3DC', surface: '#FFFFFF',
  accent: '#FF5436', green: '#16A05B', red: '#C23B22', page: '#F7F7F5',
}

const st: Record<string, React.CSSProperties> = {
  wrap: { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(20,14,10,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  card: { background: C.surface, borderRadius: 18, maxWidth: 420, width: '100%', padding: '26px 26px 24px', boxShadow: '0 24px 60px rgba(0,0,0,.3)' },
  title: { fontSize: 20, fontWeight: 900, letterSpacing: '-.02em', color: C.ink, margin: '0 0 6px' },
  sub: { fontSize: 13.5, color: C.inkDim, lineHeight: 1.5, margin: '0 0 18px' },
  input: { width: '100%', border: `1.5px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', fontSize: 15, color: C.ink, background: '#fff', boxSizing: 'border-box' as const },
  codeInput: { width: '100%', border: `1.5px solid ${C.line}`, borderRadius: 12, padding: '14px', fontSize: 26, letterSpacing: 8, textAlign: 'center' as const, fontWeight: 800, color: C.ink, background: '#fff', boxSizing: 'border-box' as const, fontFamily: 'monospace' },
  btn: { width: '100%', border: 'none', background: C.ink, color: '#fff', borderRadius: 12, padding: '13px', fontSize: 15, fontWeight: 800, cursor: 'pointer', marginTop: 14 },
  btnDim: { opacity: .5, cursor: 'default' },
  link: { background: 'none', border: 'none', color: C.inkDim, fontSize: 13, cursor: 'pointer', marginTop: 14, textDecoration: 'underline' },
  err: { fontSize: 13, color: C.red, marginTop: 10, fontWeight: 600 },
  close: { position: 'absolute' as const, top: 14, right: 16, background: 'none', border: 'none', fontSize: 22, color: C.inkDim, cursor: 'pointer', lineHeight: 1 },
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default function CustomerLoginModal({ slug, onClose, onLoggedIn }: {
  slug: string
  onClose: () => void
  onLoggedIn: (name: string | null) => void
}) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function sendCode() {
    if (!EMAIL_RE.test(email.trim()) || busy) return
    setBusy(true); setErr(null)
    const r = await requestLoginCode(slug, email.trim())
    setBusy(false)
    if (!r.ok) {
      setErr(r.reason === 'rate_limited' ? 'Demasiados intentos. Espera un momento.' : 'No se pudo enviar el código. Inténtalo de nuevo.')
      return
    }
    setStep('code')
  }

  async function checkCode() {
    if (code.trim().length < 6 || busy) return
    setBusy(true); setErr(null)
    const r = await verifyLoginCode(slug, email.trim(), code.trim())
    setBusy(false)
    if (!r.ok) {
      const msg = r.reason === 'bad_code' ? 'Código incorrecto.'
        : r.reason === 'expired' ? 'El código ha caducado. Pide uno nuevo.'
        : r.reason === 'too_many_attempts' ? 'Demasiados intentos. Pide un código nuevo.'
        : 'No se pudo validar el código.'
      setErr(msg)
      return
    }
    onLoggedIn(r.name ?? null)
  }

  return (
    <div style={st.wrap} onClick={onClose}>
      <div style={{ ...st.card, position: 'relative' }} onClick={(e) => e.stopPropagation()}>
        <button style={st.close} onClick={onClose} aria-label="Cerrar">{'\u00D7'}</button>

        {step === 'email' ? (
          <>
            <h2 style={st.title}>Entrar</h2>
            <p style={st.sub}>Escribe tu email y te enviamos un código para entrar. Sin contraseñas.</p>
            <input
              style={st.input}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendCode() }}
              autoFocus
            />
            {err && <div style={st.err}>{err}</div>}
            <button
              style={{ ...st.btn, ...(EMAIL_RE.test(email.trim()) && !busy ? {} : st.btnDim) }}
              onClick={sendCode}
            >
              {busy ? 'Enviando…' : 'Enviar código'}
            </button>
          </>
        ) : (
          <>
            <h2 style={st.title}>Tu código</h2>
            <p style={st.sub}>Hemos enviado un código de 6 dígitos a <strong>{email.trim()}</strong>. Míralo en tu correo y escríbelo aquí.</p>
            <input
              style={st.codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') checkCode() }}
              autoFocus
            />
            {err && <div style={st.err}>{err}</div>}
            <button
              style={{ ...st.btn, ...(code.trim().length === 6 && !busy ? {} : st.btnDim) }}
              onClick={checkCode}
            >
              {busy ? 'Comprobando…' : 'Entrar'}
            </button>
            <button style={st.link} onClick={() => { setStep('email'); setCode(''); setErr(null) }}>
              Usar otro email
            </button>
          </>
        )}
      </div>
    </div>
  )
}
