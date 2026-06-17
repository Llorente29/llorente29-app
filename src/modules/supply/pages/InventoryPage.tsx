// src/modules/supply/pages/InventoryPage.tsx
//
// Módulo ALMACÉN (dentro de Supply). Antes "Inventario".
//
// Esqueleto de 5 secciones que siguen el flujo mental del operario:
//   Resumen      — portada: valor de stock, cobertura, alertas.
//   Existencias  — qué hay y dónde: zonas (AL1) + niveles (frente ②).
//   Movimientos  — el libro: mermas/ajustes hoy; entrada directa + traspaso (frente ①).
//   Inventarios  — conteos + autoinventario IA.
//   Teórico vs Real — consumo (ventas×escandallo) + desviación (frente ③).
//
// El stock se valora por local; cada sección hereda el local operativo de la
// sesión (sin selector manual). Lógica de carga, modal de conteo, ficha embebida
// y panel de consumo intactos respecto a la versión anterior.

import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Boxes, Loader2, X, ClipboardList, ChevronRight,
  TrendingDown, RefreshCw, Gauge, LayoutDashboard, ArrowLeftRight,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useApp } from '@/context/AppContext'
import { listSupplyLocations, type SupplyLocation } from '@/modules/supply/services/supplierCatalogService'
import { useOperativeLocation } from '@/modules/supply/hooks/useOperativeLocation'
import OperativeLocationBanner from '@/modules/supply/components/OperativeLocationBanner'
import InventoryCountSheet from '@/modules/supply/components/InventoryCountSheet'
import MovementsSection from '@/modules/supply/components/MovementsSection'
import AutoInventorySection from '@/modules/supply/components/AutoInventorySection'
import StorageZonesSection from '@/modules/supply/components/StorageZonesSection'
import KitchenItemDetailPage from '@/modules/kitchen/pages/KitchenItemDetailPage'
import {
  createInventoryCount,
  buildInventoryCount,
  listInventoryCounts,
  type InventoryCount,
  type InventoryCountKind,
} from '@/modules/supply/services/inventoryCountService'
import {
  recomputeConsumption,
  listConsumptionByRaw,
  type ConsumptionByRaw,
} from '@/modules/supply/services/consumptionService'
import {
  listStorageAreas,
  type StorageArea,
} from '@/modules/supply/services/storageAreaService'
import { getStorageCoverage, type StorageCoverage } from '@/modules/supply/services/storageZonesService'

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

  // navegación: las 5 secciones del módulo Almacén
  const [tab, setTab] = useState<'resumen' | 'existencias' | 'movimientos' | 'inventarios' | 'avt'>('resumen')
  // dentro de Inventarios: conteos | autoinventario
  const [invTab, setInvTab] = useState<'conteos' | 'autoinv'>('conteos')
  const [openCountId, setOpenCountId] = useState<string | null>(null)
  const [counts, setCounts] = useState<InventoryCount[]>([])
  const [countsLoading, setCountsLoading] = useState(false)
  const [newCountOpen, setNewCountOpen] = useState(false)

  // ficha de un artículo abierta desde el peek de Zonas
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

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

  // cargar áreas del local (para el alcance del modal de conteo)
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

  // cargar conteos del local (al entrar en la pestaña o volver de un conteo)
  useEffect(() => {
    if (tab !== 'inventarios' || invTab !== 'conteos' || !activeAccountId || !locationId || openCountId) return
    let cancelled = false
    setCountsLoading(true)
    ;(async () => {
      try {
        const cs = await listInventoryCounts(activeAccountId, locationId)
        if (!cancelled) setCounts(cs)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando conteos.')
      } finally {
        if (!cancelled) setCountsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [tab, invTab, activeAccountId, locationId, openCountId, reloadTick])

  async function handleCreateCount(kind: InventoryCountKind, scope: 'areas' | 'full', areaIds: string[]) {
    if (!activeAccountId || !locationId) return
    setError(null)
    try {
      const countId = await createInventoryCount({
        accountId: activeAccountId,
        locationId,
        kind,
        blind: true,
        createdBy: authUserId ?? null,
        createdByName: userProfile?.displayName ?? null,
      })
      const n = await buildInventoryCount(countId, {
        areaIds: scope === 'areas' ? areaIds : null,
        full: scope === 'full',
      })
      setNewCountOpen(false)
      if (n === 0) {
        setError('No hay artículos en el alcance elegido. Asigna artículos a las zonas o usa "Todo el local".')
        setReloadTick(t => t + 1)
        return
      }
      setOpenCountId(countId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el conteo.')
    }
  }

  if (accountsLoading || loading) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm p-6">
        <Loader2 size={16} className="animate-spin" /> Cargando inventario…
      </div>
    )
  }

  // Ficha de un artículo (desde el peek de Zonas) → ocupa la vista
  if (selectedItemId) {
    return <KitchenItemDetailPage itemId={selectedItemId} onBack={() => setSelectedItemId(null)} />
  }

  // Conteo abierto → hoja de conteo (blind / revisión)
  if (openCountId) {
    return (
      <InventoryCountSheet
        countId={openCountId}
        onBack={() => { setOpenCountId(null); setReloadTick(t => t + 1) }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-display font-medium text-text-primary">Almacén</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Qué tienes, dónde está, cómo se mueve y cuánto deberías tener. El stock se valora por local.
          </p>
        </div>
      </div>

      <OperativeLocationBanner op={op} locations={locations} />

      {flash && <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm">{flash}</div>}
      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {!op.isResolved ? null : (
      <>
      {/* Pestañas: las 5 secciones del módulo Almacén */}
      <div className="flex items-center gap-1 border-b border-border-default overflow-x-auto">
        <button type="button" onClick={() => setTab('resumen')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-base whitespace-nowrap ${tab === 'resumen' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
          <span className="inline-flex items-center gap-1.5"><LayoutDashboard size={15} /> Resumen</span>
        </button>
        <button type="button" onClick={() => setTab('existencias')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-base whitespace-nowrap ${tab === 'existencias' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
          <span className="inline-flex items-center gap-1.5"><Boxes size={15} /> Existencias</span>
        </button>
        <button type="button" onClick={() => setTab('movimientos')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-base whitespace-nowrap ${tab === 'movimientos' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
          <span className="inline-flex items-center gap-1.5"><ArrowLeftRight size={15} /> Movimientos</span>
        </button>
        <button type="button" onClick={() => setTab('inventarios')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-base whitespace-nowrap ${tab === 'inventarios' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
          <span className="inline-flex items-center gap-1.5"><ClipboardList size={15} /> Inventarios</span>
        </button>
        <button type="button" onClick={() => setTab('avt')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-base whitespace-nowrap ${tab === 'avt' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
          <span className="inline-flex items-center gap-1.5"><TrendingDown size={15} /> Teórico vs Real</span>
        </button>
      </div>

      {tab === 'resumen' && activeAccountId && locationId && (
        <SummarySection
          accountId={activeAccountId}
          locationId={locationId}
          reloadTick={reloadTick}
          onNavigate={(t) => setTab(t)}
          onError={(m) => setError(m)}
        />
      )}

      {tab === 'existencias' && activeAccountId && locationId && (
        <StorageZonesSection
          accountId={activeAccountId}
          locationId={locationId}
          onError={(m) => setError(m)}
          onFlash={(m) => setFlash(m)}
          onOpenItem={(id) => setSelectedItemId(id)}
          onZonesChanged={() => setReloadTick(t => t + 1)}
        />
      )}

      {tab === 'movimientos' && activeAccountId && (
        <MovementsSection
          accountId={activeAccountId}
          locationId={locationId || null}
          locations={locations}
          actorId={authUserId ?? null}
          actorName={userProfile?.displayName ?? null}
          onError={(m) => setError(m)}
          onFlash={(m) => setFlash(m)}
        />
      )}

      {tab === 'inventarios' && (
        <div className="space-y-3">
          <div className="inline-flex rounded-md border border-border-default overflow-hidden">
            <button type="button" onClick={() => setInvTab('conteos')}
              className={`px-3 py-1.5 text-sm font-medium transition-base ${invTab === 'conteos' ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:text-text-primary'}`}>
              Conteos
            </button>
            <button type="button" onClick={() => setInvTab('autoinv')}
              className={`px-3 py-1.5 text-sm font-medium transition-base inline-flex items-center gap-1.5 ${invTab === 'autoinv' ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:text-text-primary'}`}>
              <Gauge size={14} /> Autoinventario
            </button>
          </div>

          {invTab === 'conteos' && (
            <CountsSection
              counts={counts}
              loading={countsLoading}
              onOpen={(id) => setOpenCountId(id)}
              onNew={() => setNewCountOpen(true)}
            />
          )}

          {invTab === 'autoinv' && activeAccountId && (
            <AutoInventorySection
              accountId={activeAccountId}
              locationId={locationId}
              onError={(m) => setError(m)}
              onFlash={(m) => setFlash(m)}
            />
          )}
        </div>
      )}

      {tab === 'avt' && activeAccountId && (
        <ConsumptionSection
          accountId={activeAccountId}
          locationId={locationId}
          onError={(m) => setError(m)}
          onFlash={(m) => setFlash(m)}
        />
      )}
      </>
      )}

      {/* Modal nuevo conteo */}
      {newCountOpen && (
        <NewCountModal
          areas={areas}
          onClose={() => setNewCountOpen(false)}
          onCreate={handleCreateCount}
        />
      )}
    </div>
  )
}

// ── Resumen: portada del almacén ──
function SummarySection({
  accountId, locationId, reloadTick, onNavigate, onError,
}: {
  accountId: string
  locationId: string
  reloadTick: number
  onNavigate: (t: 'existencias' | 'movimientos' | 'inventarios' | 'avt') => void
  onError: (m: string) => void
}) {
  const [cov, setCov] = useState<StorageCoverage | null>(null)
  const [loading, setLoading] = useState(true)
  const eur = (v: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getStorageCoverage(accountId, locationId)
      .then(c => { if (!cancelled) setCov(c) })
      .catch(e => { if (!cancelled) onError(e instanceof Error ? e.message : 'Error cargando el resumen.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, locationId, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Cargando resumen…</div>

  const k = cov?.kpis
  const coveragePct = k && k.rawActive > 0 ? Math.round((k.placed / k.rawActive) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <button type="button" onClick={() => onNavigate('existencias')}
          className="text-left bg-page rounded-lg p-4 border border-border-default hover:border-accent/40 transition-base">
          <div className="text-[12px] uppercase tracking-wide text-text-secondary mb-1">Valor de stock</div>
          <div className="text-2xl font-medium text-text-primary tabular-nums">{eur(k?.totalValue ?? 0)}</div>
          <div className="text-xs text-text-tertiary mt-1">{k?.rawActive ?? 0} artículos</div>
        </button>

        <button type="button" onClick={() => onNavigate('existencias')}
          className="text-left bg-page rounded-lg p-4 border border-border-default hover:border-accent/40 transition-base">
          <div className="text-[12px] uppercase tracking-wide text-text-secondary mb-1">Cobertura</div>
          <div className="text-2xl font-medium text-text-primary tabular-nums">{coveragePct}%</div>
          <div className={`text-xs mt-1 ${(k?.orphans ?? 0) > 0 ? 'text-warning' : 'text-text-tertiary'}`}>
            {(k?.orphans ?? 0)} sin zona{(k?.orphanValue ?? 0) > 0 ? ` · ${eur(k?.orphanValue ?? 0)}` : ''}
          </div>
        </button>

        <button type="button" onClick={() => onNavigate('inventarios')}
          className="text-left bg-page rounded-lg p-4 border border-border-default hover:border-accent/40 transition-base">
          <div className="text-[12px] uppercase tracking-wide text-text-secondary mb-1">Colocados</div>
          <div className="text-2xl font-medium text-text-primary tabular-nums">{k?.placed ?? 0}</div>
          <div className="text-xs text-text-tertiary mt-1">en alguna zona</div>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => onNavigate('existencias')}
          className="text-left bg-page rounded-lg p-4 border border-dashed border-border-default opacity-80">
          <div className="text-[12px] uppercase tracking-wide text-text-secondary mb-1">Bajo mínimo</div>
          <div className="text-sm text-text-tertiary">Próximamente · niveles máx/mín</div>
        </button>
        <button type="button" onClick={() => onNavigate('avt')}
          className="text-left bg-page rounded-lg p-4 border border-dashed border-border-default opacity-80">
          <div className="text-[12px] uppercase tracking-wide text-text-secondary mb-1">Desviación teórico vs real</div>
          <div className="text-sm text-text-tertiary">Próximamente · AvT</div>
        </button>
      </div>
    </div>
  )
}

// ── Sección de conteos del local ──
function CountsSection({
  counts, loading, onOpen, onNew,
}: {
  counts: InventoryCount[]
  loading: boolean
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const KIND_LABEL: Record<string, string> = { cycle: 'Cíclico', audit: 'Auditoría', full: 'Completo' }
  const STATUS_LABEL: Record<string, string> = {
    abierto: 'Abierto', contando: 'Contando', en_revision: 'En revisión', aprobado: 'Aprobado', anulado: 'Anulado',
  }
  const STATUS_CLASS: Record<string, string> = {
    abierto: 'bg-page text-text-secondary border-border-default',
    contando: 'bg-accent-bg text-accent border-accent/20',
    en_revision: 'bg-warning-bg text-warning border-warning/20',
    aprobado: 'bg-success-bg text-success border-success/20',
    anulado: 'bg-danger-bg text-danger border-danger/20',
  }
  const fmt = (v: string | null) => v
    ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v))
    : '—'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">Conteos de este local. Cuenta a ciegas y revisa las diferencias.</p>
        <button type="button" onClick={onNew}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base">
          <Plus size={15} /> Nuevo conteo
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Cargando…</div>
      ) : counts.length === 0 ? (
        <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
          <ClipboardList size={28} className="mx-auto mb-2 text-text-tertiary" />
          Aún no hay conteos. Crea el primero con "Nuevo conteo".
        </div>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          {counts.map(c => (
            <button key={c.id} type="button" onClick={() => onOpen(c.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left border-t border-border-default first:border-t-0 hover:bg-page transition-base">
              <span className="font-medium text-text-primary">{c.code ?? 'Conteo'}</span>
              <span className="text-xs text-text-tertiary">{KIND_LABEL[c.kind] ?? c.kind}</span>
              <span className="text-xs text-text-tertiary">· {c.lineCount ?? 0} líneas</span>
              <span className="text-xs text-text-tertiary ml-auto">{fmt(c.createdAt)}</span>
              <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[c.status]}`}>{STATUS_LABEL[c.status]}</span>
              <ChevronRight size={16} className="text-text-tertiary" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Modal: nuevo conteo (kind + alcance) ──
function NewCountModal({
  areas, onClose, onCreate,
}: {
  areas: StorageArea[]
  onClose: () => void
  onCreate: (kind: InventoryCountKind, scope: 'areas' | 'full', areaIds: string[]) => void
}) {
  const [kind, setKind] = useState<InventoryCountKind>('cycle')
  const [scope, setScope] = useState<'areas' | 'full'>('areas')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggleArea(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const canCreate = scope === 'full' || selected.size > 0

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-card rounded-lg border border-border-default shadow-lg w-full max-w-md my-8">
        <div className="px-5 py-3 border-b border-border-default flex items-center justify-between">
          <h3 className="text-base font-medium text-text-primary">Nuevo conteo</h3>
          <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <span className="block text-xs text-text-secondary mb-1.5">Tipo</span>
            <div className="flex gap-2">
              {([['cycle', 'Cíclico'], ['audit', 'Auditoría'], ['full', 'Completo']] as const).map(([kk, label]) => (
                <button key={kk} type="button" onClick={() => setKind(kk)}
                  className={`px-3 py-1.5 text-sm rounded-md border transition-base ${kind === kk ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs text-text-secondary mb-1.5">Alcance</span>
            <div className="flex gap-2 mb-2">
              <button type="button" onClick={() => setScope('areas')}
                className={`px-3 py-1.5 text-sm rounded-md border transition-base ${scope === 'areas' ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
                Por zonas
              </button>
              <button type="button" onClick={() => setScope('full')}
                className={`px-3 py-1.5 text-sm rounded-md border transition-base ${scope === 'full' ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
                Todo el local
              </button>
            </div>
            {scope === 'areas' && (
              areas.length === 0 ? (
                <p className="text-xs text-text-tertiary">No hay zonas. Crea zonas o usa "Todo el local".</p>
              ) : (
                <div className="border border-border-default rounded-md max-h-48 overflow-y-auto">
                  {areas.map(a => (
                    <button key={a.id} type="button" onClick={() => toggleArea(a.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left border-t border-border-default first:border-t-0 hover:bg-page transition-base ${selected.has(a.id) ? 'text-text-primary' : 'text-text-secondary'}`}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${selected.has(a.id) ? 'bg-accent border-accent' : 'border-border-default'}`}>
                        {selected.has(a.id) && <span className="text-text-on-accent text-[10px]">✓</span>}
                      </span>
                      {a.parentId && <span className="text-text-tertiary">└</span>}
                      {a.name}
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border-default flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-md border border-border-default text-text-secondary hover:bg-page transition-base">Cancelar</button>
          <button type="button" disabled={!canCreate}
            onClick={() => onCreate(kind, scope, Array.from(selected))}
            className="px-3 py-2 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
            Crear y contar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sección de consumo teórico del local (capa 2) ──
type RangeKey = 'today' | '7d' | '30d' | 'month' | 'all'

function rangeFor(key: RangeKey): { from: string | null; to: string | null; label: string } {
  const now = new Date()
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const iso = (d: Date) => d.toISOString()
  const tomorrow = startOfDay(new Date(now.getTime() + 86400000))
  switch (key) {
    case 'today': return { from: iso(startOfDay(now)), to: iso(tomorrow), label: 'Hoy' }
    case '7d':    return { from: iso(startOfDay(new Date(now.getTime() - 6 * 86400000))), to: iso(tomorrow), label: 'Últimos 7 días' }
    case '30d':   return { from: iso(startOfDay(new Date(now.getTime() - 29 * 86400000))), to: iso(tomorrow), label: 'Últimos 30 días' }
    case 'month': return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(tomorrow), label: 'Mes actual' }
    case 'all':   return { from: null, to: null, label: 'Todo el histórico' }
  }
}

function ConsumptionSection({
  accountId, locationId, onError, onFlash,
}: {
  accountId: string
  locationId: string
  onError: (m: string) => void
  onFlash: (m: string) => void
}) {
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d')
  const [rows, setRows] = useState<ConsumptionByRaw[]>([])
  const [loading, setLoading] = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  const range = useMemo(() => rangeFor(rangeKey), [rangeKey])

  useEffect(() => {
    if (!accountId || !locationId) { setRows([]); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const data = await listConsumptionByRaw({
          accountId, locationId, from: range.from, to: range.to,
        })
        if (!cancelled) setRows(data)
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : 'Error cargando el consumo.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountId, locationId, range.from, range.to, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRecompute() {
    if (!accountId) return
    setRecomputing(true); onError('')
    try {
      const res = await recomputeConsumption({ accountId, from: range.from, to: range.to })
      onFlash(`Consumo recalculado: ${res.linesProcessed} líneas, ${res.movementsWritten} movimientos.`)
      setReloadTick(t => t + 1)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo recalcular el consumo.')
    } finally {
      setRecomputing(false)
    }
  }

  const totalEur = useMemo(() => rows.reduce((s, r) => s + r.valueEur, 0), [rows])
  const fmtEur = (v: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
  const fmtQty = (v: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-text-secondary">
          Consumo teórico (ventas × escandallo) de este local. Lo que tus ventas dicen que se gastó.
        </p>
        <button type="button" onClick={handleRecompute} disabled={recomputing}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
          {recomputing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Recalcular consumo
        </button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {([['today', 'Hoy'], ['7d', '7 días'], ['30d', '30 días'], ['month', 'Mes actual'], ['all', 'Todo']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setRangeKey(k)}
            className={`px-2.5 py-1 text-xs rounded-md border transition-base ${rangeKey === k ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
          <TrendingDown size={28} className="mx-auto mb-2 text-text-tertiary" />
          Sin consumo en este periodo. Si acabas de conectar las ventas, pulsa "Recalcular consumo".
        </div>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
            <span className="flex-1">Ingrediente</span>
            <span className="w-28 text-right">Consumido</span>
            <span className="w-20 text-right">Ventas</span>
            <span className="w-24 text-right">Coste</span>
          </div>
          {rows.map(r => (
            <div key={r.recipeItemId} className="flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0">
              <span className="flex-1 text-text-primary">{r.itemName}</span>
              <span className="w-28 text-right text-text-secondary tabular-nums">
                {fmtQty(r.qtyBase)}{r.unitAbbr ? ` ${r.unitAbbr}` : ''}
              </span>
              <span className="w-20 text-right text-text-tertiary tabular-nums">{r.salesCount}</span>
              <span className="w-24 text-right text-text-primary font-medium tabular-nums">{fmtEur(r.valueEur)}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 px-3 py-2.5 border-t-2 border-border-default bg-page">
            <span className="flex-1 text-sm font-medium text-text-primary">{rows.length} ingrediente{rows.length === 1 ? '' : 's'}</span>
            <span className="w-28" />
            <span className="w-20" />
            <span className="w-24 text-right text-text-primary font-semibold tabular-nums">{fmtEur(totalEur)}</span>
          </div>
        </div>
      )}

      <p className="text-xs text-text-tertiary">
        El consumo es teórico (lo que el escandallo dice que deberías haber gastado). Cuando hagas un
        conteo real, la diferencia contra esto es tu merma — el AvT.
      </p>
    </div>
  )
}
