// src/modules/integrations/components/AvailabilityConfigSection.tsx
//
// Ajustes de DISPONIBILIDAD (86) de un local: interruptor automático/manual
// (prepara el futuro auto-86 por stock — el gatillo real aún no existe, esto
// solo deja el interruptor listo) + qué otros integradores usa este local
// (Last, Otter…), para que set_product_availability(_by_token) sepa cuándo
// avisar "desconéctalo también ahí". Escribe en locations. Espeja
// DispatchConfigSection.

import { useEffect, useState } from 'react'
import { CircleOff, Loader2, AlertCircle } from 'lucide-react'
import {
  getLocationAvailabilityConfig, setLocationAvailabilityConfig, OTHER_INTEGRATORS,
  type AvailabilityAutoMode,
} from '@/modules/integrations/services/locationAvailabilityService'

export default function AvailabilityConfigSection({ locationId }: { locationId: string }) {
  const [mode, setMode] = useState<AvailabilityAutoMode>('manual')
  const [others, setOthers] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getLocationAvailabilityConfig(locationId)
      .then(c => { if (alive) { setMode(c.mode); setOthers(c.otherIntegrators) } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [locationId])

  async function persist(patch: { mode?: AvailabilityAutoMode; otherIntegrators?: string[] }) {
    setSaving(true); setError(null)
    try { await setLocationAvailabilityConfig(locationId, patch) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.') }
    finally { setSaving(false) }
  }

  function chooseMode(m: AvailabilityAutoMode) {
    if (m === mode) return
    setMode(m); void persist({ mode: m })
  }

  function toggleOther(code: string) {
    const next = others.includes(code) ? others.filter(c => c !== code) : [...others, code]
    setOthers(next); void persist({ otherIntegrators: next })
  }

  return (
    <div className="rounded-xl border border-border-default bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
        <CircleOff size={18} className="text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">Disponibilidad (86) de este local</h2>
        {saving && <Loader2 size={14} className="animate-spin text-text-secondary ml-auto" />}
      </div>

      <div className="px-4 py-4 space-y-4">
        {loading ? (
          <div className="text-sm text-text-secondary flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Cargando…
          </div>
        ) : (
          <>
            <div>
              <div className="inline-flex bg-page border border-border-default rounded-lg p-1 gap-1">
                {(['manual', 'auto'] as AvailabilityAutoMode[]).map(m => (
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
              <p className="text-xs text-text-secondary mt-2">
                {mode === 'auto'
                  ? 'Preparado para el futuro 86 automático por stock (aún no existe el gatillo real: hoy no cambia nada).'
                  : 'El 86 lo hace siempre el operario, a mano. Comportamiento actual.'}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Otros integradores que usa este local
              </label>
              <div className="space-y-1.5">
                {OTHER_INTEGRATORS.map(i => {
                  const checked = others.includes(i.code)
                  return (
                    <label
                      key={i.code}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border-default bg-page cursor-pointer hover:border-border-strong"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOther(i.code)}
                        className="accent-accent"
                      />
                      <span className="text-sm text-text-primary">{i.name}</span>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-text-secondary mt-1.5">
                Folvy NO escribe en ellos. Al agotar un producto aquí, avisa con acuse "desconéctalo también en {others.length > 0 ? OTHER_INTEGRATORS.filter(i => others.includes(i.code)).map(i => i.name).join('/') : '…'}".
              </p>
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
