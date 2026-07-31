// src/modules/kds/components/LocationStatusCard.tsx
//
// FASE A · CAP. C — Cerrar local / Reabrir. Tarjeta de estado + acción, doble
// puerta (sesión | token). Vive en la MISMA pantalla donde ya se agota
// producto (Disponibilidad, oficina y tablet): es la misma familia de acción,
// a nivel de LOCAL entero en vez de por producto.
//
// Local sin conexión HubRise (connected:false — hoy Carabanchel/Plaza
// Castilla): degrada a un aviso, sin ofrecer el botón (no promete lo que no
// puede cumplir). "Cerrar local" siempre usa mode='paused' (busy = "acepto
// con retraso", otra función, no la pide este encargo).

import { useCallback, useEffect, useState } from 'react'
import { Store, Lock, Unlock, Loader2, AlertTriangle } from 'lucide-react'
import {
  getLocationStatus, setLocationStatus, setLocationStatusByToken,
  type LocationStatus,
} from '../services/kdsService'
import { themeCls } from '../lib/theme'
import ReasonSelect from './ReasonSelect'
import { reasonCodeParam, type ReasonCode } from '../lib/reasonCode'

interface Props {
  /** Local (sesión). En tablet va null: la RPC deriva el local del token. */
  locationId: string | null
  token?: string | null
  /** Estilo tablet (fondo oscuro). */
  dark?: boolean
}

const DURATIONS: { label: string; minutes: number | null }[] = [
  { label: '30 min', minutes: 30 },
  { label: '1 hora', minutes: 60 },
  { label: '2 horas', minutes: 120 },
  { label: '4 horas', minutes: 240 },
  { label: 'Hasta que reabra a mano', minutes: null },
]

// HubRise reabre SOLO al llegar resume_at (no hay cron en Folvy para esto).
// Corrección de lectura: si ya pasó, mostramos "normal" aunque la fila de
// Folvy no se haya reescrito todavía (se reescribe en la próxima acción).
function effectiveMode(status: LocationStatus | null): LocationStatus['mode'] {
  if (!status) return 'normal'
  if (status.mode !== 'normal' && status.resume_at && new Date(status.resume_at) <= new Date()) {
    return 'normal'
  }
  return status.mode
}

export default function LocationStatusCard({ locationId, token, dark = false }: Props) {
  const [status, setStatus] = useState<LocationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showClose, setShowClose] = useState(false)
  const [reasonCode, setReasonCode] = useState<ReasonCode | ''>('')

  const refresh = useCallback(async () => {
    try {
      const s = await getLocationStatus(locationId, token)
      setStatus(s)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando estado del local')
    } finally {
      setLoading(false)
    }
  }, [locationId, token])

  useEffect(() => { setLoading(true); void refresh() }, [refresh])

  async function apply(minutes: number | null) {
    setBusy(true); setError(null)
    try {
      const resumeAt = minutes !== null ? new Date(Date.now() + minutes * 60_000).toISOString() : null
      const code = reasonCodeParam(reasonCode)
      if (token) await setLocationStatusByToken(token, 'paused', resumeAt, 'manual', code)
      else if (locationId) await setLocationStatus(locationId, 'paused', resumeAt, 'manual', code)
      setShowClose(false)
      setReasonCode('')
      await refresh()
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reabrir el local')
    } finally {
      setBusy(false)
    }
  }

  if (loading || !status) return null

  const mode = effectiveMode(status)
  const t = themeCls(dark ? 'dark' : 'light')

  if (!status.connected) {
    return (
      <div className={`rounded-xl px-4 py-3 mb-4 flex items-center gap-2.5 ${t.card} ${t.textSecondary}`}>
        <Store size={17} className={t.textMuted} />
        <span className="text-sm">{status.location_name} no está conectado a delivery (HubRise) — el 86 por producto sigue funcionando.</span>
      </div>
    )
  }

  return (
    <div className={`rounded-xl px-4 py-3 mb-4 ${t.card}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full ${mode === 'normal' ? 'bg-success' : 'bg-danger'}`} />
          <div>
            <p className={`text-sm font-semibold ${t.textPrimary}`}>{status.location_name}</p>
            <p className={`text-xs ${t.textSecondary}`}>
              {mode === 'normal'
                ? 'Abierto para pedidos de delivery'
                : status.resume_at
                  ? `Cerrado hasta las ${new Date(status.resume_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
                  : 'Cerrado indefinidamente'}
            </p>
          </div>
        </div>
        {mode === 'normal' ? (
          <button
            onClick={() => setShowClose(v => !v)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-danger text-white hover:opacity-90 disabled:opacity-50"
          >
            <Lock size={13} /> Cerrar local
          </button>
        ) : (
          <button
            onClick={() => void reopen()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-success text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Unlock size={13} />} Reabrir ahora
          </button>
        )}
      </div>

      {showClose && mode === 'normal' && (
        <div className={`mt-3 pt-3 border-t ${t.dividerLight}`}>
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map(d => (
              <button
                key={d.label}
                onClick={() => void apply(d.minutes)}
                disabled={busy}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${t.chipNeutral}`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className={`text-xs ${t.textMuted}`}>Motivo (opcional):</span>
            <ReasonSelect value={reasonCode} onChange={setReasonCode} theme={dark ? 'dark' : 'light'} />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-danger">
          <AlertTriangle size={13} /> {error}
        </div>
      )}
    </div>
  )
}
