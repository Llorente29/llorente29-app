// src/modules/kds/components/AvailabilityNoticeOverlay.tsx
//
// AVISO MULTI-INTEGRADOR — banner (no alarma sonora) que recuerda desconectar
// un producto también en los otros integradores del local (Last, Otter…) tras
// un 86 de Folvy. Se monta en las MISMAS rutas que KdsAlarmOverlay (mismo
// patrón de props: locationId | token, variant), justo debajo de la alarma de
// reparto si ambas coinciden. Solo aparece cuando el local declara
// availability_other_integrators (si no, availability_notices no devuelve nada).
//
// Poll cada 20 s (no es tan urgente como la alarma de reparto: no lleva sonido
// ni Realtime, para no competir con ella). "Hecho" sella el acuse en BBDD
// (sobrevive recargas y kiosk↔tablet del mismo local).

import { useCallback, useEffect, useState } from 'react'
import { PlugZap, Check } from 'lucide-react'
import { getAvailabilityNotices, ackAvailabilityNotice, type AvailabilityNotice } from '../services/kdsService'

const POLL_MS = 20_000

interface AvailabilityNoticeOverlayProps {
  /** Local (sesión). En kiosco/tablet va null: la RPC deriva el local del token. */
  locationId: string | null
  token?: string | null
  /** 'fixed' (flota, pantalla completa) | 'inline' (fluye bajo el menú del Shell). */
  variant?: 'fixed' | 'inline'
}

const INTEGRATOR_LABELS: Record<string, string> = {
  last: 'Last', lastapp: 'Last', otter: 'Otter', deliverect: 'Deliverect',
}
function integratorLabel(code: string): string {
  return INTEGRATOR_LABELS[code.toLowerCase()] ?? code
}

export default function AvailabilityNoticeOverlay({ locationId, token, variant = 'fixed' }: AvailabilityNoticeOverlayProps) {
  const [notices, setNotices] = useState<AvailabilityNotice[]>([])
  const [ackingId, setAckingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await getAvailabilityNotices(locationId, token)
      setNotices(res.notices ?? [])
    } catch {
      /* Silencioso: un fallo del aviso NUNCA debe romper la pantalla de cocina. */
    }
  }, [locationId, token])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => { void refresh() }, POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  const handleAck = useCallback(async (noticeId: string) => {
    setAckingId(noticeId)
    setNotices(prev => prev.filter(n => n.id !== noticeId)) // optimista
    try { await ackAvailabilityNotice(noticeId, token) }
    catch { void refresh() }
    finally { setAckingId(null) }
  }, [token, refresh])

  if (notices.length === 0) return null

  const wrapperCls = variant === 'inline'
    ? 'relative z-20 px-2 sm:px-3 pt-2 sm:pt-3'
    : 'fixed top-0 inset-x-0 z-[55] p-2 sm:p-3'

  return (
    <div className={wrapperCls}>
      <div className="mx-auto max-w-4xl rounded-xl bg-amber-500 text-amber-950 shadow-[0_10px_30px_rgba(217,119,6,0.4)] ring-2 ring-amber-300/60">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-amber-600/30">
          <PlugZap size={19} className="shrink-0" />
          <span className="font-extrabold text-[13px] tracking-wide uppercase">
            {notices.length === 1 ? 'Desconecta también en otro integrador' : `${notices.length} productos por desconectar en otro integrador`}
          </span>
        </div>

        <ul className="max-h-[40vh] overflow-y-auto divide-y divide-amber-600/25">
          {notices.map(n => (
            <li key={n.id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1 text-[13px]">
                <span className="font-bold">{n.product_name}</span>
                <span className="text-amber-900/80"> agotado → desconéctalo en </span>
                <span className="font-semibold">{n.integrators.map(integratorLabel).join(' / ')}</span>
              </div>
              <button
                onClick={() => handleAck(n.id)}
                disabled={ackingId === n.id}
                className="shrink-0 inline-flex items-center gap-1.5 bg-amber-950/10 hover:bg-amber-950/20 font-bold rounded-lg px-3 py-1.5 text-[12.5px] disabled:opacity-60"
              >
                <Check size={14} strokeWidth={3} /> Hecho
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
