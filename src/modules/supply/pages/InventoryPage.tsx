// src/modules/supply/pages/InventoryPage.tsx
//
// Página de Inventario (dentro de Supply). Capa 1.2: gestión de ÁREAS DE
// ALMACÉN y asignación de artículos a su "hogar", base del shelf-to-sheet.
// Las capas siguientes (conteo, aprobación→ajuste, autoinventario, auditoría)
// se montan sobre esto.

import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Boxes, Loader2, X, PencilLine, ChevronUp, ChevronDown,
  Search, MapPin, Archive,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useApp } from '@/context/AppContext'
import { listSupplyLocations, type SupplyLocation } from '@/modules/supply/services/supplierCatalogService'
import { useOperativeLocation } from '@/modules/supply/hooks/useOperativeLocation'
import OperativeLocationBanner from '@/modules/supply/components/OperativeLocationBanner'
import {
  listStorageAreas,
  createStorageArea,
  renameStorageArea,
  reorderStorageArea,
  archiveStorageArea,
  listAreaItems,
  assignItemToArea,
  unassignItemFromArea,
  listInventoryItems,
  type StorageArea,
  type AreaItem,
  type InventoryItem,
} from '@/modules/supply/services/storageAreaService'

export default function InventoryPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { userProfile, authUserId } = useApp()

  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const op = useOperativeLocation()
  const locationId = op.operativeLocationId ?? ''
  const [areas, setAreas] = useState<StorageArea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // alta de área
  const [newAreaName, setNewAreaName] = useState('')
  const [newAreaParent, setNewAreaParent] = useState<string>('')
  const [creating, setCreating] = useState(false)

  // asignador de artículos
  const [assignAreaId, setAssignAreaId] = useState<string | null>(null)

  useEffect(() => {
    if (flash) { const t = setTimeout(() => setFlash(null), 3000); return () => clearTimeout(t) }
  }, [flash])

  // cargar locales
  useEffect(() => {
    if (!activeAccountId) return
    let cancelled = false
    ;(async () => {
      try {
        const locs = await listSupplyLocations(activeAccountId)
        if (cancelled) return
        setLocations(locs)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando locales.')
      }
    })()
    return () => { cancelled = true }
  }, [activeAccountId]) // eslint-disable-line react-hooks/exhaustive-deps

  // cargar áreas del local
  useEffect(() => {
    if (!activeAccountId || !locationId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const a = await listStorageAreas(activeAccountId, locationId)
        if (!cancelled) setAreas(a)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando áreas.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [activeAccountId, locationId, reloadTick])  // locationId viene del hook operativo

  // áreas raíz y subáreas (jerarquía opcional de 1 nivel)
  const rootAreas = useMemo(() => areas.filter(a => !a.parentId), [areas])
  const childrenOf = (id: string) => areas.filter(a => a.parentId === id)

  async function handleCreate() {
    if (!activeAccountId || !locationId || !newAreaName.trim()) return
    setCreating(true); setError(null)
    try {
      await createStorageArea({
        accountId: activeAccountId,
        locationId,
        name: newAreaName,
        parentId: newAreaParent || null,
        position: (areas.length + 1) * 10,
        createdBy: authUserId ?? null,
        createdByName: userProfile?.displayName ?? null,
      })
      setNewAreaName(''); setNewAreaParent('')
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el área.')
    } finally {
      setCreating(false)
    }
  }

  async function handleRename(area: StorageArea) {
    const name = window.prompt('Nuevo nombre del área:', area.name)
    if (!name || name.trim() === area.name) return
    try { await renameStorageArea(area.id, name); setReloadTick(t => t + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo renombrar.') }
  }

  async function handleMove(area: StorageArea, dir: -1 | 1) {
    const siblings = area.parentId ? childrenOf(area.parentId) : rootAreas
    const idx = siblings.findIndex(a => a.id === area.id)
    const target = siblings[idx + dir]
    if (!target) return
    try {
      await reorderStorageArea(area.id, target.position)
      await reorderStorageArea(target.id, area.position)
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reordenar.')
    }
  }

  async function handleArchive(area: StorageArea) {
    if (!window.confirm(`¿Archivar el área "${area.name}"? No se borra; deja de usarse para conteos.`)) return
    try { await archiveStorageArea(area.id); setReloadTick(t => t + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo archivar.') }
  }

  if (accountsLoading || loading) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm p-6">
        <Loader2 size={16} className="animate-spin" /> Cargando inventario…
      </div>
    )
  }

  const areaRow = (area: StorageArea, isChild: boolean) => (
    <div key={area.id}
      className={`flex items-center gap-2 px-3 py-2.5 border-t border-border-default ${isChild ? 'pl-9 bg-page' : 'bg-card'}`}>
      {isChild
        ? <MapPin size={15} className="text-text-tertiary shrink-0" />
        : <Boxes size={16} className="text-accent shrink-0" />}
      <span className="flex-1 text-text-primary font-medium">{area.name}</span>
      <span className="text-xs text-text-tertiary">
        {area.itemCount ?? 0} artículo{(area.itemCount ?? 0) === 1 ? '' : 's'}
      </span>
      <button type="button" onClick={() => setAssignAreaId(area.id)}
        className="text-xs px-2 py-1 rounded border border-border-default hover:bg-page text-text-secondary">
        Artículos
      </button>
      <button type="button" onClick={() => handleMove(area, -1)} className="text-text-tertiary hover:text-text-primary p-1"><ChevronUp size={15} /></button>
      <button type="button" onClick={() => handleMove(area, 1)} className="text-text-tertiary hover:text-text-primary p-1"><ChevronDown size={15} /></button>
      <button type="button" onClick={() => handleRename(area)} className="text-text-tertiary hover:text-text-primary p-1"><PencilLine size={15} /></button>
      <button type="button" onClick={() => handleArchive(area)} className="text-text-tertiary hover:text-danger p-1"><Archive size={15} /></button>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-display font-medium text-text-primary">Inventario</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Organiza las áreas de almacén de cada local. El conteo seguirá este orden físico (shelf-to-sheet).
          </p>
        </div>
      </div>

      <OperativeLocationBanner op={op} locations={locations} />

      {flash && <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm">{flash}</div>}
      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {!op.isResolved ? null : (
      <>
      {/* Alta de área */}
      <div className="border border-border-default rounded-lg p-3 bg-card flex items-end gap-2 flex-wrap">
        <label className="block flex-1 min-w-[180px]">
          <span className="text-[11px] text-text-secondary">Nueva área</span>
          <input type="text" value={newAreaName} onChange={e => setNewAreaName(e.target.value)}
            placeholder="Cámara, Seco, Barra, Congelador…"
            className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
        </label>
        <label className="block min-w-[160px]">
          <span className="text-[11px] text-text-secondary">Dentro de (opcional)</span>
          <select value={newAreaParent} onChange={e => setNewAreaParent(e.target.value)}
            className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary">
            <option value="">— Área principal —</option>
            {rootAreas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={handleCreate} disabled={creating || !newAreaName.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
          {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Añadir
        </button>
      </div>

      {/* Lista de áreas con jerarquía */}
      {areas.length === 0 ? (
        <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
          <Boxes size={28} className="mx-auto mb-2 text-text-tertiary" />
          Aún no hay áreas en este local. Crea la primera arriba (p. ej. "Cámara").
        </div>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          {rootAreas.map(root => (
            <div key={root.id}>
              {areaRow(root, false)}
              {childrenOf(root.id).map(child => areaRow(child, true))}
            </div>
          ))}
        </div>
      )}
      </>
      )}

      {/* Modal asignador de artículos */}
      {assignAreaId && activeAccountId && (
        <AssignItemsModal
          accountId={activeAccountId}
          area={areas.find(a => a.id === assignAreaId)!}
          onClose={() => { setAssignAreaId(null); setReloadTick(t => t + 1) }}
          onError={(m) => setError(m)}
        />
      )}
    </div>
  )
}

// ── Modal: asignar artículos a un área ──
function AssignItemsModal({
  accountId, area, onClose, onError,
}: {
  accountId: string
  area: StorageArea
  onClose: () => void
  onError: (m: string) => void
}) {
  const [allItems, setAllItems] = useState<InventoryItem[]>([])
  const [assigned, setAssigned] = useState<AreaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [items, asg] = await Promise.all([
          listInventoryItems(accountId),
          listAreaItems(accountId, area.id),
        ])
        if (cancelled) return
        setAllItems(items); setAssigned(asg)
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : 'Error cargando artículos.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountId, area.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const assignedIds = useMemo(() => new Set(assigned.map(a => a.recipeItemId)), [assigned])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allItems.filter(i => !q || i.name.toLowerCase().includes(q))
  }, [allItems, search])

  async function toggle(item: InventoryItem) {
    setBusy(item.recipeItemId)
    try {
      if (assignedIds.has(item.recipeItemId)) {
        await unassignItemFromArea(item.recipeItemId, area.id)
        setAssigned(prev => prev.filter(a => a.recipeItemId !== item.recipeItemId))
      } else {
        await assignItemToArea(accountId, item.recipeItemId, area.id, (assigned.length + 1) * 10)
        setAssigned(prev => [...prev, { recipeItemId: item.recipeItemId, itemName: item.name, position: (prev.length + 1) * 10 }])
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo actualizar.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-card rounded-lg border border-border-default shadow-lg w-full max-w-md my-8">
        <div className="px-5 py-3 border-b border-border-default flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-text-primary">Artículos en “{area.name}”</h3>
            <p className="text-xs text-text-secondary mt-0.5">{assigned.length} asignado{assigned.length === 1 ? '' : 's'}</p>
          </div>
          <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>
        <div className="px-5 py-3 border-b border-border-default">
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar artículo…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
          </div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Cargando…</div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-text-tertiary p-4 text-center">Sin resultados.</p>
          ) : (
            filtered.map(item => {
              const on = assignedIds.has(item.recipeItemId)
              return (
                <button key={item.recipeItemId} type="button" onClick={() => toggle(item)} disabled={busy === item.recipeItemId}
                  className={`w-full flex items-center gap-2 px-5 py-2.5 text-sm text-left border-t border-border-default hover:bg-page transition-base ${on ? 'text-text-primary' : 'text-text-secondary'}`}>
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-accent border-accent' : 'border-border-default'}`}>
                    {busy === item.recipeItemId ? <Loader2 size={11} className="animate-spin text-text-on-accent" /> : on ? <span className="text-text-on-accent text-[10px]">✓</span> : null}
                  </span>
                  {item.name}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
