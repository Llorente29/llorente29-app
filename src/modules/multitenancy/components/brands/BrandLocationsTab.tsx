// src/modules/multitenancy/components/brands/BrandLocationsTab.tsx
//
// Tab "Disponibilidad" del detalle de marca. Muestra los locales de la
// cuenta con un toggle por cada uno indicando si la marca está disponible.
//
// COMPORTAMIENTO:
//   - Carga (1) las locations del context y (2) la disponibilidad actual
//     de esta marca via getBrandAvailability para cada location.
//   - Cada toggle se opera de forma optimista:
//       · ON  → setBrandAvailability (upsert, activa)
//       · OFF → removeBrandAvailability (soft delete: is_active=false)
//   - Si la operación falla, revierte el toggle y muestra error.
//
// IMPORTANTE: NO consume el activeLocationId global del header. Aquí
// vemos siempre TODOS los locales (no se filtra por el selector activo)
// porque el caso de uso es "asignar marca a varios locales", no
// "operar dentro de un local".
//
// BLOQUE B-5 (16/05/2026): migrado de CURRENT_ACCOUNT_ID hardcoded a
// useActiveAccount(). useEffect tolera null (carga inicial); los handlers
// usan requireActiveAccountId() porque si llegan sin cuenta es bug
// programático (el componente ya debería haber renderizado loading).

import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { useApp } from '../../../../context/AppContext'
import { useActiveAccount } from '../../hooks/useActiveAccount'
import {
  getBrandAvailability,
  setBrandAvailability,
  removeBrandAvailability,
} from '../../services/brandLocationService'
import type { Brand } from '../../../../types/multitenancy'

interface BrandLocationsTabProps {
  brand: Brand
  onBrandChange: (updated: Brand) => void
}

interface LocationRow {
  id: string
  name: string
  active: boolean // si la marca está activa en ese local
  loading: boolean
}

// onBrandChange recibido por contrato del container pero NO usado:
// modificar la disponibilidad NO cambia la entidad Brand en sí.
// Lo declaramos con `void` para silenciar el linter sin omitir el contrato.
function silenceUnused(_: unknown): void {
  /* no-op */
}

export default function BrandLocationsTab({ brand, onBrandChange }: BrandLocationsTabProps) {
  silenceUnused(onBrandChange)

  const { locations } = useApp()
  const { activeAccountId, requireActiveAccountId } = useActiveAccount()
  const [rows, setRows] = useState<LocationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeAccountId) {
      setRows([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    const activeLocations = locations.filter((l) => l.active !== false)

    Promise.all(
      activeLocations.map((loc) =>
        getBrandAvailability(activeAccountId, brand.id, loc.id)
          .then((avail) => ({
            id: loc.id,
            name: loc.name,
            // active = hay row y su is_active es true
            active: avail !== null && avail.isActive,
            loading: false,
          }))
          .catch((err: unknown) => {
            console.error(`[BrandLocationsTab] Error loading availability for ${loc.id}:`, err)
            return {
              id: loc.id,
              name: loc.name,
              active: false,
              loading: false,
            }
          })
      )
    )
      .then((computedRows) => {
        if (!cancelled) {
          // Orden alfabético por nombre para estabilidad visual
          computedRows.sort((a, b) => a.name.localeCompare(b.name, 'es'))
          setRows(computedRows)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeAccountId, brand.id, locations])

  async function handleToggle(locationId: string, nextActive: boolean) {
    // Update optimista
    setRows((prev) =>
      prev.map((r) => (r.id === locationId ? { ...r, active: nextActive, loading: true } : r))
    )
    setError(null)

    try {
      const accountId = requireActiveAccountId()
      if (nextActive) {
        await setBrandAvailability({
          accountId,
          brandId: brand.id,
          locationId,
          isActive: true,
        })
      } else {
        await removeBrandAvailability(accountId, brand.id, locationId)
      }
      // OK: solo apagamos el loading flag
      setRows((prev) =>
        prev.map((r) => (r.id === locationId ? { ...r, loading: false } : r))
      )
    } catch (err: unknown) {
      // Revertir
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
      setRows((prev) =>
        prev.map((r) =>
          r.id === locationId ? { ...r, active: !nextActive, loading: false } : r
        )
      )
    }
  }

  const activeCount = rows.filter((r) => r.active).length
  const totalCount = rows.length

  return (
    <div className="space-y-4 mt-4">
      <div className="text-sm text-text-secondary">
        Marca disponibilidad de <strong className="text-text-primary">{brand.name}</strong> por
        local. Esto controla en qué locales puede operar la marca.
      </div>

      {error && (
        <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="p-8 text-center text-sm text-text-secondary">
          Cargando disponibilidad...
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="p-8 rounded-md bg-card border border-border-default text-center">
          <MapPin size={32} className="mx-auto text-text-secondary mb-2" />
          <p className="text-sm text-text-secondary">
            No hay locales activos en la cuenta. Crea locales antes de asignar disponibilidad.
          </p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div className="rounded-md bg-card border border-border-default overflow-hidden">
            {rows.map((row, idx) => (
              <div
                key={row.id}
                className={
                  'flex items-center justify-between gap-3 p-3 ' +
                  (idx < rows.length - 1 ? 'border-b border-border-default' : '')
                }
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin size={16} className="text-text-secondary shrink-0" />
                  <span className="text-sm text-text-primary truncate">{row.name}</span>
                </div>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <span
                    className={
                      'text-xs ' + (row.active ? 'text-success' : 'text-text-secondary')
                    }
                  >
                    {row.active ? 'Disponible' : 'No disponible'}
                  </span>
                  <input
                    type="checkbox"
                    checked={row.active}
                    onChange={(e) => handleToggle(row.id, e.target.checked)}
                    disabled={row.loading}
                    className="cursor-pointer"
                  />
                </label>
              </div>
            ))}
          </div>

          <div className="text-xs text-text-secondary">
            {activeCount} de {totalCount} locales con la marca disponible.
          </div>
        </>
      )}
    </div>
  )
}
