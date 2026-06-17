// src/modules/supply/components/AssignToZonesModal.tsx
//
// AL1 — Modal de asignar / mover artículos a zonas, en bloque.
//
// Dos modos:
//   - 'assign' (desde "sin zona" o el botón Asignar): elige una o varias zonas,
//     marca cuál es la principal (la que lleva el €) y decide añadir vs mover.
//       · Añadir a estas zonas        → mode 'add'     (conserva las que ya tenga)
//       · Mover aquí (quitar de otras)→ mode 'replace' (fija solo estas)
//   - 'move' (desde una zona): elige UNA zona de destino; saca los artículos de
//     la zona de origen conservando el resto.
//
// El árbol de zonas se pinta con un nivel de sangría (parent_id).

import { useMemo, useState } from 'react'
import { X, Loader2, ArrowRight, Layers } from 'lucide-react'
import {
  assignItemsToZones,
  moveItemsToZone,
  type ZoneCoverage,
  type AssignMode,
} from '@/modules/supply/services/storageZonesService'

export default function AssignToZonesModal({
  mode,
  accountId,
  itemIds,
  itemLabel,
  zones,
  fromZoneId,
  onDone,
  onClose,
  onError,
}: {
  mode: 'assign' | 'move'
  accountId: string
  itemIds: string[]
  itemLabel: string                 // "3 artículos" / "Solomillo de ternera"
  zones: ZoneCoverage[]             // árbol de zonas del local (coverage.zones)
  fromZoneId?: string | null        // origen (modo 'move'): se excluye y se pasa al RPC
  onDone: (count: number) => void
  onClose: () => void
  onError: (m: string) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [primaryId, setPrimaryId] = useState<string | null>(null)
  const [assignMode, setAssignMode] = useState<AssignMode>('add')
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Orden visual: raíces por position; cada raíz seguida de sus hijas.
  const ordered = useMemo(() => {
    const roots = zones.filter(z => !z.parentId).sort((a, b) => a.position - b.position)
    const out: { zone: ZoneCoverage; isChild: boolean }[] = []
    for (const root of roots) {
      out.push({ zone: root, isChild: false })
      zones.filter(z => z.parentId === root.id).sort((a, b) => a.position - b.position)
        .forEach(child => out.push({ zone: child, isChild: true }))
    }
    return out
  }, [zones])

  function toggle(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) {
        n.delete(id)
        if (primaryId === id) setPrimaryId(null)
      } else {
        n.add(id)
        if (primaryId === null) setPrimaryId(id)
      }
      return n
    })
  }

  const canConfirm = mode === 'move'
    ? !!moveTarget
    : selected.size > 0 && !!primaryId

  async function handleConfirm() {
    if (!canConfirm || busy) return
    setBusy(true)
    onError('')
    try {
      let count: number
      if (mode === 'move') {
        count = await moveItemsToZone(accountId, itemIds, fromZoneId ?? '', moveTarget!)
      } else {
        const zoneIds = Array.from(selected)
        const primary = primaryId && selected.has(primaryId) ? primaryId : zoneIds[0]
        count = await assignItemsToZones(accountId, itemIds, zoneIds, primary, assignMode)
      }
      onDone(count)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo completar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-card rounded-lg border border-border-default shadow-lg w-full max-w-md my-8">
        <div className="px-5 py-3 border-b border-border-default flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-text-primary">
              {mode === 'move' ? 'Mover a la zona…' : 'Asignar a zona'}
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">{itemLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {ordered.length === 0 ? (
            <p className="text-sm text-text-tertiary p-5 text-center">No hay zonas en este local. Crea una zona primero.</p>
          ) : (
            ordered.map(({ zone, isChild }) => {
              const disabled = mode === 'move' && zone.id === fromZoneId
              const checked = mode === 'move' ? moveTarget === zone.id : selected.has(zone.id)
              return (
                <button
                  key={zone.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => (mode === 'move' ? setMoveTarget(zone.id) : toggle(zone.id))}
                  className={`w-full flex items-center gap-2.5 px-5 py-2.5 text-sm text-left border-t border-border-default hover:bg-page transition-base disabled:opacity-40 disabled:cursor-not-allowed ${isChild ? 'pl-9' : ''} ${checked ? 'text-text-primary' : 'text-text-secondary'}`}
                >
                  <span className={`w-4 h-4 ${mode === 'move' ? 'rounded-full' : 'rounded'} border flex items-center justify-center shrink-0 ${checked ? 'bg-accent border-accent' : 'border-border-default'}`}>
                    {checked && <span className="text-text-on-accent text-[10px]">✓</span>}
                  </span>
                  <span className="flex-1">{zone.name}{disabled ? ' (origen)' : ''}</span>
                  {/* Marcar principal (solo modo asignar, y solo si está elegida) */}
                  {mode === 'assign' && selected.has(zone.id) && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); setPrimaryId(zone.id) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setPrimaryId(zone.id) } }}
                      className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${primaryId === zone.id ? 'bg-accent-bg text-accent border-accent/30' : 'border-border-default text-text-tertiary hover:text-text-secondary'}`}
                    >
                      <Layers size={11} /> {primaryId === zone.id ? 'principal' : 'hacer principal'}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* Añadir vs mover (solo modo asignar) */}
        {mode === 'assign' && (
          <div className="px-5 py-3 border-t border-border-default">
            <span className="block text-[11px] text-text-secondary mb-1.5">¿Qué hacer con las zonas que ya tuviera?</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAssignMode('add')}
                className={`px-3 py-1.5 text-sm rounded-md border transition-base ${assignMode === 'add' ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
                Añadir a estas zonas
              </button>
              <button type="button" onClick={() => setAssignMode('replace')}
                className={`px-3 py-1.5 text-sm rounded-md border transition-base ${assignMode === 'replace' ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
                Mover aquí (quitar de las demás)
              </button>
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-border-default flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-3 py-2 text-sm rounded-md border border-border-default text-text-secondary hover:bg-page transition-base disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={handleConfirm} disabled={!canConfirm || busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
            {mode === 'move' ? 'Mover' : 'Asignar'}
          </button>
        </div>
      </div>
    </div>
  )
}
