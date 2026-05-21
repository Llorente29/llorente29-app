// src/modules/multitenancy/components/BrandFilterSelector.tsx
//
// Filtro multi-select de marcas en el header. Hermano del LocationSelector.
//
// COMPORTAMIENTO:
//   - Botón compacto que muestra el estado actual:
//       · Sin marcas creadas    → "Sin marcas" (deshabilitado)
//       · []                    → "Todas las marcas"
//       · [una marca]           → nombre de esa marca
//       · [2+ marcas]           → "N marcas seleccionadas"
//   - Al hacer clic, abre un dropdown con:
//       · Checkbox "Todas" (sincroniza con [])
//       · Lista de marcas activas con checkbox individual
//   - Persistencia: NO (vive en memoria, decidido en AppContext)
//   - Las marcas se cargan al montar y cada vez que cambia activeAccountId.
//     Si el admin crea una marca en BrandsPage, debe recargar la app
//     para verla aquí (TODO menor: refrescar al cerrar BrandsPage).
//
// BLOQUE B-5 (16/05/2026): migrado de CURRENT_ACCOUNT_ID hardcoded a
// useActiveAccount(). Ahora reacciona correctamente al cambio de cuenta:
// si el user pasa de Llorente29 a Folvy Interno, las marcas se recargan.

import { useEffect, useRef, useState } from 'react'
import { useLocationScope } from '../hooks/useLocationScope'
import { useActiveAccount } from '../hooks/useActiveAccount'
import { listBrands } from '../services/brandsService'
import type { Brand } from '../../../types/multitenancy'

interface BrandFilterSelectorProps {
  /** Clases extra que se concatenan al className por defecto. */
  className?: string
}

export default function BrandFilterSelector({ className = '' }: BrandFilterSelectorProps) {
  const { activeBrandFilter, setActiveBrandFilter } = useLocationScope()
  const { activeAccountId } = useActiveAccount()

  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Carga de marcas. Se dispara al montar y al cambiar activeAccountId.
  // Si no hay cuenta activa (carga inicial), vaciamos y dejamos loading=false.
  useEffect(() => {
    if (!activeAccountId) {
      setBrands([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    listBrands({
      accountId: activeAccountId,
      includeArchived: false,
      includeInactive: false,
    })
      .then((data) => {
        if (!cancelled) setBrands(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('[BrandFilterSelector] Error cargando marcas:', err)
          setBrands([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeAccountId])

  // Cerrar el dropdown al hacer clic fuera.
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  // Cerrar con Escape para accesibilidad
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function toggleBrand(brandId: string) {
    if (activeBrandFilter.includes(brandId)) {
      setActiveBrandFilter(activeBrandFilter.filter((id) => id !== brandId))
    } else {
      setActiveBrandFilter([...activeBrandFilter, brandId])
    }
  }

  function selectAll() {
    setActiveBrandFilter([])
  }

  // Texto del botón según el estado
  function buttonLabel(): string {
    if (loading) return 'Cargando…'
    if (brands.length === 0) return 'Sin marcas'
    if (activeBrandFilter.length === 0) return 'Todas las marcas'
    if (activeBrandFilter.length === 1) {
      const single = brands.find((b) => b.id === activeBrandFilter[0])
      return single ? single.name : '1 marca'
    }
    return `${activeBrandFilter.length} marcas`
  }

  const disabled = loading || brands.length === 0

  return (
    <div ref={containerRef} className={'relative ' + className}>
      <button
        type="button"
        aria-label="Filtro de marcas"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={
          brands.length === 0
            ? 'No hay marcas creadas'
            : 'Filtrar por marcas (multi-selección)'
        }
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={
          'border border-border-default rounded-md px-2 py-1 text-xs ' +
          'bg-card text-text-primary cursor-pointer ' +
          'focus:outline-none focus:ring-1 focus:ring-accent ' +
          'max-w-[180px] truncate ' +
          'disabled:opacity-50 disabled:cursor-not-allowed ' +
          'inline-flex items-center gap-1'
        }
      >
        <span className="truncate">{buttonLabel()}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          aria-hidden="true"
          className="shrink-0"
        >
          <path d="M1 3l4 4 4-4z" />
        </svg>
      </button>

      {open && brands.length > 0 && (
        <div
          role="listbox"
          aria-label="Marcas disponibles"
          className={
            'absolute right-0 mt-1 min-w-[200px] max-h-[300px] overflow-y-auto ' +
            'bg-card border border-border-default rounded-md shadow-lg z-40 ' +
            'py-1'
          }
        >
          {/* Opción "Todas" */}
          <button
            type="button"
            onClick={selectAll}
            className={
              'w-full text-left px-3 py-1.5 text-xs ' +
              'hover:bg-page text-text-primary ' +
              'inline-flex items-center gap-2 ' +
              (activeBrandFilter.length === 0 ? 'font-semibold' : '')
            }
          >
            <input
              type="checkbox"
              checked={activeBrandFilter.length === 0}
              readOnly
              tabIndex={-1}
              className="pointer-events-none"
            />
            <span>Todas las marcas</span>
          </button>
          <div className="my-1 border-t border-border-default" />
          {brands.map((b) => {
            const checked = activeBrandFilter.includes(b.id)
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggleBrand(b.id)}
                className={
                  'w-full text-left px-3 py-1.5 text-xs ' +
                  'hover:bg-page text-text-primary ' +
                  'inline-flex items-center gap-2'
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  tabIndex={-1}
                  className="pointer-events-none"
                />
                <span className="truncate">{b.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
