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
// POR LOCAL desde el 31/08/2026 — `locationId` es obligatorio.
// La tarjeta se pinta también dentro del chip de Pedidos, y ahí listaba los
// cierres de TODA la cuenta con su botón Reabrir: con Alcalá seleccionado
// enseñaba los dos cierres de Carabanchel como si fueran suyos. Ahora hay dos
// bloques y no se pueden confundir:
//   · «cerradas aquí»  → con botón, y el botón dice el local en la confirmación.
//   · «en otros locales» → SOLO LECTURA, etiquetado con el nombre del local.
//     Solo si `mostrarOtrosLocales`. Pedidos lo apaga: es pantalla de servicio
//     y enseña lo del local que la mira, nada más (Julio, 01/09).
//     No se ocultan (regla 7: una pantalla que se abre a propósito no esconde
//     filas) pero no se tocan desde aquí: ver no es tocar.
//
// La reapertura es en DOS PASOS: el primer toque pide confirmación con la
// frase entera —«Reabrir Meraki Pita en Foodint Carabanchel»— y solo el
// segundo llama a la RPC. Reabrir empuja a las plataformas del local: no
// puede salir de un roce en una tablet.
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
import { Store, Unlock, Loader2, AlertTriangle, Eye } from 'lucide-react'
import { runPollingLoop, type RetryLoopHandle } from '@/lib/retryBackoff'
import { getClosedBrandsByScope, setBrandStatus, setBrandStatusByToken, type ClosedBrand } from '../services/kdsService'
import {
  filaId, textoReapertura, textoReabrir, textoMarcasCerradas, textoOtrosLocales,
} from '../lib/closureScope'
import { themeCls } from '../lib/theme'

const POLL_MS = 30_000
const IDLE_MS = 60_000
const IDLE_AFTER = 4

interface Props {
  accountId?: string | null
  token?: string | null
  /**
   * Local seleccionado. OBLIGATORIO y sin default a propósito: hasta el
   * 31/08/2026 esta tarjeta pintaba la cuenta entera sin decirlo. null se
   * escribe a mano y significa que no hay local con el que contrastar
   * (consolidado en Disponibilidad web, o tablet: ahí el token ya acota).
   */
  locationId: string | null
  /**
   * ¿Se pinta el bloque de solo lectura con los cierres de OTROS locales?
   *
   * OBLIGATORIA y sin default, como `locationId` y por lo mismo: la respuesta
   * depende de para qué es la pantalla, y un default la decidiría en silencio.
   *   · Pedidos (vía ClosuresChip) -> false. Pantalla de servicio: enseña lo
   *     del local que la mira y nada más (corrección de Julio, 01/09).
   *   · Cocina → Disponibilidad y tablet -> true. Ahí sí se abre a propósito
   *     para gestionar cierres, y en la tablet el token ya acota, así que el
   *     bloque sale vacío de todas formas.
   */
  mostrarOtrosLocales: boolean
  dark?: boolean
}

function brandsFingerprint(brands: ClosedBrand[]): string {
  return brands.map(b => `${filaId(b)}:${b.resume_at ?? ''}`).sort().join(',')
}

export default function ClosedBrandsCard({ accountId, token, locationId, mostrarOtrosLocales, dark = false }: Props) {
  const [aqui, setAqui] = useState<ClosedBrand[]>([])
  const [otros, setOtros] = useState<ClosedBrand[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Fila pendiente de confirmar la reapertura (null = ninguna).
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastFingerprintRef = useRef<string | null>(null)
  const pollHandleRef = useRef<RetryLoopHandle | null>(null)

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const scope = await getClosedBrandsByScope(accountId ?? null, token, locationId)
      setAqui(scope.aqui)
      setOtros(scope.otrosLocales)
      setError(null)
      const fp = brandsFingerprint([...scope.aqui, ...scope.otrosLocales])
      const hadWork = lastFingerprintRef.current === null || fp !== lastFingerprintRef.current
      lastFingerprintRef.current = fp
      return hadWork
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando marcas cerradas')
      throw e
    } finally {
      setLoading(false)
    }
  }, [accountId, token, locationId])

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

  /**
   * Reabre la fila `b`. Solo se llama desde el bloque «cerradas aquí»: las de
   * otros locales no tienen botón. El local viaja EXPLÍCITO en la llamada —
   * `b.location_id`, el de la fila, nunca "el de la marca".
   *
   * Con token no hay parámetro de local: lo pone el dispositivo. Y no puede
   * descuadrar, porque con token la RPC ya devolvió solo su local (por eso
   * `otrosLocales` viene siempre vacío ahí).
   */
  async function reopen(b: ClosedBrand) {
    setBusyId(filaId(b)); setConfirmId(null); setError(null)
    try {
      if (token) await setBrandStatusByToken(token, b.brand_id, 'normal')
      else await setBrandStatus(b.brand_id, 'normal', b.location_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reabrir')
      setBusyId(null)
      return
    }
    try { await refresh() } catch { /* runPollingLoop reintentará */ }
    pollHandleRef.current?.wake()
    setBusyId(null)
  }

  const otrosVisibles = mostrarOtrosLocales ? otros : []
  if (loading || (aqui.length === 0 && otrosVisibles.length === 0)) return null

  const t = themeCls(dark ? 'dark' : 'light')

  return (
    <div className={`rounded-xl px-4 py-3 mb-3 ${t.card}`}>
      {aqui.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <Store size={15} className={t.textMuted} />
            <span className={`text-xs font-semibold uppercase tracking-wide ${t.textSecondary}`}>
              {aqui.length === 1 ? 'Marca cerrada' : textoMarcasCerradas(aqui.length)}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {aqui.map((b) => (
              <div key={filaId(b)} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
                  <span className={`text-sm truncate ${t.textPrimary}`}>{b.brand_name}</span>
                  <span className={`text-xs shrink-0 ${t.textMuted}`}>{b.location_name}</span>
                  <span className={`text-xs shrink-0 ${t.textMuted}`}>{textoReapertura(b.resume_at)}</span>
                </div>
                {confirmId === filaId(b) ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-xs ${t.textSecondary}`}>
                      ¿{textoReabrir(b.brand_name, b.location_name)}?
                    </span>
                    <button
                      onClick={() => void reopen(b)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold bg-success text-white hover:opacity-90"
                    >
                      <Unlock size={12} /> Sí, reabrir
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className={`px-2 py-1 rounded-md text-xs font-medium ${t.chipNeutral}`}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmId(filaId(b))}
                    disabled={busyId === filaId(b)}
                    title={textoReabrir(b.brand_name, b.location_name)}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold bg-success text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {busyId === filaId(b) ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
                    {' '}Reabrir en {b.location_name}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Otros locales: se ven, no se tocan. Sin botón a propósito — quien
          decide reabrir Carabanchel es Carabanchel. */}
      {otrosVisibles.length > 0 && (
        <div className={aqui.length > 0 ? `mt-3 pt-3 border-t ${t.dividerLight}` : ''}>
          <div className="flex items-center gap-2 mb-2">
            <Eye size={15} className={t.textMuted} />
            <span className={`text-xs font-semibold uppercase tracking-wide ${t.textSecondary}`}>
              {textoOtrosLocales(otrosVisibles.length)}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {otrosVisibles.map((b) => (
              <div key={filaId(b)} className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${dark ? 'bg-zinc-600' : 'bg-stone-300'}`} />
                <span className={`text-sm truncate ${t.textSecondary}`}>{b.brand_name}</span>
                <span className={`text-xs shrink-0 font-medium ${t.textSecondary}`}>{b.location_name}</span>
                <span className={`text-xs shrink-0 ${t.textMuted}`}>{textoReapertura(b.resume_at)}</span>
              </div>
            ))}
          </div>
          <p className={`text-[11px] mt-1.5 ${t.textMuted}`}>
            Se gestionan desde su propio local.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-danger">
          <AlertTriangle size={13} /> {error}
        </div>
      )}
    </div>
  )
}
