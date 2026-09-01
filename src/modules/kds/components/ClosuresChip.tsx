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
// ── POR LOCAL desde el 31/08/2026 ────────────────────────────────────────
// ESTE es el banner del incidente. El 31/08 a las ~17:30, con Foodint Alcalá
// seleccionado, decía «2 marcas cerradas · indefinido» y ofrecía Reabrir en
// las dos: eran Meraki Pita y Milanesa House, las dos de Foodint Carabanchel.
// Leía closed_brands sin filtrar por el local seleccionado — la escritura ya
// era por local desde el 29/08, este lector se quedó siendo global.
//
// Ahora el titular cuenta SOLO lo de este local, y hay tres estados:
//   · cerrado aquí          -> píldora roja, «N marcas cerradas» = verdad aquí.
//   · nada aquí, algo fuera -> píldora NEUTRA (gris), «Aquí todo abierto ·
//                              N marcas cerradas en otros locales». No alarma
//                              con lo que no es suyo, pero no lo esconde
//                              (regla 7: el umbral ordena, no esconde).
//   · nada en ningún sitio  -> no se pinta nada.
// El detalle desplegado (ClosedBrandsCard) separa igual: las de aquí con
// botón, las de fuera solo lectura y con el nombre de su local.
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
import { getClosedBrandsByScope, getLocationStatus, type ClosedBrand, type LocationStatus } from '../services/kdsService'
import { filaId, textoReaperturaChip, textoMarcasCerradas, textoOtrosLocales } from '../lib/closureScope'
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
// Entran las dos mitades: que se cierre algo en otro local también cambia lo
// que se ve (la línea gris), y el poll tiene que enterarse.
function closuresFingerprint(location: LocationStatus | null, aqui: ClosedBrand[], otros: ClosedBrand[]): string {
  const loc = location ? `${location.mode}:${location.resume_at ?? ''}:${location.connected ? 1 : 0}` : ''
  const huella = (xs: ClosedBrand[]) => xs.map(x => `${filaId(x)}:${x.resume_at ?? ''}`).sort().join(',')
  return `${loc}|${huella(aqui)}|${huella(otros)}`
}

export default function ClosuresChip({ accountId, locationId, token }: Props) {
  const [aqui, setAqui] = useState<ClosedBrand[]>([])
  const [otros, setOtros] = useState<ClosedBrand[]>([])
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
      getClosedBrandsByScope(accountId ?? null, token, locationId),
      getLocationStatus(locationId, token),
    ])
    setAqui(b.aqui)
    setOtros(b.otrosLocales)
    setLocation(l)
    const fp = closuresFingerprint(l, b.aqui, b.otrosLocales)
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

  // Lo que hay cerrado AQUÍ. Es lo único que enciende la píldora roja.
  const cerradoAqui = locationClosed || aqui.length > 0

  if (!cerradoAqui && otros.length === 0) return null

  // Próxima reapertura conocida (el chip solo la muestra si TODO lo cerrado
  // AQUÍ tiene hora — si algo no la tiene, no promete una hora que no hay).
  const allResumeAts = [
    ...(locationClosed && location?.resume_at ? [location.resume_at] : []),
    ...aqui.map((b) => b.resume_at).filter((x): x is string => !!x),
  ]
  const anySinFecha = (locationClosed && !location?.resume_at) || aqui.some((b) => !b.resume_at)
  const nextResume = !anySinFecha && allResumeAts.length > 0 ? allResumeAts.sort()[0] : null

  const label = locationClosed
    ? 'Local cerrado'
    : aqui.length > 0
      ? textoMarcasCerradas(aqui.length)
      : 'Aquí todo abierto'

  // Rojo solo si el cierre es de este local. Si lo único cerrado está en otro
  // sitio, la píldora es neutra: informa, no alarma con lo ajeno.
  const pillCls = cerradoAqui
    ? 'border-danger/30 bg-danger-bg text-danger'
    : 'border-border-default bg-card text-text-secondary'

  return (
    <div className="px-5 pt-3 bg-page">
      <button
        onClick={() => { setOpen((v) => !v); pollHandleRef.current?.wake() }}
        className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[13.5px] font-bold ${pillCls}`}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${cerradoAqui ? 'bg-danger' : 'bg-stone-300'}`}
          aria-hidden
        />
        <Store size={15} />
        <span className="flex items-center gap-1.5 flex-wrap">
          <span>{label}</span>
          {cerradoAqui && nextResume && (
            <span className="font-semibold opacity-90">· {textoReaperturaChip(nextResume)}</span>
          )}
          {cerradoAqui && anySinFecha && (
            <span className="font-semibold opacity-90">· sin fecha de reapertura</span>
          )}
          {otros.length > 0 && (
            <span className="font-semibold opacity-80">· {textoOtrosLocales(otros.length)}</span>
          )}
        </span>
        {open ? <ChevronUp size={15} className="ml-auto" /> : <ChevronDown size={15} className="ml-auto" />}
      </button>

      {open && (
        <div className="mt-2">
          {locationId && <LocationStatusCard locationId={locationId} token={token} />}
          <ClosedBrandsCard accountId={accountId} token={token} locationId={locationId} />
        </div>
      )}
    </div>
  )
}
