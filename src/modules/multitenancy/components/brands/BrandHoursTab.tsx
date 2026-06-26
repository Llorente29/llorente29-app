// src/modules/multitenancy/components/brands/BrandHoursTab.tsx
//
// Horario de la marca POR LOCAL, con HERENCIA del horario general del local.
//   - "Heredar del local": la marca usa el horario general del local (no edita
//     aquí; lo gestiona la ficha del local). Se muestra en solo lectura.
//   - "Horario propio": la marca define su propio horario, que sobreescribe al
//     general en is_brand_open.
//
// Si la marca esta en varios locales, un selector elige cual se edita.
// El editor de tramos es BusinessHoursEditor (compartido con la ficha de local).

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../../../context/AppContext'
import { useActiveAccount } from '../../hooks/useActiveAccount'
import { getHours, hasOwnHours, clearOwnHours, type HoursSlot } from '../../services/businessHoursService'
import { listBrandsForLocation, listLocationsForBrand } from '../../services/brandLocationService'
import BusinessHoursEditor, { type CopyTarget } from '../hours/BusinessHoursEditor'
import type { Brand } from '../../../../types/multitenancy'

interface Props {
  brand: Brand
  onBrandChange: (updated: Brand) => void
}

const DAY_LABEL: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 0: 'Dom' }
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export default function BrandHoursTab({ brand }: Props) {
  const { locations } = useApp()
  const { activeAccountId } = useActiveAccount()

  const activeLocations = useMemo(
    () => locations.filter((l) => l.active !== false),
    [locations],
  )

  const [locationId, setLocationId] = useState<string>('')
  const [mode, setMode] = useState<'inherit' | 'own' | null>(null) // null = aún cargando
  const [generalSlots, setGeneralSlots] = useState<HoursSlot[]>([])
  const [loading, setLoading] = useState(false)
  const [copyTargets, setCopyTargets] = useState<CopyTarget[]>([])

  useEffect(() => {
    if (!locationId && activeLocations.length > 0) setLocationId(activeLocations[0].id)
  }, [activeLocations, locationId])

  // Destinos de copia: otras marcas de este local + esta misma marca en otros locales
  useEffect(() => {
    if (!activeAccountId || !locationId) { setCopyTargets([]); return }
    let alive = true
    Promise.all([
      listBrandsForLocation(activeAccountId, locationId),
      listLocationsForBrand(activeAccountId, brand.id),
    ]).then(([brandsHere, locIdsOfBrand]) => {
      if (!alive) return
      const targets: CopyTarget[] = []
      // Otras marcas del MISMO local (su horario propio)
      brandsHere
        .filter((b) => b.id !== brand.id)
        .forEach((b) => targets.push({
          key: `b:${b.id}`,
          label: b.name,
          locationId,
          brandId: b.id,
        }))
      // Esta MISMA marca en OTROS locales
      locIdsOfBrand
        .filter((lid) => lid !== locationId)
        .forEach((lid) => {
          const loc = activeLocations.find((l) => l.id === lid)
          targets.push({
            key: `l:${lid}`,
            label: `Esta marca · ${loc?.name ?? 'otro local'}`,
            locationId: lid,
            brandId: brand.id,
          })
        })
      setCopyTargets(targets)
    }).catch(() => { if (alive) setCopyTargets([]) })
    return () => { alive = false }
  }, [activeAccountId, locationId, brand.id, activeLocations])

  // Al cambiar de local: ¿la marca tiene horario propio? + cargar el general (para mostrarlo si hereda)
  useEffect(() => {
    if (!locationId) return
    let alive = true
    setLoading(true)
    Promise.all([
      hasOwnHours(locationId, brand.id),
      getHours(locationId, null),
    ])
      .then(([own, general]) => {
        if (!alive) return
        setMode(own ? 'own' : 'inherit')
        setGeneralSlots(general)
      })
      .catch(() => { if (alive) setMode('inherit') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [locationId, brand.id])

  async function switchToInherit() {
    if (!locationId) return
    if (!window.confirm('La marca pasará a usar el horario general del local. Se borrará su horario propio en este local. ¿Continuar?')) return
    await clearOwnHours(locationId, brand.id)
    setMode('inherit')
  }

  if (activeLocations.length === 0) {
    return <p className="text-sm text-text-secondary">No hay locales activos para configurar horarios.</p>
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-display font-medium text-text-primary mb-1">Horario de apertura</h3>
        <p className="text-sm text-text-secondary">
          Define cuándo está abierta esta marca. Se usa en tu tienda online y para aceptar pedidos.
        </p>
      </div>

      {activeLocations.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-text-secondary">Local:</label>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {activeLocations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      )}

      {loading || mode === null ? (
        <p className="text-sm text-text-secondary">Cargando horario…</p>
      ) : (
        <>
          <div className="inline-flex rounded-lg border border-border-default overflow-hidden text-sm">
            <button
              type="button"
              onClick={switchToInherit}
              className={'px-3 py-1.5 font-medium ' + (mode === 'inherit' ? 'bg-accent text-text-on-accent' : 'bg-card text-text-secondary hover:text-text-primary')}
            >
              Usar horario del local
            </button>
            <button
              type="button"
              onClick={() => setMode('own')}
              className={'px-3 py-1.5 font-medium ' + (mode === 'own' ? 'bg-accent text-text-on-accent' : 'bg-card text-text-secondary hover:text-text-primary')}
            >
              Horario propio
            </button>
          </div>

          {mode === 'inherit' ? (
            <div className="rounded-md border border-border-default bg-page p-4">
              <p className="text-sm text-text-secondary mb-3">
                Esta marca usa el <strong>horario general del local</strong>. Para cambiarlo, edita el local en Configuración → Locales, o pulsa “Horario propio” para darle un horario distinto.
              </p>
              {generalSlots.length === 0 ? (
                <p className="text-sm text-text-secondary">El local no tiene horario general definido todavía.</p>
              ) : (
                <div className="space-y-1">
                  {DAY_ORDER.map((wd) => {
                    const ds = generalSlots.filter((s) => s.weekday === wd)
                    return (
                      <div key={wd} className="flex items-center gap-3 text-sm">
                        <span className="w-12 text-text-secondary">{DAY_LABEL[wd]}</span>
                        <span className="text-text-primary">
                          {ds.length === 0 ? <span className="text-text-secondary">Cerrado</span>
                            : ds.map((s) => `${s.openTime}–${s.closeTime}`).join('  ·  ')}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            activeAccountId && (
              <BusinessHoursEditor
                accountId={activeAccountId}
                locationId={locationId}
                brandId={brand.id}
                copyTargets={copyTargets}
                copyLabel="otras marcas u otros locales"
              />
            )
          )}
        </>
      )}
    </div>
  )
}
