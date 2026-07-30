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

import { useCallback, useEffect, useState } from 'react'
import { Store, Unlock, Loader2, AlertTriangle } from 'lucide-react'
import { getClosedBrands, setBrandStatus, setBrandStatusByToken, type ClosedBrand } from '../services/kdsService'

interface Props {
  accountId?: string | null
  token?: string | null
  dark?: boolean
}

export default function ClosedBrandsCard({ accountId, token, dark = false }: Props) {
  const [brands, setBrands] = useState<ClosedBrand[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setBrands(await getClosedBrands(accountId ?? null, token))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando marcas cerradas')
    } finally {
      setLoading(false)
    }
  }, [accountId, token])

  useEffect(() => {
    setLoading(true)
    void refresh()
    const id = window.setInterval(() => { void refresh() }, 30_000)
    return () => window.clearInterval(id)
  }, [refresh])

  async function reopen(brandId: string) {
    setBusyId(brandId); setError(null)
    try {
      if (token) await setBrandStatusByToken(token, brandId, 'normal')
      else await setBrandStatus(brandId, 'normal')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reabrir')
    } finally {
      setBusyId(null)
    }
  }

  if (loading || brands.length === 0) return null

  const cardCls = dark ? 'bg-zinc-900 ring-1 ring-zinc-800' : 'bg-white border border-stone-200'

  return (
    <div className={`rounded-xl px-4 py-3 mb-3 ${cardCls}`}>
      <div className="flex items-center gap-2 mb-2">
        <Store size={15} className={dark ? 'text-zinc-500' : 'text-stone-400'} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${dark ? 'text-zinc-400' : 'text-stone-500'}`}>
          {brands.length === 1 ? 'Marca cerrada' : `${brands.length} marcas cerradas`}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {brands.map((b) => (
          <div key={b.brand_id} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <span className={`text-sm truncate ${dark ? 'text-zinc-100' : 'text-stone-800'}`}>{b.brand_name}</span>
              <span className={`text-xs shrink-0 ${dark ? 'text-zinc-500' : 'text-stone-400'}`}>
                {b.resume_at
                  ? `hasta las ${new Date(b.resume_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
                  : 'indefinido'}
              </span>
            </div>
            <button
              onClick={() => void reopen(b.brand_id)}
              disabled={busyId === b.brand_id}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busyId === b.brand_id ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />} Reabrir
            </button>
          </div>
        ))}
      </div>
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-red-500">
          <AlertTriangle size={13} /> {error}
        </div>
      )}
    </div>
  )
}
