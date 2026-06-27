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
// ESTADO DE CARGA (fix timing): el AppContext arranca `locations` desde la
// caché de localStorage y la rellena después con la sync de Supabase. Si la
// caché está vacía (sesión nueva, otro dispositivo), durante ese instante el
// selector mostraría engañosamente solo "Todos los locales" — el cliente cree
// que no tiene sus locales. Para evitarlo: si hay cuenta activa, la nube está
// habilitada y aún no han llegado locales (lista vacía + sync en curso o sin
// primer sync), mostramos "Cargando locales…" deshabilitado en vez del estado
// engañoso. En cuanto llegan, se pinta el selector normal.
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
  const { locations, cloudEnabled, syncing, lastSync, activeAccountId } = useApp()
  const { activeLocationId, setActiveLocationId } = useLocationScope()

  const baseClass =
    'border border-border-default rounded-md px-2 py-1 text-xs ' +
    'bg-card text-text-primary cursor-pointer ' +
    'focus:outline-none focus:ring-1 focus:ring-accent ' +
    'max-w-[180px] truncate ' +
    className

  // Locaciones activas, ordenadas alfabéticamente.
  // - Si una location tiene active=false, no la mostramos (no es selecionable).
  // - El orden alfabético da estabilidad visual aunque cambie el orden en BBDD.
  const sortedLocations = [...locations]
    .filter((l) => l.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  // ¿Estamos aún cargando los locales de la cuenta? Hay cuenta activa y nube,
  // pero no hay locales todavía y la sync no ha terminado su primer ciclo.
  const stillLoading =
    cloudEnabled &&
    !!activeAccountId &&
    sortedLocations.length === 0 &&
    (syncing || lastSync === null)

  if (stillLoading) {
    return (
      <select aria-label="Cargando locales" title="Cargando locales" disabled className={baseClass}>
        <option>Cargando locales…</option>
      </select>
    )
  }

  return (
    <select
      aria-label="Local activo"
      title="Local activo"
      value={activeLocationId}
      onChange={(e) => setActiveLocationId(e.target.value)}
      className={baseClass}
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
