// src/components/personal/AccesoTrabajadorPanel.tsx
// Panel reutilizable de "Acceso del trabajador" (modelo C1, entrega cómoda).
//
// Genera un enlace mágico de acceso para el empleado (vía generateAccessLink →
// Edge Function manage-employee) y lo muestra como QR + copiar-enlace, para
// entregarlo por el canal que se quiera (escanear el QR, o pegar el enlace en
// WhatsApp/SMS). El enlace inicia sesión como el trabajador SIN teclear nada.
//
// IMPORTANTE: el enlace es una credencial. Quien lo abre entra como el
// trabajador. Es de un solo uso y caduca (OTP expiry de Supabase Auth).
// "Reenviar" = generar uno nuevo.

import { useState } from 'react'
import { QrCode, Copy, Check, RefreshCw, AlertTriangle } from 'lucide-react'
import { Button, Modal, Alert } from '../ui'
import { generateAccessLink } from '../../services/employeeAuthService'
import QRCode from 'qrcode'

interface Props {
  employeeId: string
  employeeName?: string
}

export default function AccesoTrabajadorPanel({ employeeId, employeeName }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setLoading(true)
    setError(null)
    setCopied(false)
    setLink(null)
    setQrDataUrl(null)

    const res = await generateAccessLink(employeeId)

    if (!res.ok || !res.tokenHash) {
      setError(res.error || 'No se pudo generar el enlace de acceso.')
      setLoading(false)
      return
    }

    // URL de Folvy que canjea el token en /acceso (verifyOtp, sin PKCE).
    const claimUrl = `${window.location.origin}/acceso?token_hash=${encodeURIComponent(res.tokenHash)}&type=${encodeURIComponent(res.type || 'magiclink')}`

    setLink(claimUrl)
    try {
      const dataUrl = await QRCode.toDataURL(claimUrl, { width: 240, margin: 1 })
      setQrDataUrl(dataUrl)
    } catch {
      // Si el QR falla, el enlace para copiar sigue disponible.
      setQrDataUrl(null)
    }
    setLoading(false)
  }

  function handleOpen() {
    setOpen(true)
    void generate()
  }

  function handleClose() {
    setOpen(false)
    setLink(null)
    setQrDataUrl(null)
    setError(null)
    setCopied(false)
  }

  async function handleCopy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>
        <QrCode size={14} /> Enlace de acceso (QR)
      </Button>

      {open && (
        <Modal open={true} onClose={handleClose} title="Enlace de acceso del trabajador" size="md">
          <div className="flex flex-col gap-4">
            <Alert type="info">
              No abras este enlace tú: inicia sesión como {employeeName || 'el trabajador'}.
              Entrégaselo para que lo abra en su móvil — puede escanear el QR o pegarle el enlace
              por WhatsApp. Es de un solo uso y caduca pasado un rato; si caduca, pulsa Reenviar.
            </Alert>

            {loading && (
              <div className="py-8 text-center text-sm text-text-secondary">
                Generando enlace…
              </div>
            )}

            {!loading && error && (
              <>
                <Alert type="error">{error}</Alert>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => void generate()}>
                    <RefreshCw size={14} /> Reintentar
                  </Button>
                </div>
              </>
            )}

            {!loading && !error && link && (
              <>
                {qrDataUrl && (
                  <div className="flex justify-center">
                    <img
                      src={qrDataUrl}
                      alt="Código QR de acceso"
                      className="w-60 h-60 rounded-lg border border-border-default bg-card p-2"
                    />
                  </div>
                )}

                <div>
                  <p className="text-xs text-text-secondary mb-1">Enlace</p>
                  <p className="font-mono text-xs break-all rounded-lg border border-border-default bg-page p-3">
                    {link}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-default">
                  <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                    <AlertTriangle size={12} /> Un solo uso · caduca pasado un rato
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => void generate()}>
                      <RefreshCw size={14} /> Reenviar
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleCopy}>
                      {copied ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar enlace</>}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
