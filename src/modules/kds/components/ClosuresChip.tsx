// src/modules/kds/components/ClosuresChip.tsx
//
// CAP. B · PATA 3 — aviso al cocinero en SU pantalla de trabajo (Pedidos), no
// solo en Disponibilidad (a la que entra a propósito, no donde vive). Chip
// DISCRETO, mismo patrón visual que KitchenDayBannerBar (píldora arriba de
// Pedidos): de un vistazo, no bloquea. Tocarlo despliega el detalle
// (LocationStatusCard + ClosedBrandsCard, reusados) para ver/reabrir sin
// salir de Pedidos.
//
// Cierre correcto (con hora) -> SOLO este chip discreto, nunca overlay. El
// caso anómalo (indefinido/vencido) lo cubre ClosureAnomalyAlarm aparte —
// dos niveles a propósito, para no saturar con un aviso intrusivo cuando el
// cierre es correcto y el cocinero ya lo sabe.
//
// Si no hay nada cerrado, no se pinta nada (mismo criterio ambiental que
// ClosedBrandsCard/LocationStatusCard).
//
// fix/sondeo-adaptativo-resto (13/08, Encargo B-bis): location_status y
// closed_brands eran dos de las tres RPC que se escaparon del encargo B —
// sondeaban a 30s fijos sin freno, ~4 peticiones/min entre las dos tablets
// del pase. Sin cambios ~2 min (4 ciclos a 30s) el intervalo sube hasta 60s
// — NUNCA más lento en horario de servicio: si una marca se cierra desde la
// oficina, la tablet tiene que enterarse en un tiempo razonable, así que el
// techo se queda corto (60s) a propósito. Con el local sin actividad real
// 60 min, baja al suelo general de 5 min (B2, ver retryBackoff.ts).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Store, ChevronDown, ChevronUp } from 'lucide-react'
import { runPollingLoop, type RetryLoopHandle } from '@/lib/retryBackoff'
import { getClosedBrands, getLocationStatus, type ClosedBrand, type LocationStatus } from '../services/kdsService'
import LocationStatusCard from './LocationStatusCard'
import ClosedBrandsCard from './ClosedBrandsCard'

const POLL_MS = 30_000
const IDLE_MS = 60_000
const IDLE_AFTER = 4

interface Props {
  accountId?: string | null
  locationId: string | null
  token?: string | null
}

// Huella de "qué se ve cerrado": estado del local + marcas cerradas (id +
// hasta cuándo). Un cambio aquí es justo lo que el chip existe para avisar.
function closuresFingerprint(location: LocationStatus | null, brands: ClosedBrand[]): string {
  const loc = location ? `${location.mode}:${location.resume_at ?? ''}:${location.connected ? 1 : 0}` : ''
  const b = brands.map(x => `${x.brand_id}:${x.resume_at ?? ''}`).sort().join(',')
  return `${loc}|${b}`
}

export default function ClosuresChip({ accountId, locationId, token }: Props) {
  const [brands, setBrands] = useState<ClosedBrand[]>([])
  const [location, setLocation] = useState<LocationStatus | null>(null)
  const [open, setOpen] = useState(false)
  const lastFingerprintRef = useRef<string | null>(null)
  const pollHandleRef = useRef<RetryLoopHandle | null>(null)

  // NOTA: ya no se traga el fallo (antes sí, "un fallo del chip nunca debe
  // romper Pedidos") — sigue sin romper la pantalla (nada pinta el rechazo),
  // pero ahora runPollingLoop se entera y aplica el backoff de fallo, que
  // antes faltaba en este poll.
  const refresh = useCallback(async (): Promise<boolean> => {
    const [b, l] = await Promise.all([
      getClosedBrands(accountId ?? null, token),
      getLocationStatus(locationId, token),
    ])
    setBrands(b)
    setLocation(l)
    const fp = closuresFingerprint(l, b)
    const hadWork = lastFingerprintRef.current === null || fp !== lastFingerprintRef.current
    lastFingerprintRef.current = fp
    return hadWork
  }, [accountId, locationId, token])

  useEffect(() => {
    lastFingerprintRef.current = null
    const handle = runPollingLoop({
      call: refresh,
      normalIntervalMs: POLL_MS,
      idleIntervalMs: IDLE_MS,
      idleAfter: IDLE_AFTER,
    })
    pollHandleRef.current = handle
    return () => { pollHandleRef.current = null; handle.cancel() }
  }, [refresh])

  const locationClosed = !!location && location.connected && location.mode !== 'normal'
    && (!location.resume_at || new Date(location.resume_at) > new Date())
  const brandsCount = brands.length

  if (!locationClosed && brandsCount === 0) return null

  // Próxima reapertura conocida (el chip solo la muestra si TODO lo cerrado
  // tiene hora — si algo es indefinido, no promete una hora que no hay).
  const allResumeAts = [
    ...(locationClosed && location?.resume_at ? [location.resume_at] : []),
    ...brands.map((b) => b.resume_at).filter((x): x is string => !!x),
  ]
  const anyIndefinite = (locationClosed && !location?.resume_at) || brands.some((b) => !b.resume_at)
  const nextResume = !anyIndefinite && allResumeAts.length > 0
    ? allResumeAts.sort()[0]
    : null

  const label = locationClosed
    ? 'Local cerrado'
    : brandsCount === 1 ? '1 marca cerrada' : `${brandsCount} marcas cerradas`

  return (
    <div className="px-5 pt-3 bg-page">
      <button
        onClick={() => { setOpen((v) => !v); pollHandleRef.current?.wake() }}
        className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-danger/30 bg-danger-bg text-danger text-[13.5px] font-bold"
      >
        <span className="w-2 h-2 rounded-full bg-danger shrink-0" aria-hidden />
        <Store size={15} />
        <span className="flex items-center gap-1.5 flex-wrap">
          <span>{label}</span>
          {nextResume && (
            <span className="font-semibold opacity-90">
              · reabre {new Date(nextResume).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {anyIndefinite && <span className="font-semibold opacity-90">· indefinido</span>}
        </span>
        {open ? <ChevronUp size={15} className="ml-auto" /> : <ChevronDown size={15} className="ml-auto" />}
      </button>

      {open && (
        <div className="mt-2">
          {locationId && <LocationStatusCard locationId={locationId} token={token} />}
          <ClosedBrandsCard accountId={accountId} token={token} />
        </div>
      )}
    </div>
  )
}
