// src/modules/kds/components/KdsAlarmOverlay.tsx
//
// CAPA 2 — Alarma LOUD de reparto NO ENTREGADO en el KDS. Banner rojo fijo (z alto,
// visible en CUALQUIER pantalla/pestaña) + SONIDO en bucle, que NO desaparece hasta
// que alguien pulsa "Enterado" (ack en BBDD → sobrevive recargas y kiosk↔tablet del
// mismo local). Superficie única: lee kds_alarms (fallo/cancelación hoy; vigía y
// reconciliación de Capas 4/5 escribirán en la misma superficie).
//
// Se monta A NIVEL DE RUTA (KdsKioskRoute / TabletStationRoute), no dentro de KdsBoard,
// para verse aunque la pestaña activa no sea "Cocina". Poll cada 10 s + Realtime
// (solo sesión; el kiosco/tablet por token vive del poll, como el resto del KDS).

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Phone, Check, Bell, BellOff } from 'lucide-react'
import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { getAlarms, ackAlarm, type KdsAlarm } from '../services/kdsService'
import { playAlarmSound } from '../kdsUtils'

const POLL_MS = 10_000
const SOUND_MS = 4_000

interface KdsAlarmOverlayProps {
  /** Local (sesión). En kiosco/tablet va null: la RPC deriva el local del token. */
  locationId: string | null
  token?: string | null
  /** Posicionamiento: 'fixed' (pantalla completa kiosco/tablet, flota arriba del
   *  todo) | 'inline' (dentro del Shell: fluye BAJO el menú superior, sin solaparlo). */
  variant?: 'fixed' | 'inline'
}

function kindLabel(kind: string): string {
  if (kind === 'failed') return 'NO ENTREGADO'
  if (kind === 'canceled' || kind === 'cancelled') return 'REPARTO CANCELADO'
  if (kind.startsWith('stalled')) return 'REPARTO PARADO'
  return 'INCIDENCIA DE REPARTO'
}

export default function KdsAlarmOverlay({ locationId, token, variant = 'fixed' }: KdsAlarmOverlayProps) {
  const [alarms, setAlarms] = useState<KdsAlarm[]>([])
  const [soundOn, setSoundOn] = useState(true)
  const [ackingId, setAckingId] = useState<string | null>(null)
  const soundOnRef = useRef(soundOn)
  soundOnRef.current = soundOn

  const refresh = useCallback(async () => {
    try {
      const res = await getAlarms(locationId, token)
      setAlarms(res.alarms ?? [])
    } catch {
      /* Silencioso: un fallo de la alarma NUNCA debe romper la pantalla de cocina. */
    }
  }, [locationId, token])

  // Carga inicial + poll fiable (fallback del kiosco por token).
  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => { void refresh() }, POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  // Realtime (solo con sesión; el token no autentica Realtime por RLS).
  useEffect(() => {
    if (token) return
    if (!isSupabaseEnabled || !supabase) return
    const sb = supabase
    const ch = sb
      .channel(`kds-alarms-${locationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale' }, () => { void refresh() })
      .subscribe()
    return () => { void sb.removeChannel(ch) }
  }, [locationId, token, refresh])

  // Sonido en bucle mientras haya alarmas sin reconocer.
  useEffect(() => {
    if (alarms.length === 0) return
    if (soundOnRef.current) playAlarmSound()
    const id = window.setInterval(() => {
      if (soundOnRef.current) playAlarmSound()
    }, SOUND_MS)
    return () => window.clearInterval(id)
  }, [alarms.length])

  const handleAck = useCallback(async (saleId: string) => {
    setAckingId(saleId)
    // Optimista: quita la alarma al instante; el poll reconcilia si falla.
    setAlarms(prev => prev.filter(a => a.sale_id !== saleId))
    try { await ackAlarm(saleId, token) }
    catch { void refresh() }
    finally { setAckingId(null) }
  }, [token, refresh])

  if (alarms.length === 0) return null

  // 'fixed' = flota sobre todo (kiosco/tablet a pantalla completa).
  // 'inline' = fluye en la página, BAJO el menú superior del Shell (sin solaparlo).
  const wrapperCls = variant === 'inline'
    ? 'relative z-30 px-2 sm:px-3 pt-2 sm:pt-3'
    : 'fixed top-0 inset-x-0 z-[60] p-2 sm:p-3'

  return (
    <div className={wrapperCls}>
      <div className="mx-auto max-w-4xl rounded-xl bg-[#E0492E] text-white shadow-[0_10px_40px_rgba(224,73,46,0.5)] ring-2 ring-white/30 animate-pulse">
        {/* Cabecera de la alarma */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/20">
          <AlertTriangle size={22} className="shrink-0" />
          <span className="font-extrabold text-[15px] tracking-wide uppercase">
            {alarms.length === 1 ? 'Incidencia de reparto' : `${alarms.length} incidencias de reparto`}
          </span>
          <button
            onClick={() => setSoundOn(s => !s)}
            className="ml-auto shrink-0 flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25"
            title={soundOn ? 'Silenciar el sonido de la alarma' : 'Reactivar el sonido'}
          >
            {soundOn ? <Bell size={14} /> : <BellOff size={14} />}
            {soundOn ? 'Sonando' : 'Silenciada'}
          </button>
        </div>

        {/* Lista de incidencias (cada una con su "Llamar" + "Enterado") */}
        <ul className="max-h-[50vh] overflow-y-auto divide-y divide-white/15">
          {alarms.map(a => (
            <li key={a.sale_id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-extrabold uppercase tracking-wide bg-white/20 px-2 py-0.5 rounded">
                    {kindLabel(a.kind)}
                  </span>
                  {a.code && <span className="font-bold text-[14px]">#{a.code}</span>}
                  {a.rider_name && <span className="text-[13px] text-white/85">· {a.rider_name}</span>}
                </div>
                <div className="text-[12.5px] text-white/85 mt-0.5 truncate">
                  {a.customer_name ?? 'Cliente'}
                  {a.delivery_address && <span className="text-white/70"> · {a.delivery_address}</span>}
                </div>
              </div>

              {a.rider_phone && (
                <a
                  href={`tel:${a.rider_phone.replace(/\s+/g, '')}`}
                  className="shrink-0 inline-flex items-center gap-1.5 bg-white text-[#E0492E] font-bold rounded-lg px-3 py-2 text-[13px] no-underline hover:opacity-90"
                  title={`Llamar al repartidor · ${a.rider_phone}`}
                >
                  <Phone size={14} /> Llamar
                </a>
              )}
              <button
                onClick={() => handleAck(a.sale_id)}
                disabled={ackingId === a.sale_id}
                className="shrink-0 inline-flex items-center gap-1.5 bg-white/20 hover:bg-white/30 font-bold rounded-lg px-3 py-2 text-[13px] disabled:opacity-60"
              >
                <Check size={15} strokeWidth={3} /> Enterado
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
