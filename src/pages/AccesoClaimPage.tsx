// src/pages/AccesoClaimPage.tsx
// Aterrizaje del "Enlace de acceso del trabajador" (Modelo C1).
//
// El trabajador abre el QR/enlace → llega aquí con ?token_hash=...&type=magiclink.
// Canjeamos el token con verifyOtp (NO depende del code_verifier PKCE: funciona
// para enlaces generados en servidor). Si va bien, queda con sesión iniciada y
// lo mandamos a la raíz, donde App.tsx lo enruta a su portal por rol.
//
// Ruta pública: se renderiza haya o no sesión previa. Token de un solo uso.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export default function AccesoClaimPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'verifying' | 'error'>('verifying')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let cancel = false

    async function claim() {
      if (!supabase) {
        setErrorMsg('La aplicación no está disponible en este momento.')
        setStatus('error')
        return
      }

      const params = new URLSearchParams(window.location.search)
      const tokenHash = params.get('token_hash')
      const type = (params.get('type') || 'magiclink') as EmailOtpType

      if (!tokenHash) {
        setErrorMsg('Este enlace no es válido. Pide a tu encargado que te lo reenvíe.')
        setStatus('error')
        return
      }

      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })

      if (cancel) return

      if (error) {
        setErrorMsg('Este enlace ya se ha usado o ha caducado. Pide a tu encargado que te reenvíe el acceso.')
        setStatus('error')
        return
      }

      // Sesión iniciada → a la raíz; App.tsx enruta al portal por rol.
      navigate('/', { replace: true })
    }

    void claim()
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-page p-6">
      <div className="text-center max-w-sm">
        <p className="text-2xl font-display font-medium mb-2 text-accent">Folvy</p>
        {status === 'verifying' ? (
          <p className="text-sm text-text-secondary">Validando tu acceso…</p>
        ) : (
          <p className="text-sm text-danger font-medium">{errorMsg}</p>
        )}
      </div>
    </div>
  )
}
