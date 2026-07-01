// src/modules/integrations/components/DispatchConfigSection.tsx
//
// Selector de DESPACHO de reparto de un local: modo (automático/manual) + broker
// por defecto. Escribe en locations (dispatch_mode/dispatch_broker), que es lo que
// lee el trigger tg_auto_dispatch. Aparece en la ficha de brokers de reparto.
//
// Guarda al cambiar (optimista, con feedback). Catcher operativo; el resto de
// brokers se muestran como "próximamente" (sin adaptador aún).

import { useEffect, useState } from 'react'
import { Truck, Check, Loader2, AlertCircle } from 'lucide-react'
import {
  getLocationDispatch, setLocationDispatch,
  type DispatchMode, type DispatchBroker,
} from '@/modules/integrations/services/locationDispatchService'

const BROKERS: { code: DispatchBroker; name: string; ready: boolean }[] = [
  { code: 'catcher',     name: 'Catcher',      ready: true },
  { code: 'jelp',        name: 'Jelp delivery', ready: false },
  { code: 'uber_direct', name: 'Uber Direct',  ready: false },
  { code: 'shipday',     name: 'Shipday',      ready: false },
]

export default function DispatchConfigSection({ locationId }: { locationId: string }) {
  const [mode, setMode] = useState<DispatchMode>('auto')
  const [broker, setBroker] = useState<DispatchBroker>('catcher')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getLocationDispatch(locationId)
      .then(d => { if (alive) { setMode(d.mode); setBroker(d.broker) } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [locationId])

  async function persist(patch: { mode?: DispatchMode; broker?: DispatchBroker }) {
    setSaving(true); setError(null)
    try { await setLocationDispatch(locationId, patch) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.') }
    finally { setSaving(false) }
  }

  function chooseMode(m: DispatchMode) {
    if (m === mode) return
    setMode(m); void persist({ mode: m })
  }
  function chooseBroker(b: DispatchBroker) {
    if (b === broker) return
    setBroker(b); void persist({ broker: b })
  }

  return (
    <div className="rounded-xl border border-border-default bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
        <Truck size={18} className="text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">Despacho de este local</h2>
        {saving && <Loader2 size={14} className="animate-spin text-text-secondary ml-auto" />}
      </div>

      <div className="px-4 py-4 space-y-4">
        <p className="text-xs text-text-secondary">
          Cómo se despachan los pedidos de reparto propio de este local.
        </p>

        {loading ? (
          <div className="text-sm text-text-secondary flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Cargando…
          </div>
        ) : (
          <>
            <div className="inline-flex bg-page border border-border-default rounded-lg p-1 gap-1">
              {(['auto', 'manual'] as DispatchMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => chooseMode(m)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-base ${
                    mode === m ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {m === 'auto' ? 'Automático' : 'Manual'}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-secondary -mt-2">
              {mode === 'auto'
                ? 'Al aceptar un pedido de reparto propio, se despacha solo al transportista.'
                : 'Los pedidos se despachan a mano, desde cada pedido.'}
            </p>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Transportista por defecto
              </label>
              <div className="space-y-2">
                {BROKERS.map(b => {
                  const active = broker === b.code
                  return (
                    <button
                      key={b.code}
                      type="button"
                      disabled={!b.ready}
                      onClick={() => b.ready && chooseBroker(b.code)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-base ${
                        active
                          ? 'border-accent bg-accent-bg'
                          : b.ready
                            ? 'border-border-default hover:border-border-strong bg-card'
                            : 'border-border-default bg-page opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <span className={`text-sm font-medium ${b.ready ? 'text-text-primary' : 'text-text-secondary'}`}>{b.name}</span>
                      {b.ready ? (
                        <span className="ml-auto text-[11px] font-medium text-success bg-success-bg px-2 py-0.5 rounded-full">Conectado</span>
                      ) : (
                        <span className="ml-auto text-[11px] font-medium text-text-secondary bg-page border border-border-default px-2 py-0.5 rounded-full">Próximamente</span>
                      )}
                      {active && b.ready && <Check size={15} className="text-accent shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>

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
