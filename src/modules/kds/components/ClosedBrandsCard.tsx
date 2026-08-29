// src/modules/kds/components/ClosedBrandsCard.tsx
//
// FASE B · CAP. B — indicador AMBIENTAL de marcas cerradas (§9-C). Antes el
// estado de una marca solo se veía DENTRO del modal de BrandCloseControl,
// tras buscarla a mano. Esta tarjeta las muestra siempre visibles, con
// reapertura de un toque — mismo espíritu que LocationStatusCard (Cap. C).
//
// closed_brands ya excluye las que tenían resume_at y pasó (HubRise las
// reabrió sola vía expires_at) — por eso no hace falta corregir aquí, a
// diferencia de LocationStatusCard (que sí calcula effectiveMode en cliente:
// aquí la lista entera desaparece de la RPC en cuanto vence, no hay una sola
// entidad que "corregir" en pantalla).
//
// No se muestra nada si no hay ninguna marca cerrada (ambiental de verdad:
// no ocupa sitio cuando no aporta).
//
// fix/sondeo-adaptativo-resto (13/08, Encargo B-bis): closed_brands es una de
// las tres RPC que se escaparon del encargo B. Este es su SEGUNDO sitio de
// sondeo (el primero es ClosuresChip) — se llega aquí también desde
// Disponibilidad (accesible por token en tablet, ver AvailabilityBoard) y
// desde el detalle expandido del propio chip, así que sondeaba por duplicado.
// Mismo techo/suelo que ClosuresChip para el mismo dato: sin cambios ~2 min
// (4 ciclos a 30s) sube hasta 60s; con el local sin actividad real 60 min,
// suelo general de 5 min (B2).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Store, Unlock, Loader2, AlertTriangle } from 'lucide-react'
import { runPollingLoop, type RetryLoopHandle } from '@/lib/retryBackoff'
import { getClosedBrands, setBrandStatus, setBrandStatusByToken, type ClosedBrand } from '../services/kdsService'
import { themeCls } from '../lib/theme'

const POLL_MS = 30_000
const IDLE_MS = 60_000
const IDLE_AFTER = 4

interface Props {
  accountId?: string | null
  token?: string | null
  dark?: boolean
}

// Desde el 01/09/2026 una marca puede salir DOS veces, una por local cerrado.
// La huella y el id de "ocupado" llevan el local o se pisarian entre si.
function filaId(b: { brand_id: string; location_id: string }): string {
  return `${b.brand_id}:${b.location_id}`
}

function brandsFingerprint(brands: ClosedBrand[]): string {
  return brands.map(b => `${filaId(b)}:${b.resume_at ?? ''}`).sort().join(',')
}

export default function ClosedBrandsCard({ accountId, token, dark = false }: Props) {
  const [brands, setBrands] = useState<ClosedBrand[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastFingerprintRef = useRef<string | null>(null)
  const pollHandleRef = useRef<RetryLoopHandle | null>(null)

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const list = await getClosedBrands(accountId ?? null, token)
      setBrands(list)
      setError(null)
      const fp = brandsFingerprint(list)
      const hadWork = lastFingerprintRef.current === null || fp !== lastFingerprintRef.current
      lastFingerprintRef.current = fp
      return hadWork
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando marcas cerradas')
      throw e
    } finally {
      setLoading(false)
    }
  }, [accountId, token])

  useEffect(() => {
    setLoading(true)
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

  async function reopen(brandId: string, locationId: string) {
    setBusyId(`${brandId}:${locationId}`); setError(null)
    try {
      // Con token el local lo pone el dispositivo; desde oficina se reabre el
      // local de ESTA fila, no la marca entera.
      if (token) await setBrandStatusByToken(token, brandId, 'normal')
      else await setBrandStatus(brandId, 'normal', locationId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reabrir')
      setBusyId(null)
      return
    }
    try { await refresh() } catch { /* runPollingLoop reintentará */ }
    pollHandleRef.current?.wake()
    setBusyId(null)
  }

  if (loading || brands.length === 0) return null

  const t = themeCls(dark ? 'dark' : 'light')

  return (
    <div className={`rounded-xl px-4 py-3 mb-3 ${t.card}`}>
      <div className="flex items-center gap-2 mb-2">
        <Store size={15} className={t.textMuted} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${t.textSecondary}`}>
          {brands.length === 1 ? 'Marca cerrada' : `${brands.length} marcas cerradas`}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {brands.map((b) => (
          <div key={filaId(b)} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
              <span className={`text-sm truncate ${t.textPrimary}`}>{b.brand_name}</span>
              <span className={`text-xs shrink-0 ${t.textMuted}`}>{b.location_name}</span>
              <span className={`text-xs shrink-0 ${t.textMuted}`}>
                {b.resume_at
                  ? `hasta las ${new Date(b.resume_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
                  : 'indefinido'}
              </span>
            </div>
            <button
              onClick={() => void reopen(b.brand_id, b.location_id)}
              disabled={busyId === filaId(b)}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold bg-success text-white hover:opacity-90 disabled:opacity-50"
            >
              {busyId === filaId(b) ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />} Reabrir
            </button>
          </div>
        ))}
      </div>
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-danger">
          <AlertTriangle size={13} /> {error}
        </div>
      )}
    </div>
  )
}
