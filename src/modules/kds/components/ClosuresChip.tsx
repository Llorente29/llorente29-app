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

import { useCallback, useEffect, useState } from 'react'
import { Store, ChevronDown, ChevronUp } from 'lucide-react'
import { getClosedBrands, getLocationStatus, type ClosedBrand, type LocationStatus } from '../services/kdsService'
import LocationStatusCard from './LocationStatusCard'
import ClosedBrandsCard from './ClosedBrandsCard'

interface Props {
  accountId?: string | null
  locationId: string | null
  token?: string | null
}

export default function ClosuresChip({ accountId, locationId, token }: Props) {
  const [brands, setBrands] = useState<ClosedBrand[]>([])
  const [location, setLocation] = useState<LocationStatus | null>(null)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [b, l] = await Promise.all([
        getClosedBrands(accountId ?? null, token),
        getLocationStatus(locationId, token),
      ])
      setBrands(b)
      setLocation(l)
    } catch {
      /* Silencioso: un fallo del chip NUNCA debe romper Pedidos. */
    }
  }, [accountId, locationId, token])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => { void refresh() }, 30_000)
    return () => window.clearInterval(id)
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
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-danger/30 bg-danger-bg text-danger text-[13.5px] font-bold"
      >
        <span aria-hidden>🔴</span>
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
