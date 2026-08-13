// src/modules/kds/components/ClosureAnomalyAlarm.tsx
//
// CAP. B · PATA 3 — ESCALADA a alarma, mismo patrón visual/estructural que
// KdsAlarmOverlay (banner rojo fijo, no se puede ignorar) — pero SOLO salta
// para cierres de marca ANÓMALOS: indefinidos hace >24h, o con resume_at ya
// vencido y brand.closure_mode aún 'paused'. Un cierre correcto con hora
// futura NUNCA dispara esto — para eso está ClosuresChip (discreto).
//
// availability-watchdog ya detecta esto mismo por email a operaciones cada
// 15 min; esto es la MISMA condición pero en pantalla, para que quien está
// delante lo vea y actúe ya (con Reabrir directo), no solo quien lee el
// correo. No hay "Enterado" (a diferencia de la alarma de reparto): la
// única forma de que desaparezca es que el cierre deje de ser anómalo
// (se reabre, o se le pone una hora) — no se puede posponer un olvido.
//
// Poll cada 30 s (no es tan urgente como un reparto fallido en curso).
//
// fix/sondeo-adaptativo-resto (13/08, Encargo B-bis): anomalous_brand_closures
// era una de las tres RPC que se escaparon del encargo B — sondeaba a 30s
// fijos, ~4/min entre las dos tablets del pase. Es un vigía de anomalías, no
// un dato de servicio (availability-watchdog ya avisa por email cada 15 min):
// sin cambios ~5 min (10 ciclos a 30s) el intervalo sube hasta 2 min. Con el
// local sin actividad real 60 min, baja al suelo general de 5 min (B2).

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Unlock, Loader2 } from 'lucide-react'
import { runPollingLoop, type RetryLoopHandle } from '@/lib/retryBackoff'
import {
  getAnomalousBrandClosures, setBrandStatus, setBrandStatusByToken,
  type AnomalousBrandClosure,
} from '../services/kdsService'

const POLL_MS = 30_000
const IDLE_MS = 120_000
const IDLE_AFTER = 10

interface Props {
  accountId?: string | null
  token?: string | null
  variant?: 'fixed' | 'inline'
}

export default function ClosureAnomalyAlarm({ accountId, token, variant = 'fixed' }: Props) {
  const [closures, setClosures] = useState<AnomalousBrandClosure[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const pollHandleRef = useRef<RetryLoopHandle | null>(null)

  // NOTA: ya no se traga el fallo (antes sí) — sigue sin romper la pantalla
  // (nada renderiza el rechazo), pero ahora runPollingLoop aplica el backoff
  // de fallo, que antes faltaba en este poll.
  const refresh = useCallback(async (): Promise<boolean> => {
    const list = await getAnomalousBrandClosures(accountId ?? null, token)
    setClosures(list)
    return list.length > 0
  }, [accountId, token])

  useEffect(() => {
    const handle = runPollingLoop({
      call: refresh,
      normalIntervalMs: POLL_MS,
      idleIntervalMs: IDLE_MS,
      idleAfter: IDLE_AFTER,
    })
    pollHandleRef.current = handle
    return () => { pollHandleRef.current = null; handle.cancel() }
  }, [refresh])

  async function reopen(brandId: string) {
    setBusyId(brandId)
    try {
      if (token) await setBrandStatusByToken(token, brandId, 'normal')
      else await setBrandStatus(brandId, 'normal')
      await refresh()
      pollHandleRef.current?.wake()
    } catch {
      /* el poll siguiente reconcilia */
    } finally {
      setBusyId(null)
    }
  }

  if (closures.length === 0) return null

  const wrapperCls = variant === 'inline'
    ? 'relative z-25 px-2 sm:px-3 pt-2 sm:pt-3'
    : 'fixed top-0 inset-x-0 z-[58] p-2 sm:p-3'

  return (
    <div className={wrapperCls}>
      <div className="mx-auto max-w-4xl rounded-xl bg-[#E0492E] text-white shadow-[0_10px_40px_rgba(224,73,46,0.5)] ring-2 ring-white/30 animate-pulse">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/20">
          <AlertTriangle size={22} className="shrink-0" />
          <span className="font-extrabold text-[15px] tracking-wide uppercase">
            {closures.length === 1 ? 'Cierre de marca olvidado' : `${closures.length} cierres de marca olvidados`}
          </span>
        </div>

        <ul className="max-h-[50vh] overflow-y-auto divide-y divide-white/15">
          {closures.map((c) => (
            <li key={c.brand_id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-extrabold uppercase tracking-wide bg-white/20 px-2 py-0.5 rounded">
                    {c.kind === 'indefinite' ? 'CERRADA HACE +24H' : 'DEBÍA REABRIR YA'}
                  </span>
                  <span className="font-bold text-[14px]">{c.brand_name}</span>
                </div>
                <div className="text-[12.5px] text-white/85 mt-0.5 truncate">
                  {c.kind === 'indefinite'
                    ? `Cerrada desde ${c.set_at ? new Date(c.set_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?'}, sin hora de reapertura`
                    : `Debía reabrir a las ${c.resume_at ? new Date(c.resume_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '?'}`}
                </div>
              </div>

              <button
                onClick={() => void reopen(c.brand_id)}
                disabled={busyId === c.brand_id}
                className="shrink-0 inline-flex items-center gap-1.5 bg-white text-[#E0492E] font-bold rounded-lg px-3 py-2 text-[13px] disabled:opacity-60"
              >
                {busyId === c.brand_id ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />} Reabrir
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
