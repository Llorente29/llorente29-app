// src/modules/printing/components/QrScanButton.tsx
//
// Escaneo de QR para vincular la Estación. DOS caminos:
//  · NATIVO (app Capacitor): usa el Google Code Scanner de ML Kit vía el plugin
//    EscposPrinter.scanQr — UI de Google, sin permiso de cámara ni preview. Es
//    lo que funciona en la Teclast (el BarcodeDetector del WebView no está).
//  · WEB (navegador con soporte): BarcodeDetector + getUserMedia (overlay propio).
//  · Si ninguno está disponible, el botón NO se muestra y queda el pegado del
//    token como fallback (nunca falla).
//
// El QR de la Estación (DevicesSettings) codifica `${origin}/estacion?token=…`;
// extractToken() saca el token tanto de esa URL como de un token en crudo.

import { useEffect, useRef, useState } from 'react'
import { QrCode, X, Loader2, AlertCircle } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { EscposPrinter } from '../../../native/print/EscposPrinter'
import { extractToken } from '../pairingUtils'

// BarcodeDetector no está en las libs de TS; tipado mínimo (camino web).
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike
function getCtor(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
  return w.BarcodeDetector ?? null
}
function webScanSupported(): boolean {
  return getCtor() !== null && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

interface Props {
  onToken: (token: string) => void
  className?: string
}

export default function QrScanButton({ onToken, className = '' }: Props) {
  const [open, setOpen] = useState(false)      // overlay web
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [scanning, setScanning] = useState(false) // escaneo nativo en curso
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  const native = Capacitor.isNativePlatform()
  const supported = native || webScanSupported()

  // ── Camino NATIVO: Google Code Scanner ──────────────────────────────────────
  async function handleNativeScan() {
    setError(null)
    setScanning(true)
    try {
      const { value, cancelled } = await EscposPrinter.scanQr()
      if (cancelled || !value) return
      const token = extractToken(value)
      if (token) onToken(token)
      else setError('El QR no contiene un token válido.')
    } catch {
      setError('No se pudo abrir el escáner. Pega el token a mano.')
    } finally {
      setScanning(false)
    }
  }

  // ── Camino WEB: overlay con BarcodeDetector ─────────────────────────────────
  function stopCamera() {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }
  function closeOverlay() {
    stopCamera()
    setOpen(false)
    setStarting(false)
  }

  useEffect(() => {
    if (!open) return
    const Ctor = getCtor()
    if (!Ctor) { setError('Este dispositivo no puede escanear QR. Pega el token a mano.'); return }

    let cancelled = false
    const detector = new Ctor({ formats: ['qr_code'] })
    setStarting(true)
    setError(null)

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (stream) => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play().catch(() => { /* ya venimos de un click */ })
        setStarting(false)

        const scan = async () => {
          if (cancelled || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const hit = codes.find(c => c.rawValue?.trim())
            if (hit) {
              const token = extractToken(hit.rawValue)
              if (token) { closeOverlay(); onToken(token); return }
            }
          } catch { /* frame no legible; seguimos */ }
          rafRef.current = requestAnimationFrame(() => { void scan() })
        }
        rafRef.current = requestAnimationFrame(() => { void scan() })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setStarting(false)
        const name = (e as { name?: string })?.name
        setError(
          name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Actívalo o pega el token a mano.'
            : name === 'NotFoundError'
              ? 'No se encontró cámara. Pega el token a mano.'
              : 'No se pudo abrir la cámara. Pega el token a mano.'
        )
      })

    return () => { cancelled = true; stopCamera() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!supported) return null

  return (
    <>
      <button
        type="button"
        onClick={() => (native ? void handleNativeScan() : setOpen(true))}
        disabled={scanning}
        className={`inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 text-zinc-950 font-bold py-3 hover:bg-emerald-400 disabled:opacity-60 ${className}`}
      >
        {scanning
          ? <><Loader2 size={18} className="animate-spin" /> Abriendo escáner…</>
          : <><QrCode size={18} /> Escanear QR</>}
      </button>

      {error && (
        <div className="mt-2 rounded-lg bg-red-500/15 text-red-200 ring-1 ring-red-500/40 px-3 py-2 text-sm inline-flex items-start gap-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 h-14 shrink-0 text-zinc-100">
            <span className="text-sm font-semibold inline-flex items-center gap-2">
              <QrCode size={18} /> Apunta al QR de la estación
            </span>
            <button onClick={closeOverlay} className="p-2 rounded-md hover:bg-zinc-800" title="Cerrar">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 min-h-0 relative grid place-items-center">
            <video ref={videoRef} playsInline muted className="max-h-full max-w-full object-contain" />
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="w-56 h-56 rounded-2xl ring-2 ring-emerald-400/80" />
            </div>
            {starting && (
              <div className="absolute inset-0 grid place-items-center text-zinc-300 gap-2">
                <Loader2 className="animate-spin" size={22} /> Abriendo cámara…
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
