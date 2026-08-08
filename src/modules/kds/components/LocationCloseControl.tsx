// src/modules/kds/components/LocationCloseControl.tsx
//
// FASE A · CAP. C — Cerrar local (botón + modal). Gemelo de BrandCloseControl,
// pero a nivel de LOCAL entero: abre/cierra el local en HubRise para TODOS los
// canales. Mismo patrón de UI que "Cerrar marca" (botón disparador → modal:
// elegir duración/reapertura + motivo opcional), reutilizando la MISMA
// maquinaria (set_location_status(_by_token)). Doble puerta (sesión | token).
//
// Diferencia clave con "Cerrar marca": cerrar el local es la acción MÁS
// destructiva de la pantalla (tumba la venta de delivery en todos los canales),
// y la va a pulsar alguien con prisa en plena cocina — por eso NO se ejecuta a
// un toque: tras elegir duración hay un PASO DE CONFIRMACIÓN obligatorio antes
// de llamar a la RPC. Reabrir (restaurar) sí es de un toque: no destruye nada.
//
// Local sin conexión HubRise (connected:false) degrada a aviso: no ofrece el
// cierre (no promete lo que no puede cumplir). Cerrar usa siempre mode='paused'.

import { useCallback, useEffect, useState } from 'react'
import { Power, Lock, Unlock, Loader2, AlertTriangle, X } from 'lucide-react'
import {
  getLocationStatus, setLocationStatus, setLocationStatusByToken,
  type LocationStatus,
} from '../services/kdsService'
import { themeCls } from '../lib/theme'
import ReasonSelect from './ReasonSelect'
import { reasonCodeParam, type ReasonCode } from '../lib/reasonCode'

interface Props {
  /** Local (sesión). En tablet va null: la RPC deriva el local del token. */
  locationId?: string | null
  token?: string | null
  dark?: boolean
  /** Se invoca tras cerrar/reabrir, para que el panel refresque el estado. */
  onChanged?: () => void
}

const DURATIONS: { label: string; minutes: number | null }[] = [
  { label: '30 min', minutes: 30 },
  { label: '1 hora', minutes: 60 },
  { label: '2 horas', minutes: 120 },
  { label: '4 horas', minutes: 240 },
  { label: 'Hasta que reabra a mano', minutes: null },
]

// HubRise reabre SOLO al llegar resume_at (no hay cron en Folvy para esto).
// Si ya pasó, mostramos "normal" aunque la fila de Folvy no se haya reescrito
// todavía (se reescribe en la próxima acción). Mismo criterio que LocationStatusCard.
function effectiveMode(status: LocationStatus | null): LocationStatus['mode'] {
  if (!status) return 'normal'
  if (status.mode !== 'normal' && status.resume_at && new Date(status.resume_at) <= new Date()) {
    return 'normal'
  }
  return status.mode
}

export default function LocationCloseControl({ locationId = null, token, dark = false, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const t = themeCls(dark ? 'dark' : 'light')
  const disabled = !locationId && !token
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? 'Elige un local para gestionar su estado' : undefined}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40 ${t.buttonOutline}`}
      >
        <Power size={16} /> Cerrar local
      </button>
    )
  }
  return (
    <LocationCloseModal
      locationId={locationId}
      token={token}
      dark={dark}
      onChanged={onChanged}
      onClose={() => setOpen(false)}
    />
  )
}

function LocationCloseModal({ locationId, token, dark, onChanged, onClose }: Props & { onClose: () => void }) {
  const [status, setStatus] = useState<LocationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState<ReasonCode | ''>('')
  // Cierre en dos pasos: primero se elige duración (pendiente), luego se
  // confirma explícitamente. null = aún no se ha elegido duración.
  const [pending, setPending] = useState<{ label: string; minutes: number | null } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await getLocationStatus(locationId ?? null, token))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando estado del local')
    } finally {
      setLoading(false)
    }
  }, [locationId, token])

  useEffect(() => { void refresh() }, [refresh])

  async function apply(minutes: number | null) {
    setBusy(true); setError(null)
    try {
      const resumeAt = minutes !== null ? new Date(Date.now() + minutes * 60_000).toISOString() : null
      const code = reasonCodeParam(reasonCode)
      if (token) await setLocationStatusByToken(token, 'paused', resumeAt, 'manual', code)
      else if (locationId) await setLocationStatus(locationId, 'paused', resumeAt, 'manual', code)
      setPending(null)
      setReasonCode('')
      await refresh()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el local')
    } finally {
      setBusy(false)
    }
  }

  async function reopen() {
    setBusy(true); setError(null)
    try {
      if (token) await setLocationStatusByToken(token, 'normal')
      else if (locationId) await setLocationStatus(locationId, 'normal')
      await refresh()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reabrir el local')
    } finally {
      setBusy(false)
    }
  }

  const t = themeCls(dark ? 'dark' : 'light')
  const mode = effectiveMode(status)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`w-full max-w-sm rounded-xl overflow-hidden ${t.panel}`} onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${t.border}`}>
          <h2 className="text-base font-semibold">Cerrar local</h2>
          <button onClick={onClose} className={t.iconButton}>
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          {loading || !status ? (
            <div className="py-6 text-center text-sm opacity-60"><Loader2 size={16} className="animate-spin inline" /></div>
          ) : !status.connected ? (
            <div className={`flex items-start gap-2.5 text-sm ${t.textSecondary}`}>
              <AlertTriangle size={16} className={`${t.textMuted} mt-0.5 shrink-0`} />
              <p>
                {status.location_name} no está conectado a delivery (HubRise). No hay local que cerrar en canales —
                el 86 por producto sigue funcionando.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 mb-3">
                <span className={`w-2.5 h-2.5 rounded-full ${mode === 'normal' ? 'bg-success' : 'bg-danger'}`} />
                <div>
                  <p className="text-sm font-semibold">{status.location_name}</p>
                  <p className={`text-xs ${t.textSecondary}`}>
                    {mode === 'normal'
                      ? 'Abierto para pedidos de delivery'
                      : status.resume_at
                        ? `Cerrado hasta las ${new Date(status.resume_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
                        : 'Cerrado indefinidamente'}
                  </p>
                </div>
              </div>

              {mode !== 'normal' ? (
                <button
                  onClick={() => void reopen()}
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold bg-success text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />} Reabrir ahora
                </button>
              ) : pending ? (
                // PASO DE CONFIRMACIÓN obligatorio antes de ejecutar el cierre.
                <div className={`rounded-lg p-3 bg-danger/10 ring-1 ring-danger/40`}>
                  <div className="flex items-start gap-2 mb-3">
                    <AlertTriangle size={16} className="text-danger mt-0.5 shrink-0" />
                    <p className="text-sm">
                      Vas a cerrar <span className="font-semibold">{status.location_name}</span> en{' '}
                      <span className="font-semibold">todos los canales de delivery</span>. Los clientes no podrán
                      pedir{pending.minutes !== null ? ` durante ${pending.label.toLowerCase()}` : ' hasta que reabras a mano'}.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPending(null)}
                      disabled={busy}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${t.chipNeutral}`}
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => void apply(pending.minutes)}
                      disabled={busy}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold bg-danger text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Sí, cerrar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className={`text-xs mb-2 ${t.textMuted}`}>¿Cuánto tiempo cierra el local?</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DURATIONS.map((d) => (
                      <button
                        key={d.label}
                        onClick={() => setPending(d)}
                        disabled={busy}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${t.chipNeutral}`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className={`text-xs ${t.textMuted}`}>Motivo (opcional):</span>
                    <ReasonSelect value={reasonCode} onChange={setReasonCode} theme={dark ? 'dark' : 'light'} />
                  </div>
                </>
              )}
            </>
          )}

          {error && (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-danger">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
