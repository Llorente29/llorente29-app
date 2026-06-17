// src/modules/supply/components/StorageZonesSection.tsx
//
// AL1 — Pantalla de Zonas de almacén. Reemplaza el CRUD plano de áreas.
//
// Orquesta:
//   - Cobertura del local (KPIs: artículos, colocados, sin zona, € sin colocar).
//   - "Sin zona": huérfanos por valor, con filtros y asignación en bloque (OrphansPanel).
//   - Árbol de zonas: cada zona con preview de sus 5 de más valor, "ver los N"
//     (lista completa + buscador), y acciones por fila / en bloque:
//       · Asignar (desde huérfanos)  · Mover a otra zona  · Quitar (a huérfanos)
//       · Vaciar zona  · Renombrar / Archivar / + subzona
//   - Exportar / Importar la asignación en Excel.
//   - Peek de un artículo con salto a su ficha (onOpenItem → InventoryPage).
//
// El € de una zona es el de los artículos cuya zona PRINCIPAL es esa (sin doble
// conteo); los multi-zona muestran su € solo en la principal.

import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Download, Upload, Boxes, Loader2, Search, X, Trash2, AlertTriangle,
  ChevronRight, ChevronDown, Pencil, Archive, Eraser, ArrowRightLeft,
} from 'lucide-react'
import {
  getStorageCoverage, listOrphans, listZoneItems,
  removeItemsFromZone, emptyZone, formatStockQty,
  type StorageCoverage, type ZoneCoverage, type OrphanItem, type ZoneItem,
} from '@/modules/supply/services/storageZonesService'
import { createStorageArea, renameStorageArea, archiveStorageArea } from '@/modules/supply/services/storageAreaService'
import { listIngredientFamilies, type IngredientFamily } from '@/modules/kitchen/services/ingredientFamilyService'
import { exportAssignmentXlsx, type AssignmentRow } from '@/modules/supply/lib/storageZonesIo'
import AssignToZonesModal from '@/modules/supply/components/AssignToZonesModal'
import ImportZonesModal from '@/modules/supply/components/ImportZonesModal'
import ItemPeekPanel, { type PeekItem } from '@/modules/supply/components/ItemPeekPanel'

const PAGE = 50

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
}
function fmtEur2(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
}

type AssignTarget =
  | { mode: 'assign'; itemIds: string[]; label: string; fromZoneId?: undefined }
  | { mode: 'move'; itemIds: string[]; label: string; fromZoneId: string }

export default function StorageZonesSection({
  accountId,
  locationId,
  onError,
  onFlash,
  onOpenItem,
  onZonesChanged,
}: {
  accountId: string
  locationId: string
  onError: (m: string) => void
  onFlash: (m: string) => void
  onOpenItem: (recipeItemId: string) => void
  onZonesChanged: () => void
}) {
  const [coverage, setCoverage] = useState<StorageCoverage | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [families, setFamilies] = useState<IngredientFamily[]>([])

  // alta de zona
  const [newName, setNewName] = useState('')
  const [newParent, setNewParent] = useState('')
  const [creating, setCreating] = useState(false)

  // modales / peek
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [peek, setPeek] = useState<PeekItem | null>(null)
  const [exporting, setExporting] = useState(false)

  async function loadCoverage() {
    setLoading(true)
    try {
      const c = await getStorageCoverage(accountId, locationId)
      setCoverage(c)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error cargando la cobertura.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!accountId || !locationId) return
    loadCoverage()
  }, [accountId, locationId, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!accountId) return
    listIngredientFamilies(accountId).then(setFamilies).catch(() => setFamilies([]))
  }, [accountId])

  function refreshAll() {
    setReloadKey(k => k + 1)
    onZonesChanged()
  }

  const rootZones = useMemo(
    () => (coverage?.zones ?? []).filter(z => !z.parentId).sort((a, b) => a.position - b.position),
    [coverage],
  )
  const childrenOf = (id: string) => (coverage?.zones ?? []).filter(z => z.parentId === id).sort((a, b) => a.position - b.position)

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true); onError('')
    try {
      await createStorageArea({
        accountId, locationId, name: newName,
        parentId: newParent || null,
        position: ((coverage?.zones.length ?? 0) + 1) * 10,
      })
      setNewName(''); setNewParent('')
      refreshAll()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo crear la zona.')
    } finally {
      setCreating(false)
    }
  }

  async function handleExport() {
    if (!coverage) return
    setExporting(true); onError('')
    try {
      const rows: AssignmentRow[] = []
      for (const z of coverage.zones) {
        const page = await listZoneItems(accountId, z.id, { limit: 2000 })
        for (const it of page.items) rows.push({ articulo: it.name, zona: z.name, principal: it.isPrimary })
      }
      const orph = await listOrphans(accountId, locationId, { limit: 5000 })
      for (const o of orph.items) rows.push({ articulo: o.name, zona: '', principal: false })
      exportAssignmentXlsx('asignacion_almacen.xlsx', rows)
      onFlash(`Exportadas ${rows.length} líneas a Excel.`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo exportar.')
    } finally {
      setExporting(false)
    }
  }

  async function handleEmptyZone(zone: ZoneCoverage) {
    if (!window.confirm(`¿Vaciar "${zone.name}"? Sus artículos vuelven a "sin zona" (no se borra nada del catálogo).`)) return
    try {
      const n = await emptyZone(accountId, locationId, zone.id)
      onFlash(`${n} artículo(s) devueltos a "sin zona".`)
      refreshAll()
    } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo vaciar.') }
  }
  async function handleRename(zone: ZoneCoverage) {
    const name = window.prompt('Nuevo nombre de la zona:', zone.name)
    if (!name || name.trim() === zone.name) return
    try { await renameStorageArea(zone.id, name); refreshAll() }
    catch (e) { onError(e instanceof Error ? e.message : 'No se pudo renombrar.') }
  }
  async function handleArchive(zone: ZoneCoverage) {
    if (!window.confirm(`¿Archivar "${zone.name}"? Deja de usarse; sus artículos vuelven a "sin zona".`)) return
    try {
      if (zone.itemCount > 0) await emptyZone(accountId, locationId, zone.id)
      await archiveStorageArea(zone.id)
      refreshAll()
    } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo archivar.') }
  }

  if (loading && !coverage) {
    return <div className="flex items-center gap-2 text-text-secondary text-sm p-6"><Loader2 size={16} className="animate-spin" /> Cargando zonas…</div>
  }
  const k = coverage?.kpis
  const pct = k && k.rawActive > 0 ? Math.round((k.placed / k.rawActive) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Barra de acciones */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-2 flex-wrap">
          <label className="block">
            <span className="text-[11px] text-text-secondary">Nueva zona</span>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Congelador, Cámara, Seco…"
              className="mt-0.5 w-48 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
          </label>
          <label className="block">
            <span className="text-[11px] text-text-secondary">Dentro de</span>
            <select value={newParent} onChange={e => setNewParent(e.target.value)}
              className="mt-0.5 w-40 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary">
              <option value="">— Zona raíz —</option>
              {rootZones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={handleCreate} disabled={creating || !newName.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Zona
          </button>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleExport} disabled={exporting}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-border-default text-text-secondary hover:bg-page transition-base disabled:opacity-50">
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Exportar
          </button>
          <button type="button" onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-border-default text-text-secondary hover:bg-page transition-base">
            <Upload size={15} /> Importar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Artículos" value={k?.rawActive ?? 0} />
        <Kpi label="Colocados" value={k?.placed ?? 0} />
        <Kpi label="Sin zona" value={k?.orphans ?? 0} warn={(k?.orphans ?? 0) > 0} />
        <Kpi label="€ sin colocar" value={fmtEur(k?.orphanValue)} warn={(k?.orphanValue ?? 0) > 0} />
      </div>
      <div className="h-1.5 bg-page rounded-full overflow-hidden">
        <div className="h-full bg-accent transition-base" style={{ width: `${pct}%` }} />
      </div>

      {/* Sin zona (huérfanos) */}
      <OrphansPanel
        accountId={accountId} locationId={locationId} families={families} reloadKey={reloadKey}
        orphanCount={k?.orphans ?? 0} orphanValue={k?.orphanValue ?? 0}
        onAssign={(itemIds, label) => setAssignTarget({ mode: 'assign', itemIds, label })}
        onPeek={setPeek}
      />

      {/* Árbol de zonas */}
      <div className="space-y-2">
        {rootZones.length === 0 ? (
          <div className="text-center py-8 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
            <Boxes size={26} className="mx-auto mb-2 text-text-tertiary" />
            Aún no hay zonas. Crea la primera arriba (p. ej. "Cámara").
          </div>
        ) : rootZones.map(root => (
          <div key={root.id} className="space-y-2">
            <ZoneCard
              zone={root} isChild={false} accountId={accountId} locationId={locationId} reloadKey={reloadKey}
              onChanged={refreshAll} onError={onError} onFlash={onFlash} onPeek={setPeek}
              onMove={(itemIds, label) => setAssignTarget({ mode: 'move', itemIds, label, fromZoneId: root.id })}
              onEmpty={() => handleEmptyZone(root)} onRename={() => handleRename(root)} onArchive={() => handleArchive(root)}
            />
            {childrenOf(root.id).map(child => (
              <ZoneCard
                key={child.id} zone={child} isChild accountId={accountId} locationId={locationId} reloadKey={reloadKey}
                onChanged={refreshAll} onError={onError} onFlash={onFlash} onPeek={setPeek}
                onMove={(itemIds, label) => setAssignTarget({ mode: 'move', itemIds, label, fromZoneId: child.id })}
                onEmpty={() => handleEmptyZone(child)} onRename={() => handleRename(child)} onArchive={() => handleArchive(child)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Modales */}
      {assignTarget && coverage && (
        <AssignToZonesModal
          mode={assignTarget.mode}
          accountId={accountId}
          itemIds={assignTarget.itemIds}
          itemLabel={assignTarget.label}
          zones={coverage.zones}
          fromZoneId={assignTarget.mode === 'move' ? assignTarget.fromZoneId : null}
          onClose={() => setAssignTarget(null)}
          onError={onError}
          onDone={(n) => {
            setAssignTarget(null)
            onFlash(assignTarget.mode === 'move' ? `${n} artículo(s) movidos.` : `${n} artículo(s) asignados.`)
            refreshAll()
          }}
        />
      )}
      {importOpen && coverage && (
        <ImportZonesModal
          accountId={accountId}
          zones={coverage.zones}
          onClose={() => setImportOpen(false)}
          onError={onError}
          onDone={(n) => { setImportOpen(false); onFlash(`${n} artículo(s) asignados desde Excel.`); refreshAll() }}
        />
      )}
      {peek && (
        <ItemPeekPanel
          item={peek}
          onClose={() => setPeek(null)}
          onOpenFull={(id) => { setPeek(null); onOpenItem(id) }}
        />
      )}
    </div>
  )
}

// ── KPI card ──
function Kpi({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="bg-page rounded-md p-3">
      <div className="text-[13px] text-text-secondary">{label}</div>
      <div className={`text-2xl font-medium ${warn ? 'text-warning' : 'text-text-primary'} tabular-nums`}>{value}</div>
    </div>
  )
}

// ── Celda de cantidad: formato de compra grande + base debajo (o "sin contar") ──
function QtyCell({
  qty, unitAbbr, bfName, bfQib, valueEur,
}: {
  qty: number | null
  unitAbbr: string | null
  bfName: string | null
  bfQib: number | null
  valueEur?: number | null
}) {
  const d = formatStockQty(qty, unitAbbr, bfName, bfQib, valueEur)
  return (
    <span className="w-28 text-right shrink-0">
      <span className={`block text-sm font-medium tabular-nums ${d.counted ? 'text-text-primary' : 'text-text-tertiary'}`}>{d.main}</span>
      {d.sub && <span className="block text-[11px] text-text-tertiary tabular-nums">{d.sub}</span>}
    </span>
  )
}

// ── Panel "Sin zona" (huérfanos) ──
function OrphansPanel({
  accountId, locationId, families, reloadKey, orphanCount, orphanValue, onAssign, onPeek,
}: {
  accountId: string
  locationId: string
  families: IngredientFamily[]
  reloadKey: number
  orphanCount: number
  orphanValue: number
  onAssign: (itemIds: string[], label: string) => void
  onPeek: (item: PeekItem) => void
}) {
  const [search, setSearch] = useState('')
  const [familyId, setFamilyId] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ total: number; items: OrphanItem[] }>({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => { setPage(0); setSelected(new Set()) }, [search, familyId, reloadKey])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await listOrphans(accountId, locationId, {
          search: search || null, familyId: familyId || null, limit: PAGE, offset: page * PAGE,
        })
        if (!cancelled) setData(res)
      } catch { /* el padre ya muestra errores de cobertura */ }
      finally { if (!cancelled) setLoading(false) }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [accountId, locationId, search, familyId, page, reloadKey])

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllVisible() {
    setSelected(prev => {
      const all = data.items.every(i => prev.has(i.recipeItemId))
      const n = new Set(prev)
      data.items.forEach(i => all ? n.delete(i.recipeItemId) : n.add(i.recipeItemId))
      return n
    })
  }

  const pages = Math.ceil(data.total / PAGE)

  return (
    <div className="border border-border-default rounded-lg p-3.5 bg-card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2.5">
        <span className="font-medium text-text-primary inline-flex items-center gap-2">
          <AlertTriangle size={16} className="text-warning" /> Sin zona · {orphanCount} art · {fmtEur(orphanValue)}
        </span>
        <div className="flex gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
              className="pl-8 pr-3 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary w-40" />
          </div>
          <select value={familyId} onChange={e => setFamilyId(e.target.value)}
            className="px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-secondary">
            <option value="">Toda familia</option>
            {families.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </div>

      {orphanCount === 0 ? (
        <p className="text-sm text-text-tertiary py-4 text-center">Todo colocado. No hay artículos sin zona.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 px-1 pb-1.5 text-[11px] text-text-tertiary">
            <button type="button" onClick={toggleAllVisible} className="hover:text-text-secondary">
              {data.items.length > 0 && data.items.every(i => selected.has(i.recipeItemId)) ? 'Quitar selección' : 'Seleccionar lo visible'}
            </button>
          </div>
          <div className="border border-border-default rounded-md overflow-hidden">
            {loading ? (
              <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={14} className="animate-spin" /> Cargando…</div>
            ) : data.items.length === 0 ? (
              <p className="text-sm text-text-tertiary p-4 text-center">Sin resultados con ese filtro.</p>
            ) : data.items.map(o => {
              const on = selected.has(o.recipeItemId)
              return (
                <div key={o.recipeItemId} className="flex items-center gap-2.5 px-3 py-2 border-t border-border-default first:border-t-0">
                  <button type="button" onClick={() => toggle(o.recipeItemId)} aria-label="Seleccionar"
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-accent border-accent' : 'border-border-default'}`}>
                    {on && <span className="text-text-on-accent text-[10px]">✓</span>}
                  </button>
                  <button type="button" onClick={() => onPeek({ recipeItemId: o.recipeItemId, name: o.name, valueEur: o.valueEur, qty: o.qty, unitAbbr: o.unitAbbr, familyName: o.familyName })}
                    className="flex-1 text-left text-sm text-text-primary hover:text-accent truncate">{o.name}</button>
                  <QtyCell qty={o.qty} unitAbbr={o.unitAbbr} bfName={o.buyFormatName} bfQib={o.buyFormatQtyInBase} valueEur={o.valueEur} />
                  <span className="text-sm text-text-secondary tabular-nums w-16 text-right shrink-0">{fmtEur2(o.valueEur)}</span>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between mt-2.5 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              {pages > 1 && (
                <>
                  <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded border border-border-default disabled:opacity-40">‹</button>
                  <span>{page + 1} / {pages}</span>
                  <button type="button" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded border border-border-default disabled:opacity-40">›</button>
                </>
              )}
            </div>
            <button type="button" disabled={selected.size === 0}
              onClick={() => onAssign(Array.from(selected), selected.size === 1 ? '1 artículo' : `${selected.size} artículos`)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
              Asignar a zona{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tarjeta de zona ──
function ZoneCard({
  zone, isChild, accountId, locationId, reloadKey,
  onChanged, onError, onFlash, onPeek, onMove, onEmpty, onRename, onArchive,
}: {
  zone: ZoneCoverage
  isChild: boolean
  accountId: string
  locationId: string
  reloadKey: number
  onChanged: () => void
  onError: (m: string) => void
  onFlash: (m: string) => void
  onPeek: (item: PeekItem) => void
  onMove: (itemIds: string[], label: string) => void
  onEmpty: () => void
  onRename: () => void
  onArchive: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ total: number; items: ZoneItem[] }>({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => { if (!expanded) { setSearch(''); setPage(0); setSelected(new Set()) } }, [expanded])
  useEffect(() => { setSelected(new Set()) }, [reloadKey])

  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await listZoneItems(accountId, zone.id, { search: search || null, limit: PAGE, offset: page * PAGE })
        if (!cancelled) setData(res)
      } catch { /* el padre muestra errores */ }
      finally { if (!cancelled) setLoading(false) }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [expanded, accountId, zone.id, search, page, reloadKey])

  async function quickRemove(itemId: string) {
    try { await removeItemsFromZone(accountId, locationId, [itemId], zone.id); onChanged() }
    catch (e) { onError(e instanceof Error ? e.message : 'No se pudo quitar.') }
  }
  async function removeSelected() {
    try {
      const n = await removeItemsFromZone(accountId, locationId, Array.from(selected), zone.id)
      onFlash(`${n} artículo(s) quitados de "${zone.name}".`); onChanged()
    } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo quitar.') }
  }

  const previewItems = zone.topItems
  const pages = Math.ceil(data.total / PAGE)
  const label = (n: number) => (n === 1 ? '1 artículo' : `${n} artículos`)

  return (
    <div className={`border border-border-default rounded-lg overflow-hidden bg-card ${isChild ? 'ml-5' : ''}`}>
      {/* Cabecera */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <Boxes size={isChild ? 15 : 17} className="text-accent shrink-0" />
        <span className="flex-1 font-medium text-text-primary truncate">{zone.name}</span>
        <span className="text-xs text-text-secondary whitespace-nowrap">{zone.itemCount} art · {fmtEur(zone.valueEur)}</span>
        <div className="flex items-center gap-0.5">
          {zone.itemCount > 0 && (
            <button type="button" onClick={onEmpty} title="Vaciar zona" className="p-1.5 text-text-tertiary hover:text-warning"><Eraser size={15} /></button>
          )}
          <button type="button" onClick={onRename} title="Renombrar" className="p-1.5 text-text-tertiary hover:text-text-primary"><Pencil size={15} /></button>
          <button type="button" onClick={onArchive} title="Archivar" className="p-1.5 text-text-tertiary hover:text-danger"><Archive size={15} /></button>
        </div>
      </div>

      {/* Preview (top-5) cuando NO está expandida */}
      {!expanded && previewItems.length > 0 && (
        <div className="border-t border-border-default">
          {previewItems.map(it => (
            <div key={it.recipeItemId} className="flex items-center gap-2.5 px-3.5 py-1.5 border-t border-border-default first:border-t-0">
              <button type="button" onClick={() => onPeek({ recipeItemId: it.recipeItemId, name: it.name, valueEur: it.valueEur, qty: it.qty, unitAbbr: it.unitAbbr })}
                className="flex-1 text-left text-sm text-text-secondary hover:text-accent truncate">{it.name}</button>
              <QtyCell qty={it.qty} unitAbbr={it.unitAbbr} bfName={it.buyFormatName} bfQib={it.buyFormatQtyInBase} valueEur={it.valueEur} />
              <span className="text-xs text-text-tertiary tabular-nums w-16 text-right shrink-0">{fmtEur2(it.valueEur)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Lista completa al expandir */}
      {expanded && (
        <div className="border-t border-border-default">
          <div className="px-3.5 py-2 border-b border-border-default">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={`Buscar en ${zone.name}…`}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary" />
            </div>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={14} className="animate-spin" /> Cargando…</div>
          ) : data.items.length === 0 ? (
            <p className="text-sm text-text-tertiary p-4 text-center">Sin artículos.</p>
          ) : data.items.map(it => {
            const on = selected.has(it.recipeItemId)
            return (
              <div key={it.recipeItemId} className="flex items-center gap-2.5 px-3.5 py-2 border-t border-border-default">
                <button type="button" onClick={() => setSelected(prev => { const n = new Set(prev); n.has(it.recipeItemId) ? n.delete(it.recipeItemId) : n.add(it.recipeItemId); return n })}
                  aria-label="Seleccionar" className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-accent border-accent' : 'border-border-default'}`}>
                  {on && <span className="text-text-on-accent text-[10px]">✓</span>}
                </button>
                <button type="button" onClick={() => onPeek({ recipeItemId: it.recipeItemId, name: it.name, valueEur: it.valueEur, qty: it.qty, unitAbbr: it.unitAbbr })}
                  className="flex-1 text-left text-sm text-text-primary hover:text-accent truncate">
                  {it.name}
                  {it.isPrimary && <span className="ml-2 text-[10px] text-accent border border-accent/40 rounded px-1 py-0.5">principal</span>}
                </button>
                <QtyCell qty={it.qty} unitAbbr={it.unitAbbr} bfName={it.buyFormatName} bfQib={it.buyFormatQtyInBase} valueEur={it.valueEur} />
                <span className="text-sm text-text-secondary tabular-nums w-14 text-right shrink-0">{fmtEur2(it.valueEur)}</span>
                <button type="button" onClick={() => onMove([it.recipeItemId], it.name)} title="Mover a otra zona" className="p-1 text-text-tertiary hover:text-accent"><ArrowRightLeft size={14} /></button>
                <button type="button" onClick={() => quickRemove(it.recipeItemId)} title="Quitar (a sin zona)" className="p-1 text-text-tertiary hover:text-danger"><X size={14} /></button>
              </div>
            )
          })}

          {/* Barra de selección + paginación */}
          <div className="flex items-center justify-between px-3.5 py-2 border-t border-border-default flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              {pages > 1 && (
                <>
                  <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded border border-border-default disabled:opacity-40">‹</button>
                  <span>{page + 1} / {pages}</span>
                  <button type="button" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded border border-border-default disabled:opacity-40">›</button>
                </>
              )}
            </div>
            {selected.size > 0 && (
              <div className="flex gap-2">
                <button type="button" onClick={() => onMove(Array.from(selected), label(selected.size))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-default text-text-secondary hover:bg-page transition-base">
                  <ArrowRightLeft size={14} /> Mover ({selected.size})
                </button>
                <button type="button" onClick={removeSelected}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-default text-danger hover:bg-page transition-base">
                  <Trash2 size={14} /> Quitar ({selected.size})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toggle ver todos / menos */}
      {zone.itemCount > 0 && (
        <button type="button" onClick={() => setExpanded(e => !e)}
          className="w-full px-3.5 py-2 border-t border-border-default text-sm text-accent hover:bg-page transition-base flex items-center gap-1.5">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {expanded ? 'Ver menos' : `Ver los ${zone.itemCount}`}
        </button>
      )}
    </div>
  )
}
