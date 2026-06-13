// src/modules/kds/components/FamilyRoutingSettings.tsx
//
// Ajustes · Ruteo familia → estación. Cada familia de plato se asigna a una
// estación. ESTO es lo que QUITA los station_id:null del tablero (cajón "Sin
// estación"). Upsert por account_id+family_id.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ArrowRight } from 'lucide-react'
import { Select } from '../../../components/ui'
import {
  listDishFamilies, listFamilyRoutes, setFamilyRoute, listStations,
  type DishFamily, type FamilyRoute, type KitchenStation,
} from '../services/kdsService'

interface Props { accountId: string; locationId: string }

export default function FamilyRoutingSettings({ accountId, locationId }: Props) {
  const [families, setFamilies] = useState<DishFamily[]>([])
  const [routes, setRoutes] = useState<FamilyRoute[]>([])
  const [stations, setStations] = useState<KitchenStation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [fam, rts, sts] = await Promise.all([
        listDishFamilies(accountId),
        listFamilyRoutes(accountId),
        listStations(accountId, locationId),
      ])
      setFamilies(fam)
      setRoutes(rts)
      setStations(sts.filter(s => s.isActive))
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando el ruteo')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [accountId, locationId])

  const routeByFamily = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of routes) m.set(r.familyId, r.stationId)
    return m
  }, [routes])

  async function handleChange(familyId: string, stationId: string) {
    setSavingId(familyId)
    try {
      await setFamilyRoute(accountId, familyId, stationId || null)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error guardando el ruteo')
    } finally {
      setSavingId(null)
    }
  }

  const sinRutear = families.filter(f => !routeByFamily.has(f.id)).length

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Asigna cada familia de plato a una estación. Mientras una familia esté sin asignar, sus platos
        caen al cajón <strong>«Sin estación»</strong> del tablero.
      </p>

      {sinRutear > 0 && (
        <div className="text-sm rounded-md bg-warning-bg text-warning border border-warning/20 px-3 py-2">
          {sinRutear} familia{sinRutear === 1 ? '' : 's'} sin estación asignada.
        </div>
      )}
      {error && <div className="text-sm text-danger">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary py-6"><Loader2 className="animate-spin" size={18} /> Cargando…</div>
      ) : families.length === 0 ? (
        <p className="text-sm text-text-secondary py-4">No hay familias de plato en la cuenta.</p>
      ) : stations.length === 0 ? (
        <p className="text-sm text-text-secondary py-4">Crea estaciones en este local antes de rutear las familias.</p>
      ) : (
        <ul className="divide-y divide-border-default rounded-lg border border-border-default">
          {families.map(f => {
            const current = routeByFamily.get(f.id) ?? ''
            return (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex-1 font-medium text-text-primary">{f.name}</span>
                <ArrowRight size={15} className="text-text-secondary shrink-0" />
                <div className="w-52 relative">
                  <Select
                    value={current}
                    onChange={e => void handleChange(f.id, e.target.value)}
                    disabled={savingId === f.id}
                    className={current ? '' : 'text-text-secondary'}
                  >
                    <option value="">— Sin estación —</option>
                    {stations.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                  {savingId === f.id && (
                    <Loader2 className="animate-spin absolute right-8 top-2.5 text-text-secondary" size={15} />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
