// src/modules/supply/components/OperativeLocationBanner.tsx
//
// Aviso visible del LOCAL OPERATIVO en acciones de riesgo (recepción, inventario,
// conteo). Red de seguridad: el usuario siempre ve en qué local está actuando.
//   - Resuelto → banner "Estás en: X" (con origen: fichaje / tu local / elegido).
//   - No resuelto + gerente → selector para elegir local concreto.
//   - No resuelto + worker → bloqueo con mensaje (no puede operar).
//
// Uso:
//   const op = useOperativeLocation()
//   <OperativeLocationBanner op={op} locations={locations} />
//   if (!op.isResolved) return  // la pantalla no opera sin local
//   ... usar op.operativeLocationId

import { MapPin, AlertTriangle } from 'lucide-react'
import type { UseOperativeLocationResult } from '@/modules/supply/hooks/useOperativeLocation'
import type { SupplyLocation } from '@/modules/supply/services/supplierCatalogService'

const SOURCE_LABEL: Record<string, string> = {
  fichaje: 'según tu fichaje',
  perfil: 'tu local',
  gerente: 'elegido',
}

export default function OperativeLocationBanner({
  op, locations,
}: {
  op: UseOperativeLocationResult
  locations: SupplyLocation[]
}) {
  const nameOf = (id: string) => locations.find(l => l.id === id)?.name ?? id

  if (op.loading) return null

  // No resuelto + gerente puede elegir → selector.
  if (!op.isResolved && op.canChoose) {
    const options = op.chooseOptions.length > 0
      ? locations.filter(l => op.chooseOptions.includes(l.id))
      : locations
    return (
      <div className="p-3 rounded-md bg-warning-bg border border-warning/30 text-sm">
        <div className="flex items-center gap-1.5 text-warning font-medium mb-2">
          <AlertTriangle size={16} /> {op.blocker}
        </div>
        <select
          defaultValue=""
          onChange={e => { if (e.target.value) op.setManualLocation(e.target.value) }}
          className="w-full sm:w-auto px-3 py-2 text-sm border border-border-default rounded-md bg-card text-text-primary"
        >
          <option value="" disabled>Elige el local…</option>
          {options.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
    )
  }

  // No resuelto + worker → bloqueo.
  if (!op.isResolved) {
    return (
      <div className="p-3 rounded-md bg-danger-bg border border-danger/30 text-sm text-danger flex items-center gap-1.5">
        <AlertTriangle size={16} /> {op.blocker}
      </div>
    )
  }

  // Resuelto → aviso del local activo.
  const srcLabel = op.source ? SOURCE_LABEL[op.source] : null
  return (
    <div className="px-3 py-2 rounded-md bg-accent-bg border border-accent/20 text-sm flex items-center justify-between gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 text-accent font-medium">
        <MapPin size={15} /> Estás en: {nameOf(op.operativeLocationId!)}
        {srcLabel && <span className="text-text-tertiary font-normal">({srcLabel})</span>}
      </span>
      {op.canChoose && op.chooseOptions.length > 1 && (
        <select
          value={op.operativeLocationId ?? ''}
          onChange={e => op.setManualLocation(e.target.value)}
          className="px-2 py-1 text-xs border border-border-default rounded bg-card text-text-secondary"
        >
          {locations
            .filter(l => op.chooseOptions.length === 0 || op.chooseOptions.includes(l.id))
            .map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
    </div>
  )
}
