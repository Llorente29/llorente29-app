// src/modules/multitenancy/components/brands/BrandsListView.tsx
//
// Vista de listado de marcas. Funciones:
//   - Cargar marcas activas/archivadas según filtro
//   - Búsqueda por nombre/slug (delega en service.search)
//   - Filtro por tipo (own / licensed / todas)
//   - Toggle mostrar archivadas
//   - Click en una fila → callback onSelectBrand(id)
//   - Botón "Nueva marca" → abre BrandCreateModal
//
// El listado se recarga automáticamente cuando cambian los filtros
// o tras crear una marca nueva.
//
// BLOQUE B-5 (16/05/2026): migrado de CURRENT_ACCOUNT_ID hardcoded a
// useActiveAccount(). Reacciona al cambio de cuenta automáticamente.

import { useEffect, useState } from 'react'
import { Plus, Search, Tag, Archive, Eye } from 'lucide-react'
import { useActiveAccount } from '../../hooks/useActiveAccount'
import { listBrands } from '../../services/brandsService'
import type { Brand, BrandOwnershipType } from '../../../../types/multitenancy'
import BrandCreateModal from './BrandCreateModal'

interface BrandsListViewProps {
  onSelectBrand: (brandId: string) => void
}

type OwnershipFilter = 'all' | BrandOwnershipType

export default function BrandsListView({ onSelectBrand }: BrandsListViewProps) {
  const { activeAccountId } = useActiveAccount()

  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [search, setSearch] = useState('')
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('all')
  const [includeArchived, setIncludeArchived] = useState(false)

  // Modal de creación
  const [createOpen, setCreateOpen] = useState(false)

  // Reload trigger (para tras crear)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!activeAccountId) {
      setBrands([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    listBrands({
      accountId: activeAccountId,
      search: search.trim() || undefined,
      ownershipType: ownershipFilter === 'all' ? undefined : ownershipFilter,
      includeArchived,
    })
      .then((data) => {
        if (!cancelled) setBrands(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Error desconocido'
          setError(msg)
          setBrands([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeAccountId, search, ownershipFilter, includeArchived, reloadTick])

  return (
    <div className="space-y-4">
      {/* Cabecera con título y botón crear */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-medium text-text-primary">
            Catálogo de marcas
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Gestión de marcas comerciales del grupo
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base"
        >
          <Plus size={16} />
          Nueva marca
        </button>
      </div>

      {/* Barra de filtros */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-md bg-card border border-border-default">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o slug..."
            className="w-full pl-7 pr-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <select
          aria-label="Filtrar por tipo"
          value={ownershipFilter}
          onChange={(e) => setOwnershipFilter(e.target.value as OwnershipFilter)}
          className="px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="all">Todos los tipos</option>
          <option value="own">Propias</option>
          <option value="licensed">Cedidas</option>
        </select>

        <label className="inline-flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          <span>Mostrar archivadas</span>
        </label>
      </div>

      {/* Estados de carga/error/vacío/lista */}
      {loading && (
        <div className="p-8 text-center text-sm text-text-secondary">
          Cargando marcas...
        </div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && brands.length === 0 && (
        <div className="p-8 rounded-md bg-card border border-border-default text-center">
          <Tag size={32} className="mx-auto text-text-secondary mb-2" />
          <p className="text-sm text-text-secondary">
            {search.trim() || ownershipFilter !== 'all'
              ? 'No hay marcas que coincidan con los filtros.'
              : 'Aún no hay marcas creadas. Pulsa "Nueva marca" para empezar.'}
          </p>
        </div>
      )}

      {!loading && !error && brands.length > 0 && (
        <div className="rounded-md bg-card border border-border-default overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-page text-left">
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    Marca
                  </th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide hidden sm:table-cell">
                    Slug
                  </th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    Tipo
                  </th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide hidden md:table-cell">
                    Estado
                  </th>
                  <th className="p-3 w-10" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b border-border-default last:border-0 hover:bg-accent-bg cursor-pointer transition-base"
                    onClick={() => onSelectBrand(b.id)}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-full shrink-0 border border-border-default"
                          style={{ backgroundColor: b.color || '#cbd5e1' }}
                          aria-hidden="true"
                        />
                        <span className="font-medium text-text-primary">
                          {b.name}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 hidden sm:table-cell">
                      <code className="text-xs text-text-secondary">{b.slug}</code>
                    </td>
                    <td className="p-3">
                      <span
                        className={
                          'text-xs px-2 py-0.5 rounded-full font-medium ' +
                          (b.ownershipType === 'own'
                            ? 'bg-accent-bg text-text-primary'
                            : 'bg-warning-bg text-warning')
                        }
                      >
                        {b.ownershipType === 'own' ? 'Propia' : 'Cedida'}
                      </span>
                    </td>
                    <td className="p-3 hidden md:table-cell">
                      {b.archivedAt ? (
                        <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                          <Archive size={12} /> Archivada
                        </span>
                      ) : b.isActive ? (
                        <span className="text-xs text-success">Activa</span>
                      ) : (
                        <span className="text-xs text-text-secondary">Inactiva</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <Eye size={14} className="text-text-secondary inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 text-xs text-text-secondary border-t border-border-default bg-page">
            {brands.length} marca{brands.length === 1 ? '' : 's'}
          </div>
        </div>
      )}

      {/* Modal de creación */}
      {createOpen && (
        <BrandCreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={(newBrandId) => {
            setCreateOpen(false)
            // Tras crear, vamos directamente al detalle de la marca nueva.
            // Esto sigue el flujo "create-then-edit" estándar de SaaS.
            onSelectBrand(newBrandId)
            // Por si el usuario vuelve, la lista debe estar refrescada
            setReloadTick((t) => t + 1)
          }}
        />
      )}
    </div>
  )
}
