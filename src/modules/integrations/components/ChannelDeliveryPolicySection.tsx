// src/modules/integrations/components/ChannelDeliveryPolicySection.tsx
//
// "Quién reparte" según PLATAFORMA × TIPO DE MARCA. ENCARGO CODE (13/08 noche)
// fix/hubrise-service-type-reparto, Tramo 2 — corrige el defecto por el que
// los pedidos de Just Eat (vía HubRise) de marca propia nunca disparaban el
// reparto propio: el webhook fijaba siempre platform_delivery, sin mirar
// plataforma ni marca. Esta matriz es la configuración que el webhook
// consulta (channel_delivery_policy); sin fila para una celda, se aplica el
// valor por defecto seguro (platform_delivery) — no despachar es recuperable,
// despachar de más cuesta dinero real.

import { useEffect, useState } from 'react'
import { Truck, Loader2, AlertCircle, RotateCcw } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import {
  listChannelDeliveryPolicies,
  setChannelDeliveryPolicy,
  clearChannelDeliveryPolicy,
  KNOWN_CHANNELS,
  type ChannelDeliveryPolicy,
  type OwnershipType,
  type DeliveryServiceType,
} from '@/modules/multitenancy/services/channelDeliveryPolicyService'

const OWNERSHIP_COLUMNS: { type: OwnershipType; label: string }[] = [
  { type: 'own', label: 'Marca propia' },
  { type: 'licensed', label: 'Marca cedida' },
]

export default function ChannelDeliveryPolicySection({ accountId }: { accountId: string }) {
  const { authUserId, userProfile } = useApp()
  const [policies, setPolicies] = useState<ChannelDeliveryPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    // Nunca setState síncrono en el cuerpo del efecto: el "cargando" arranca
    // dentro del propio async.
    Promise.resolve()
      .then(() => { if (!cancelled) setLoading(true) })
      .then(() => listChannelDeliveryPolicies(accountId))
      .then(p => { if (!cancelled) setPolicies(p) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando la política de reparto.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, reloadTick])

  function cellKey(channelSlug: string, ownershipType: OwnershipType): string {
    return `${channelSlug}:${ownershipType}`
  }
  function find(channelSlug: string, ownershipType: OwnershipType): ChannelDeliveryPolicy | null {
    return policies.find(p => p.channelSlug === channelSlug && p.ownershipType === ownershipType) ?? null
  }

  async function toggle(channelSlug: string, ownershipType: OwnershipType, current: DeliveryServiceType) {
    const key = cellKey(channelSlug, ownershipType)
    const next: DeliveryServiceType = current === 'own_delivery' ? 'platform_delivery' : 'own_delivery'
    setSavingKey(key); setError(null)
    try {
      await setChannelDeliveryPolicy(accountId, channelSlug, ownershipType, next, {
        createdBy: authUserId ?? null, createdByName: userProfile?.displayName ?? null,
      })
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSavingKey(null)
    }
  }

  async function restoreDefault(channelSlug: string, ownershipType: OwnershipType) {
    const key = cellKey(channelSlug, ownershipType)
    setSavingKey(key); setError(null)
    try {
      await clearChannelDeliveryPolicy(accountId, channelSlug, ownershipType)
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo restaurar.')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="rounded-xl border border-border-default bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
        <Truck size={18} className="text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">Quién reparte según plataforma</h2>
        {loading && <Loader2 size={14} className="animate-spin text-text-secondary ml-auto" />}
      </div>

      <div className="px-4 py-4 space-y-3">
        <p className="text-xs text-text-secondary">
          Cuando llega un pedido de reparto por una de estas plataformas, decide si lo despacha
          Folvy (reparto propio) o si ya lo reparte la propia plataforma. Sin marcar, se aplica el
          valor por defecto seguro: reparte la plataforma.
        </p>

        {error && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-text-secondary flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Cargando…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left font-medium text-text-secondary pb-2 pr-3">Plataforma</th>
                  {OWNERSHIP_COLUMNS.map(c => (
                    <th key={c.type} className="text-left font-medium text-text-secondary pb-2 px-3">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KNOWN_CHANNELS.map(ch => (
                  <tr key={ch.slug} className="border-t border-border-default">
                    <td className="py-2.5 pr-3 font-medium text-text-primary">{ch.label}</td>
                    {OWNERSHIP_COLUMNS.map(col => {
                      const row = find(ch.slug, col.type)
                      const effective: DeliveryServiceType = row?.serviceType ?? 'platform_delivery'
                      const isOwnDelivery = effective === 'own_delivery'
                      const inherited = !row
                      const key = cellKey(ch.slug, col.type)
                      const savingThis = savingKey === key
                      return (
                        <td key={col.type} className="py-2.5 px-3 align-top">
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => void toggle(ch.slug, col.type, effective)}
                              disabled={savingThis}
                              role="switch" aria-checked={isOwnDelivery}
                              aria-label={`Reparto propio de ${ch.label} · ${col.label}`}
                              className={`relative w-10 h-6 rounded-full shrink-0 transition-base disabled:opacity-50 ${isOwnDelivery ? 'bg-accent' : 'bg-page border border-border-default'}`}>
                              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-base ${isOwnDelivery ? 'translate-x-4' : ''}`} />
                            </button>
                            <span className="text-xs text-text-secondary">
                              {isOwnDelivery ? 'Reparte Folvy' : 'Reparte la plataforma'}
                            </span>
                            {savingThis && <Loader2 size={12} className="animate-spin text-text-secondary" />}
                            {!inherited && !savingThis && (
                              <button type="button" onClick={() => void restoreDefault(ch.slug, col.type)}
                                title="Restaurar por defecto (reparte la plataforma)"
                                className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-page transition-base shrink-0">
                                <RotateCcw size={12} />
                              </button>
                            )}
                          </div>
                          {inherited && (
                            <span className="mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-page text-text-tertiary border border-border-default">
                              Por defecto
                            </span>
                          )}
                          {ch.slug === 'uber' && isOwnDelivery && (
                            <p className="mt-1 text-[11px] text-warning max-w-[220px]">
                              ⚠️ Uber Eats siempre trae su propio rider. Activar esto duplica el coste (doble reparto).
                            </p>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
