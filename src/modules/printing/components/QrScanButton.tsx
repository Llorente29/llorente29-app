// src/modules/printing/components/QrScanButton.tsx
//
// Escaneo de QR IN-APP para vincular la tablet (F3). Usa la API nativa del
// navegador BarcodeDetector + getUserMedia — SIN dependencia nueva ni plugin
// nativo (que obligaría a tocar Gradle). Es progresivo: si el WebView no
// soporta BarcodeDetector, el botón no se muestra (qrScanSupported() = false) y
// queda el pegado manual del token como fallback, que nunca falla (paridad Last).
//
// Emite el texto crudo del QR. El QR de la Estación (DevicesSettings) codifica
// `${origin}/estacion?token=…`; extractToken() saca el token tanto de esa URL
// como de un token pegado en crudo (kdsdev_…).

import { useEffect, useRef, useState } from 'react'
import { QrCode, X, Loader2, AlertCircle } from 'lucide-react'
import { extractToken } from '../pairingUtils'

// BarcodeDetector no está en las libs de TS; tipado mínimo.
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike
function getCtor(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
  return w.BarcodeDetector ?? null
}

interface Props {
  onToken: (token: string) => void
  className?: string
}

export default function QrScanButton({ onToken, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  // No renderizamos nada si el dispositivo no soporta escaneo in-app.
  const supported = getCtor() !== null && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  function stopCamera() {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }

  function close() {
    stopCamera()
    setOpen(false)
    setError(null)
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
        await video.play().catch(() => { /* autoplay puede requerir gesto; ya venimos de un click */ })
        setStarting(false)

        const scan = async () => {
          if (cancelled || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const hit = codes.find(c => c.rawValue?.trim())
            if (hit) {
              const token = extractToken(hit.rawValue)
              if (token) { close(); onToken(token); return }
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
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-800 text-zinc-100 font-medium py-3 hover:bg-zinc-700 ${className}`}
      >
        <QrCode size={18} /> Escanear QR
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 h-14 shrink-0 text-zinc-100">
            <span className="text-sm font-semibold inline-flex items-center gap-2">
              <QrCode size={18} /> Apunta al QR de la estación
            </span>
            <button onClick={close} className="p-2 rounded-md hover:bg-zinc-800" title="Cerrar">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 min-h-0 relative grid place-items-center">
            <video ref={videoRef} playsInline muted className="max-h-full max-w-full object-contain" />
            {/* Marco guía */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="w-56 h-56 rounded-2xl ring-2 ring-emerald-400/80" />
            </div>
            {starting && (
              <div className="absolute inset-0 grid place-items-center text-zinc-300 gap-2">
                <Loader2 className="animate-spin" size={22} /> Abriendo cámara…
              </div>
            )}
          </div>

          {error && (
            <div className="shrink-0 m-4 rounded-lg bg-red-500/15 text-red-200 ring-1 ring-red-500/40 px-3 py-2 text-sm inline-flex items-start gap-2">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>
      )}
    </>
  )
}
