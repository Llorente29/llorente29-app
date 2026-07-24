// src/modules/integrations/components/DeliveryWatchdogSection.tsx
//
// Ajustes del VIGÍA de reparto de un local (Capa 4): activar/desactivar + umbrales
// "en reparto" y "sin cerrar" (minutos). Escribe en delivery_watchdog_config; el cron
// delivery-watchdog los aplica. Guarda optimista (toggle al instante; números al salir
// del campo). Espeja DispatchConfigSection.

import { useEffect, useState } from 'react'
import { AlarmClock, Loader2, AlertCircle } from 'lucide-react'
import {
  getDeliveryWatchdog, setDeliveryWatchdog, WATCHDOG_DEFAULTS,
} from '@/modules/integrations/services/deliveryWatchdogService'

export default function DeliveryWatchdogSection({ locationId }: { locationId: string }) {
  const [enabled, setEnabled] = useState(WATCHDOG_DEFAULTS.enabled)
  const [inDelivery, setInDelivery] = useState(String(WATCHDOG_DEFAULTS.inDeliveryThresholdMinutes))
  const [unsealed, setUnsealed] = useState(String(WATCHDOG_DEFAULTS.unsealedThresholdMinutes))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getDeliveryWatchdog(locationId)
      .then(c => {
        if (!alive) return
        setEnabled(c.enabled)
        setInDelivery(String(c.inDeliveryThresholdMinutes))
        setUnsealed(String(c.unsealedThresholdMinutes))
      })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [locationId])

  async function persist(patch: Parameters<typeof setDeliveryWatchdog>[1]) {
    setSaving(true); setError(null)
    try { await setDeliveryWatchdog(locationId, patch) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.') }
    finally { setSaving(false) }
  }

  function toggleEnabled() {
    const next = !enabled
    setEnabled(next)
    void persist({ enabled: next })
  }

  // Guarda un umbral al salir del campo, saneando (entero ≥ 1). Revierte al valor
  // válido si el usuario dejó algo raro.
  function commitThreshold(kind: 'in' | 'unsealed', raw: string) {
    const n = Math.max(1, Math.round(Number(raw)))
    const valid = Number.isFinite(n) ? n : (kind === 'in' ? 45 : 90)
    if (kind === 'in') {
      setInDelivery(String(valid))
      void persist({ inDeliveryThresholdMinutes: valid })
    } else {
      setUnsealed(String(valid))
      void persist({ unsealedThresholdMinutes: valid })
    }
  }

  return (
    <div className="rounded-xl border border-border-default bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
        <AlarmClock size={18} className="text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">Vigía de reparto</h2>
        {saving && <Loader2 size={14} className="animate-spin text-text-secondary ml-auto" />}
      </div>

      <div className="px-4 py-4 space-y-4">
        <p className="text-xs text-text-secondary">
          Avisa en cocina (banner + sonido) si un pedido de reparto se queda parado demasiado
          tiempo, aunque la plataforma no reporte el fallo.
        </p>

        {loading ? (
          <div className="text-sm text-text-secondary flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Cargando…
          </div>
        ) : (
          <>
            <label className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                onClick={toggleEnabled}
                role="switch"
                aria-checked={enabled}
                className={`relative w-10 h-6 rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-border-default'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`} />
              </button>
              <span className="text-sm font-medium text-text-primary">
                {enabled ? 'Vigía activo' : 'Vigía desactivado'}
              </span>
            </label>

            <div className={`grid grid-cols-2 gap-3 ${enabled ? '' : 'opacity-50 pointer-events-none'}`}>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  «En reparto» (min)
                </label>
                <input
                  type="number"
                  min={1}
                  value={inDelivery}
                  onChange={e => setInDelivery(e.target.value)}
                  onBlur={e => commitThreshold('in', e.target.value)}
                  className="w-full rounded-lg border border-border-default bg-page px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  «Sin cerrar» (min)
                </label>
                <input
                  type="number"
                  min={1}
                  value={unsealed}
                  onChange={e => setUnsealed(e.target.value)}
                  onBlur={e => commitThreshold('unsealed', e.target.value)}
                  className="w-full rounded-lg border border-border-default bg-page px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
            </div>
            <p className="text-xs text-text-secondary -mt-1">
              Por defecto: 45 min en reparto · 90 min sin cerrar.
            </p>

            {error && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
                <AlertCircle size={13} /> {error}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
