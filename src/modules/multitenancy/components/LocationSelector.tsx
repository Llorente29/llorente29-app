// src/modules/multitenancy/components/LocationSelector.tsx
//
// Selector de local activo en el header. Consume el AppContext (locations
// reales del cliente) + el hook useLocationScope (activeLocationId).
//
// Opciones del selector:
//   - "Todos los locales" (value='all')         → modo consolidado
//   - Una opción por cada location de la cuenta → modo local concreto
//
// Cuando el admin elige una opción, el hook actualiza activeLocationId en
// el AppContext, que a su vez persiste en localStorage. Cualquier componente
// que use useLocationScope() recibe el nuevo valor automáticamente.
//
// COMPONENTE PURO: no hace queries, no lee Supabase, no maneja estado propio.
// Solo lee del context y delega cambios al setter.

import { useApp } from '../../../context/AppContext'
import { useLocationScope } from '../hooks/useLocationScope'

interface LocationSelectorProps {
  /** Clases extra que se concatenan al className por defecto. */
  className?: string
}

/**
 * Selector visual del local activo. Pensado para el header de la app.
 * No tiene label visible: el contexto (estar en el header) ya lo explica.
 * Para accesibilidad, usa aria-label.
 */
export default function LocationSelector({ className = '' }: LocationSelectorProps) {
  const { locations } = useApp()
  const { activeLocationId, setActiveLocationId } = useLocationScope()

  // Locaciones activas, ordenadas alfabéticamente.
  // - Si una location tiene active=false, no la mostramos (no es selecionable).
  // - El orden alfabético da estabilidad visual aunque cambie el orden en BBDD.
  const sortedLocations = [...locations]
    .filter((l) => l.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  return (
    <select
      aria-label="Local activo"
      title="Local activo"
      value={activeLocationId}
      onChange={(e) => setActiveLocationId(e.target.value)}
      className={
        'border border-border-default rounded-md px-2 py-1 text-xs ' +
        'bg-card text-text-primary cursor-pointer ' +
        'focus:outline-none focus:ring-1 focus:ring-accent ' +
        'max-w-[180px] truncate ' +
        className
      }
    >
      <option value="all">Todos los locales</option>
      {sortedLocations.map((loc) => (
        <option key={loc.id} value={loc.id}>
          {loc.name}
        </option>
      ))}
    </select>
  )
}
