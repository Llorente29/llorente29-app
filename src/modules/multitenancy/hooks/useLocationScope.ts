// src/modules/multitenancy/hooks/useLocationScope.ts
//
// Hook que envuelve el AppContext y expone una API rica del scope de local.
//
// Filosofía: el AppContext expone activeLocationId (raw) y setActiveLocationId.
// Pero las páginas necesitan saber más:
//   - ¿Estoy en modo consolidado o en un local concreto?
//   - Si quiero escribir, ¿me dejas o debo bloquear porque estoy consolidado?
//   - ¿Cuál es el location UUID resuelto (null si consolidado)?
//
// Encapsular esto en un hook evita que cada página repita la misma lógica
// derivada y se equivoque.
//
// USO TÍPICO:
//
//   // Página de lectura (analítica, dashboard):
//   const { activeLocationId, isConsolidated, resolvedLocationId } = useLocationScope()
//   // → puede mostrar datos agregados si isConsolidated, o filtrados si no.
//
//   // Página de escritura (crear marca, ajustar stock, etc.):
//   const { requireLocation } = useLocationScope()
//   const locationId = requireLocation()  // throw si está en modo consolidado
//   // → llama al service con locationId garantizado como string.

import { useApp } from '../../../context/AppContext'
import type {
  ActiveLocationId,
  BrandFilter,
  LocationScope,
} from '../../../types/multitenancy'

/**
 * Excepción especializada cuando una operación de escritura se intenta
 * en modo consolidado. La UI puede capturarla y mostrar mensaje claro
 * al usuario ("Selecciona un local antes de guardar").
 */
export class ConsolidatedModeError extends Error {
  constructor(message = 'Esta operación requiere un local seleccionado (modo consolidado activo).') {
    super(message)
    this.name = 'ConsolidatedModeError'
  }
}

export interface UseLocationScopeReturn extends LocationScope {
  /** Cambia el local activo. Persiste en localStorage automáticamente. */
  setActiveLocationId: (id: ActiveLocationId) => void
  /**
   * Devuelve el UUID del local activo. Lanza ConsolidatedModeError si
   * estamos en modo consolidado.
   *
   * Las páginas de ESCRITURA del módulo Stock (crear pedido, ajustar
   * inventario, etc.) deben llamar a esta función al inicio. Las páginas
   * de LECTURA no la necesitan — usan activeLocationId directamente.
   */
  requireLocation: () => string
  /** Filtro de marcas activo (multi-select, [] = todas). */
  activeBrandFilter: BrandFilter
  /** Cambia el filtro de marcas. NO persiste (intencionado, ver AppContext). */
  setActiveBrandFilter: (filter: BrandFilter) => void
}

/**
 * Hook que expone el scope de local + filtro de marcas para componentes
 * del módulo multitenancy / Stock.
 *
 * Debe usarse dentro del AppProvider (lanza error si no, igual que useApp).
 */
export function useLocationScope(): UseLocationScopeReturn {
  const ctx = useApp()

  const isConsolidated = ctx.activeLocationId === 'all'
  const resolvedLocationId = isConsolidated ? null : ctx.activeLocationId

  const requireLocation = (): string => {
    if (isConsolidated) {
      throw new ConsolidatedModeError()
    }
    return ctx.activeLocationId
  }

  return {
    activeLocationId: ctx.activeLocationId,
    isConsolidated,
    resolvedLocationId,
    setActiveLocationId: ctx.setActiveLocationId,
    requireLocation,
    activeBrandFilter: ctx.activeBrandFilter,
    setActiveBrandFilter: ctx.setActiveBrandFilter,
  }
}
