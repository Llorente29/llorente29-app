// src/modules/kds/components/LocationStatusCard.tsx
//
// FASE A · CAP. C — Estado del local (banner de SOLO LECTURA). Muestra si el
// local está abierto o cerrado para delivery, y hasta cuándo. La ACCIÓN de
// cerrar/reabrir vive ahora en LocationCloseControl (botón "Cerrar local" en
// la cabecera de "Local y marcas"), que exige confirmación antes de ejecutar
// el cierre — la acción más destructiva de la pantalla. Antes esta tarjeta
// llevaba el cierre inline a un toque (sin confirmación): se movió para no
// dejar dos caminos de cierre, uno de ellos sin red de seguridad.
//
// Local sin conexión HubRise (connected:false — hoy Carabanchel/Plaza
// Castilla): degrada a un aviso (el 86 por producto sigue funcionando).

import { useCallback, useEffect, useState } from 'react'
import { Store } from 'lucide-react'
import { getLocationStatus, type LocationStatus } from '../services/kdsService'
import { themeCls } from '../lib/theme'

interface Props {
  /** Local (sesión). En tablet va null: la RPC deriva el local del token. */
  locationId: string | null
  token?: string | null
  /** Estilo tablet (fondo oscuro). */
  dark?: boolean
}

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

  const refresh = useCallback(async () => {
    try {
      setStatus(await getLocationStatus(locationId, token))
    } catch {
      // Silencioso: el banner es informativo; si falla, no ofrecemos nada.
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [locationId, token])

  useEffect(() => { setLoading(true); void refresh() }, [refresh])

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
    </div>
  )
}
