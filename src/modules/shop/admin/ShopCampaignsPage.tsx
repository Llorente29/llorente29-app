// src/modules/shop/admin/ShopCampaignsPage.tsx
//
// G1 — Gestor de campañas del Shop. Lista de tarjetas-fila (Uber Eats Manager):
// Sistema (bienvenida/frecuencia, dorado) y Código (manual, gris), con badges de
// estado (Activa/Programada/Pausada/Caducada), config legible, rendimiento REAL a
// la derecha y acciones. "+ Nueva campaña" abre un modal con impacto de margen en
// vivo (preview_coupon_impact, reutilizado). Los de sistema se configuran en su
// sección de Diseño de la tienda; aquí solo se pausan/reactivan.
//
// Autocontenida (estilos inline). accountId vía useActiveAccount (como ShopDesignPage).

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { type DiscountType } from '@/modules/shop/admin/couponAdminService'
import {
  listCampaigns, saveCampaign, toggleCampaign, saveCampaignError,
  deleteCampaign, deleteCampaignError, getCampaignPerformance,
  getCampaignMenuTree, getCampaignScope, createMirrorItem,
  type Campaign, type CampaignStatus, type CampaignKind, type ScopeRef,
  type CampaignMenuTree, type TreeItem, type CampaignPerformance,
} from '@/modules/shop/admin/campaignService'
import CampaignsOverviewTab from '@/modules/shop/admin/CampaignsOverviewTab'
import { countUnackedFirings, acknowledgeFirings } from '@/modules/shop/admin/campaignRulesService'

const C = {
  surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', page: '#F7F7F5',
  accent: '#FF5436',
  green: '#16A05B', greenDeep: '#0E6B38', greenBg: '#F0FAF4',
  amber: '#8A5B0A', amberBg: '#FFF6E2', amberLine: '#E9A81C', gold: '#FFF3D6', goldLine: '#F0DDB4',
  blue: '#1D4ED8', blueBg: '#EAF0FF', red: '#C23B22', pill: '#EEEEEB',
}

function eur(n: number | null | undefined): string { return n == null ? '—' : `${n.toFixed(2).replace('.', ',')} €` }
function pct(n: number | null | undefined): string { return n == null ? '—' : `${n.toFixed(1).replace('.', ',')}%` }
function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return '' }
}
function promoText(t: DiscountType, v: number): string {
  return t === 'percent' ? `${String(v).replace('.', ',')}%` : eur(v)
}
function roiText(n: number | null): string { return n == null ? '' : `ROI ${n.toFixed(1).replace('.', ',')}×` }
function roiColor(n: number | null): string { return n == null ? '#8A857C' : n >= 2 ? '#0E6B38' : n >= 1 ? '#8A5B0A' : '#C23B22' }

// datetime-local <-> ISO (respeta la hora local del operador).
function pad(n: number): string { return String(n).padStart(2, '0') }
function isoToLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

const STATUS_META: Record<CampaignStatus, { label: string; style: CSSProperties }> = {
  active:    { label: 'Activa',     style: { color: C.greenDeep, background: C.greenBg } },
  scheduled: { label: 'Programada', style: { color: C.blue, background: C.blueBg } },
  paused:    { label: 'Pausada',    style: { color: C.inkDim, background: C.pill } },
  expired:   { label: 'Caducada',   style: { color: C.inkFaint, background: C.pill } },
}

const WD_LABELS = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D']

// value=100 en bogo = 2x1 clásico; si no, "2ª al -X%".
function bogoLabel(v: number): string { return v >= 100 ? '2x1' : `2ª al -${String(v).replace('.', ',')}%` }

function kindLabel(c: Campaign): string {
  return c.isSystem ? 'Sistema'
    : c.kind === 'item_percent' ? 'Carta'
    : c.kind === 'free_delivery' ? 'Envío'
    : c.kind === 'bogo' ? '2x1'
    : c.kind === 'free_item' ? 'Regalo'
    : 'Código'
}

function configLine(c: Campaign): string {
  const parts: string[] = []
  if (c.kind === 'free_delivery') parts.push('Envío gratis')
  else if (c.kind === 'item_percent') parts.push(`${promoText('percent', c.value)} en platos`)
  else if (c.kind === 'bogo') parts.push(`${bogoLabel(c.value)} en platos`)
  else if (c.kind === 'free_item') parts.push('Plato de regalo')
  else parts.push(promoText(c.discountType, c.value))
  if (c.kind === 'frequency' && c.frequencyThreshold) parts.push(`cada ${c.frequencyThreshold} pedidos`)
  if (c.firstOrderOnly) parts.push('primer pedido')
  if (c.autoApply && c.kind !== 'frequency' && c.kind !== 'free_delivery') parts.push('automática')
  if (c.code) parts.push(`código ${c.code}`)
  if (c.minSubtotal != null) parts.push(`mín ${eur(c.minSubtotal)}`)
  if (c.weekdays && c.weekdays.length) parts.push(c.weekdays.map((n) => WD_LABELS[n] ?? '').join(''))
  if (c.timeFrom && c.timeTo) parts.push(`${c.timeFrom.slice(0, 5)}–${c.timeTo.slice(0, 5)}`)
  if (c.startsAt) parts.push(`desde ${fmtDate(c.startsAt)}`)
  if (c.endsAt) parts.push(`hasta ${fmtDate(c.endsAt)}`)
  if (c.maxRedemptions != null) parts.push(`máx ${c.maxRedemptions} usos`)
  if (c.budgetMax != null) parts.push(`tope ${eur(c.budgetMax)}`)
  return parts.join(' · ')
}

// ── Filtros de la lista ─────────────────────────────────────────────────────
type TypeFilter = 'all' | 'order' | 'item' | 'free' | 'system'
type StatusFilter = 'all' | CampaignStatus
const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'order', label: '% pedido' },
  { key: 'item', label: '% platos' },
  { key: 'free', label: 'Envío' },
  { key: 'system', label: 'Sistema' },
]
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'active', label: 'Activas' },
  { key: 'paused', label: 'Pausadas' },
  { key: 'scheduled', label: 'Programadas' },
  { key: 'expired', label: 'Caducadas' },
]
function matchType(c: Campaign, t: TypeFilter): boolean {
  if (t === 'all') return true
  if (t === 'system') return c.isSystem
  if (c.isSystem) return false
  if (t === 'order') return c.kind === 'standard'
  if (t === 'item') return c.kind === 'item_percent' || c.kind === 'bogo'
  if (t === 'free') return c.kind === 'free_delivery'
  return true
}

export default function ShopCampaignsPage() {
  const { activeAccountId: accountId } = useActiveAccount()
  const navigate = useNavigate()
  const [rows, setRows] = useState<Campaign[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [modal, setModal] = useState<null | { mode: 'new' | 'edit' | 'clone'; c?: Campaign }>(null)
  const [perf, setPerf] = useState<Campaign | null>(null)
  const [tab, setTab] = useState<'list' | 'overview'>('list')
  const [ruleFired, setRuleFired] = useState(0)   // campañas encendidas por reglas sin ver (visibilidad G2d)
  const [q, setQ] = useState('')
  const [typeF, setTypeF] = useState<TypeFilter>('all')
  const [statusF, setStatusF] = useState<StatusFilter>('all')

  async function refresh() {
    if (!accountId) return
    setRows(await listCampaigns(accountId))
  }
  useEffect(() => { setRows(null); refresh() /* eslint-disable-next-line */ }, [accountId])
  useEffect(() => { if (accountId) countUnackedFirings(accountId).then(setRuleFired).catch(() => {}) }, [accountId])

  async function onSeeRules() {
    if (accountId) await acknowledgeFirings(accountId)
    setRuleFired(0)
    navigate('../reglas')
  }

  async function onToggle(c: Campaign) {
    if (!accountId || busyId) return
    setBusyId(c.id)
    const nextActive = c.status === 'paused'   // pausada -> reactivar; cualquier otra -> pausar
    await toggleCampaign(accountId, c.id, nextActive)
    setBusyId(null)
    refresh()
  }

  async function onDelete(c: Campaign): Promise<{ ok: boolean; reason?: string }> {
    if (!accountId) return { ok: false, reason: 'error' }
    const res = await deleteCampaign(accountId, c.id)
    if (res.ok) refresh()
    return res
  }

  const filtersActive = q.trim() !== '' || typeF !== 'all' || statusF !== 'all'
  function clearFilters() { setQ(''); setTypeF('all'); setStatusF('all') }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows ?? []).filter((c) =>
      matchType(c, typeF) &&
      (statusF === 'all' || c.status === statusF) &&
      (needle === '' || c.name.toLowerCase().includes(needle) || (c.code ?? '').toLowerCase().includes(needle))
    )
  }, [rows, q, typeF, statusF])
  const system = useMemo(() => filtered.filter((c) => c.isSystem), [filtered])
  const code = useMemo(() => filtered.filter((c) => !c.isSystem), [filtered])
  const s = styles

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Campañas</h1>
          <p style={s.subtitle}>Tus ofertas del Shop: las de sistema (bienvenida y fidelidad) y las que crees (código, % en platos, envío gratis). Con su rendimiento real.</p>
        </div>
        <button style={s.newBtn} onClick={() => setModal({ mode: 'new' })}>+ Nueva campaña</button>
      </div>

      <div style={s.tabs}>
        <button type="button" style={{ ...s.tab, ...(tab === 'list' ? s.tabOn : {}) }} onClick={() => setTab('list')}>Lista</button>
        <button type="button" style={{ ...s.tab, ...(tab === 'overview' ? s.tabOn : {}) }} onClick={() => setTab('overview')}>Rendimiento</button>
      </div>

      {ruleFired > 0 && (
        <button type="button" style={s.ruleBanner} onClick={onSeeRules}>
          ⚡ <b>{ruleFired}</b> {ruleFired === 1 ? 'campaña encendida' : 'campañas encendidas'} por tus reglas esta semana. <span style={s.ruleBannerLink}>Ver reglas →</span>
        </button>
      )}

      {tab === 'overview' ? (
        accountId ? (
          <CampaignsOverviewTab
            accountId={accountId}
            hasCampaigns={(rows?.length ?? 0) > 0}
            onCreate={() => setModal({ mode: 'new' })}
            onOpenCampaign={(id) => { const c = rows?.find((r) => r.id === id); if (c) setPerf(c) }}
          />
        ) : null
      ) : rows === null ? (
        <div style={s.muted}>Cargando campañas…</div>
      ) : rows.length === 0 ? (
        <div style={s.empty}>Aún no hay campañas. Crea una con “+ Nueva campaña”.</div>
      ) : (
        <>
          <div style={s.toolbar}>
            <input style={s.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o código…" />
            <div style={s.chipRow}>
              {TYPE_FILTERS.map((t) => (
                <button key={t.key} type="button" style={{ ...s.filterChip, ...(typeF === t.key ? s.filterChipOn : {}) }} onClick={() => setTypeF(t.key)}>{t.label}</button>
              ))}
            </div>
            <div style={s.chipRow}>
              {STATUS_FILTERS.map((t) => (
                <button key={t.key} type="button" style={{ ...s.filterChip, ...(statusF === t.key ? s.filterChipOn : {}) }} onClick={() => setStatusF(t.key)}>{t.label}</button>
              ))}
            </div>
          </div>

          {system.length > 0 && (
            <>
              <div style={s.sectionLabel}>Del sistema</div>
              <div style={s.list}>
                {system.map((c) => (
                  <CampaignRow key={c.id} c={c} busy={busyId === c.id}
                    onConfigure={() => navigate('../diseno')}
                    onOpenPerf={() => setPerf(c)}
                    onToggle={() => onToggle(c)} />
                ))}
              </div>
            </>
          )}

          <div style={s.sectionLabel}>Tus campañas</div>
          {code.length === 0 ? (
            <div style={s.empty}>
              {filtersActive
                ? <>Ninguna de tus campañas coincide con el filtro. <button type="button" style={s.linkBtn} onClick={clearFilters}>Quitar filtros</button></>
                : 'Aún no hay campañas propias. Crea una con “+ Nueva campaña”.'}
            </div>
          ) : (
            <div style={s.list}>
              {code.map((c) => (
                <CampaignRow key={c.id} c={c} busy={busyId === c.id}
                  onEdit={() => setModal({ mode: 'edit', c })}
                  onClone={() => setModal({ mode: 'clone', c })}
                  onDelete={() => onDelete(c)}
                  onOpenPerf={() => setPerf(c)}
                  onToggle={() => onToggle(c)} />
              ))}
            </div>
          )}
        </>
      )}

      {modal && accountId && (
        <CampaignModal
          accountId={accountId}
          mode={modal.mode}
          source={modal.c}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh() }}
        />
      )}

      {perf && accountId && (
        <PerformancePanel accountId={accountId} campaign={perf} onClose={() => setPerf(null)} />
      )}
    </div>
  )
}

// ── Fila de campaña ─────────────────────────────────────────────────────────
function CampaignRow({ c, busy, onConfigure, onEdit, onClone, onDelete, onOpenPerf, onToggle }: {
  c: Campaign; busy: boolean
  onConfigure?: () => void; onEdit?: () => void; onClone?: () => void
  onDelete?: () => Promise<{ ok: boolean; reason?: string }>; onOpenPerf?: () => void; onToggle: () => void
}) {
  const st = STATUS_META[c.status]
  const s = styles
  const [confirming, setConfirming] = useState(false)
  const [delBusy, setDelBusy] = useState(false)
  const [delNote, setDelNote] = useState<string | null>(null)

  async function confirmDelete() {
    if (!onDelete) return
    setDelBusy(true); setDelNote(null)
    const res = await onDelete()
    setDelBusy(false)
    // Si ok, el padre refresca y la fila desaparece. Si no, explicamos por qué
    // (típicamente: tiene canjes → solo se puede pausar).
    if (!res.ok) { setDelNote(deleteCampaignError(res.reason)); setConfirming(false) }
  }

  return (
    <div style={s.row}>
      <div style={s.rowInner}>
        <div style={{ ...s.rowMain, cursor: onOpenPerf ? 'pointer' : 'default' }} onClick={onOpenPerf} title={onOpenPerf ? 'Ver rendimiento' : undefined}>
          <div style={s.rowTop}>
            <span style={s.rowName}>{c.name}</span>
            <span style={{ ...s.badge, ...(c.isSystem ? s.badgeSystem : s.badgeCode) }}>{kindLabel(c)}</span>
            {c.origin === 'rule' && <span style={{ ...s.badge, ...s.badgeRule }}>⚡ Regla</span>}
            <span style={{ ...s.badge, ...st.style }}>{st.label}</span>
          </div>
          <div style={s.rowConfig}>{configLine(c)}</div>
        </div>

        <div style={{ ...s.rowPerf, cursor: onOpenPerf ? 'pointer' : 'default' }} onClick={onOpenPerf}>
          <div style={s.perfMain}>{c.redemptions} {c.redemptions === 1 ? 'canje' : 'canjes'}</div>
          <div style={s.perfSub}>
            <span style={{ color: c.discounted > 0 ? C.ink : C.inkFaint }}>−{eur(c.discounted)}</span>
            {c.roi != null
              ? <span style={{ color: roiColor(c.roi), fontWeight: 800 }}> · {roiText(c.roi)}</span>
              : c.avgMarginPct != null ? <span style={{ color: C.greenDeep }}> · margen {pct(c.avgMarginPct)}</span> : null}
          </div>
        </div>

        <div style={s.rowActions}>
          {c.isSystem ? (
            <button style={s.actBtn} onClick={onConfigure}>Configurar</button>
          ) : (
            <>
              <button style={s.actBtn} onClick={onEdit}>Editar</button>
              <button style={s.actBtn} onClick={onClone}>Clonar</button>
            </>
          )}
          <button style={{ ...s.actBtn, ...(busy ? s.actOff : {}) }} onClick={onToggle} disabled={busy}>
            {c.status === 'paused' ? 'Reactivar' : 'Pausar'}
          </button>
          {!c.isSystem && onDelete && !confirming && (
            <button style={s.delBtn} onClick={() => { setDelNote(null); setConfirming(true) }}>Eliminar</button>
          )}
        </div>
      </div>

      {confirming && (
        <div style={s.confirmBar}>
          <span style={s.confirmText}>¿Eliminar «{c.name}»? Esta acción no se puede deshacer.</span>
          <div style={s.confirmActions}>
            <button style={s.ghostSm} onClick={() => setConfirming(false)} disabled={delBusy}>Cancelar</button>
            <button style={{ ...s.delConfirm, ...(delBusy ? s.actOff : {}) }} onClick={confirmDelete} disabled={delBusy}>
              {delBusy ? 'Eliminando…' : 'Eliminar definitivamente'}
            </button>
          </div>
        </div>
      )}
      {delNote && <div style={s.delNote}>{delNote}</div>}
    </div>
  )
}

// ── Modal de creación / edición / clonación ─────────────────────────────────
function round2(n: number): number { return Math.round(n * 100) / 100 }
const WEEKDAYS: [number, string][] = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D']]
const KIND_OPTS: { kind: CampaignKind; dt?: DiscountType; label: string; hint: string }[] = [
  { kind: 'standard', dt: 'percent', label: '% del pedido', hint: 'Código con % sobre el subtotal' },
  { kind: 'standard', dt: 'fixed', label: '€ del pedido', hint: 'Código con importe fijo' },
  { kind: 'item_percent', label: '% en platos', hint: 'Oferta de carta sobre marca/categoría/platos' },
  { kind: 'bogo', label: '2x1 / 2ª unidad', hint: 'La 2ª unidad del mismo plato con % de descuento' },
  { kind: 'free_item', label: 'Plato de regalo', hint: 'Un plato gratis a partir de un mínimo' },
  { kind: 'free_delivery', label: 'Envío gratis', hint: 'Sin gastos de envío' },
]

function CampaignModal({ accountId, mode, source, onClose, onSaved }: {
  accountId: string
  mode: 'new' | 'edit' | 'clone'
  source?: Campaign
  onClose: () => void
  onSaved: () => void
}) {
  const editing = mode === 'edit'
  const s = styles
  const initKind: CampaignKind = source?.kind && source.kind !== 'frequency' ? source.kind : 'standard'
  const [kind, setKind] = useState<CampaignKind>(initKind)
  const [name, setName] = useState(source ? (mode === 'clone' ? `${source.name} (copia)` : source.name) : '')
  const [code, setCode] = useState(source?.code ? (mode === 'clone' ? `COPIA-${source.code}` : source.code) : '')
  const [discountType, setDiscountType] = useState<DiscountType>(source?.discountType ?? 'percent')
  const [value, setValue] = useState<number>(source?.value ?? 10)
  const [minSubtotal, setMinSubtotal] = useState<number | null>(source?.minSubtotal ?? null)
  const [startsAt, setStartsAt] = useState(isoToLocal(source?.startsAt ?? null))
  const [endsAt, setEndsAt] = useState(isoToLocal(source?.endsAt ?? null))
  const [maxRedemptions, setMaxRedemptions] = useState<number | null>(source?.maxRedemptions ?? null)
  const [maxPerCustomer, setMaxPerCustomer] = useState<number>(source?.maxPerCustomer ?? 1)
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set(source?.weekdays ?? []))
  const [timeFrom, setTimeFrom] = useState((source?.timeFrom ?? '').slice(0, 5))
  const [timeTo, setTimeTo] = useState((source?.timeTo ?? '').slice(0, 5))
  const [budgetMax, setBudgetMax] = useState<number | null>(source?.budgetMax ?? null)
  const [scope, setScope] = useState<ScopeRef[]>([])
  const [tree, setTree] = useState<CampaignMenuTree | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mirrorMsg, setMirrorMsg] = useState<string | null>(null)
  // Picker de alcance: marca activa + buscador (debounce) + resumen desplegable.
  const [brandFilter, setBrandFilter] = useState<string>('all')
  const [searchQ, setSearchQ] = useState('')
  const [searchDeb, setSearchDeb] = useState('')
  const [summaryOpen, setSummaryOpen] = useState(false)
  useEffect(() => { const t = setTimeout(() => setSearchDeb(searchQ), 220); return () => clearTimeout(t) }, [searchQ])

  // El árbol se recarga cada vez que el modal SE ABRE (monta), no solo al cargar
  // la página: así un plato recién creado en la Carta aparece en el buscador sin F5.
  useEffect(() => {
    let alive = true
    getCampaignMenuTree(accountId).then((t) => { if (alive) setTree(t) })
    if (source && (mode === 'edit' || mode === 'clone') && (source.kind === 'item_percent' || source.kind === 'bogo' || source.kind === 'free_item')) {
      getCampaignScope(source.id).then((sc) => { if (alive) setScope(sc) })
    }
    return () => { alive = false }
  }, [accountId, source, mode])

  const isStd = kind === 'standard', isItem = kind === 'item_percent', isFree = kind === 'free_delivery', isBogo = kind === 'bogo'
  const isFreeItem = kind === 'free_item'
  const usesScope = isItem || isBogo   // item_percent y bogo comparten el picker de alcance (multi)

  const affected: TreeItem[] = useMemo(() => {
    if (!tree || !usesScope) return []
    const byBrand = new Map<string, TreeItem[]>(), byCat = new Map<string, TreeItem[]>(), byItem = new Map<string, TreeItem>()
    for (const b of tree.brands) {
      const arr: TreeItem[] = []
      for (const c of b.categories) {
        const carr: TreeItem[] = []
        for (const it of c.items) { arr.push(it); carr.push(it); byItem.set(it.id, it) }
        byCat.set(c.id, carr)
      }
      byBrand.set(b.id, arr)
    }
    const out = new Map<string, TreeItem>()
    for (const r of scope) {
      const list = r.type === 'brand' ? byBrand.get(r.id) : r.type === 'category' ? byCat.get(r.id) : (byItem.get(r.id) ? [byItem.get(r.id)!] : [])
      for (const it of (list ?? [])) out.set(it.id, it)
    }
    return [...out.values()]
  }, [tree, scope, usesScope])

  // Carta aplanada para el buscador. El árbol completo ya viene del servidor
  // (campaign_menu_tree, reutilizado por el impacto de margen): con ~17 marcas son
  // unos cientos de platos → filtrar en cliente es instantáneo. Si algún día crece
  // demasiado, se movería la búsqueda al servidor; por ahora, cliente = inmediato.
  const flat = useMemo(() => {
    const items: { item: TreeItem; brandId: string; brandName: string; catName: string }[] = []
    const brandOfItem = new Map<string, string>()
    for (const b of tree?.brands ?? [])
      for (const c of b.categories)
        for (const it of c.items) { items.push({ item: it, brandId: b.id, brandName: b.name, catName: c.name }); brandOfItem.set(it.id, b.id) }
    return { items, brandOfItem }
  }, [tree])

  const results = useMemo(() => {
    const q = searchDeb.trim().toLowerCase()
    if (q.length < 2) return []
    return flat.items.filter((f) => (brandFilter === 'all' || f.brandId === brandFilter) && f.item.name.toLowerCase().includes(q))
  }, [searchDeb, brandFilter, flat])

  const resultsAllSel = results.length > 0 && results.every((r) => scope.some((x) => x.type === 'item' && x.id === r.item.id))
  const marcas = useMemo(() => new Set(affected.map((i) => flat.brandOfItem.get(i.id)).filter(Boolean)).size, [affected, flat])
  const curBrand = brandFilter === 'all' ? null : (tree?.brands.find((b) => b.id === brandFilter) ?? null)

  function refLabel(r: ScopeRef): string {
    if (r.type === 'brand') { const b = tree?.brands.find((x) => x.id === r.id); return `Toda la marca ${b?.name ?? ''}`.trim() }
    if (r.type === 'category') {
      for (const b of tree?.brands ?? []) { const c = b.categories.find((x) => x.id === r.id); if (c) return `${c.name} · ${b.name}` }
      return 'Categoría'
    }
    const f = flat.items.find((x) => x.item.id === r.id); return f ? `${f.item.name} · ${f.brandName}` : 'Plato'
  }

  function selectAllResults() {
    setScope((prev) => {
      if (resultsAllSel) { const ids = new Set(results.map((r) => r.item.id)); return prev.filter((x) => !(x.type === 'item' && ids.has(x.id))) }
      const have = new Set(prev.filter((x) => x.type === 'item').map((x) => x.id))
      return [...prev, ...results.filter((r) => !have.has(r.item.id)).map((r) => ({ type: 'item' as const, id: r.item.id }))]
    })
  }

  const impact = useMemo(() => {
    const floor = tree?.floorPct ?? null
    const costed = affected.filter((i) => i.costed && i.price > 0)
    const uncosted = affected.length - costed.length
    let sumNow = 0, sumAfter = 0, below = 0; const belowNames: string[] = []; let noTachado = 0
    for (const it of costed) {
      const disc = round2(it.price * (1 - value / 100))
      const mNow = (it.price - (it.cost ?? 0)) / it.price * 100
      const mAfter = disc > 0 ? (disc - (it.cost ?? 0)) / disc * 100 : 0
      sumNow += mNow; sumAfter += mAfter
      if (floor != null && mAfter < floor) { below++; if (belowNames.length < 3) belowNames.push(it.name) }
    }
    for (const it of affected) {
      if (it.refPrice != null) { const disc = round2(it.price * (1 - value / 100)); if (!(it.refPrice > disc)) noTachado++ }
    }
    return {
      floor, count: affected.length, costedCount: costed.length, uncosted,
      marginNow: costed.length ? sumNow / costed.length : null,
      marginAfter: costed.length ? sumAfter / costed.length : null,
      below, belowNames, noTachado,
    }
  }, [affected, value, tree])

  const singleItemForMirror: TreeItem | null = useMemo(() => {
    if (!isItem || scope.length !== 1 || scope[0].type !== 'item') return null
    const it = affected[0]; if (!it || it.refPrice == null) return null
    const disc = round2(it.price * (1 - value / 100))
    return it.refPrice > disc ? null : it
  }, [isItem, scope, affected, value])

  function toggleScope(r: ScopeRef) {
    setScope((prev) => prev.some((x) => x.type === r.type && x.id === r.id) ? prev.filter((x) => !(x.type === r.type && x.id === r.id)) : [...prev, r])
  }
  const scoped = (r: ScopeRef) => scope.some((x) => x.type === r.type && x.id === r.id)
  function toggleWeekday(n: number) { setWeekdays((prev) => { const st = new Set(prev); st.has(n) ? st.delete(n) : st.add(n); return st }) }

  async function onMirror() {
    if (!singleItemForMirror) return
    const r = await createMirrorItem(accountId, singleItemForMirror.id)
    if (r.ok) {
      // Recarga el árbol para que el par quede coherente sin F5.
      getCampaignMenuTree(accountId).then((t) => setTree(t)).catch(() => {})
      setMirrorMsg('Versión promo creada (oculta). En la Carta, ponle su precio y pulsa «Usar versión promo» para activarla.')
    } else {
      setMirrorMsg('No se pudo crear la versión promo.')
    }
  }

  async function onSave() {
    if (saving) return
    setSaving(true); setError(null)
    const res = await saveCampaign(accountId, {
      id: mode === 'edit' ? (source?.id ?? null) : null,
      kind,
      name,
      code: isStd ? code : null,
      discountType: isStd ? discountType : undefined,
      value: isStd || isItem || isBogo ? value : undefined,
      minSubtotal: (isStd || isFree || isFreeItem) ? minSubtotal : null,
      startsAt: localToIso(startsAt),
      endsAt: localToIso(endsAt),
      maxRedemptions,
      maxPerCustomer,
      weekdays: weekdays.size ? [...weekdays].sort((a, b) => a - b) : null,
      timeFrom: timeFrom || null,
      timeTo: timeTo || null,
      budgetMax,
      scope: usesScope || isFreeItem ? scope : undefined,
    })
    setSaving(false)
    if (!res.ok) { setError(saveCampaignError(res.reason)); return }
    onSaved()
  }

  const title = editing ? 'Editar campaña' : mode === 'clone' ? 'Clonar campaña' : 'Nueva campaña'

  return (
    <div style={s.modalWrap} onClick={onClose}>
      <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <h2 style={s.modalTitle}>{title}</h2>
          <button style={s.modalX} onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        <div style={s.modalBody}>
          {mode !== 'edit' && (
            <>
              <label style={s.label}>Tipo de campaña</label>
              <div style={s.typeGrid}>
                {KIND_OPTS.map((o) => {
                  const on = kind === o.kind && (o.kind !== 'standard' || discountType === o.dt)
                  return (
                    <button key={o.label} type="button" style={{ ...s.typeBtn, ...(on ? s.typeOn : {}) }}
                      onClick={() => { setKind(o.kind); if (o.dt) setDiscountType(o.dt) }}>
                      <span style={s.typeLabel}>{o.label}</span>
                      <span style={s.typeHint}>{o.hint}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <label style={s.label}>Nombre</label>
          <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Semana del 10%" />

          {isStd && (
            <>
              <label style={s.label}>Código</label>
              <input style={s.input} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SEMANA10" autoCapitalize="characters" />
              <div style={s.row2}>
                <div style={s.field}>
                  <label style={s.label}>Tipo</label>
                  <div style={s.seg}>
                    <button type="button" onClick={() => setDiscountType('percent')} style={{ ...s.segBtn, ...(discountType === 'percent' ? s.segOn : {}) }}>%</button>
                    <button type="button" onClick={() => setDiscountType('fixed')} style={{ ...s.segBtn, ...(discountType === 'fixed' ? s.segOn : {}) }}>€</button>
                  </div>
                </div>
                <div style={s.field}>
                  <label style={s.label}>Valor</label>
                  <div style={s.valueRow}>
                    <input type="number" min={0} value={Number.isFinite(value) ? value : 0} onChange={(e) => setValue(parseFloat(e.target.value) || 0)} style={s.input} />
                    <span style={s.unit}>{discountType === 'percent' ? '%' : '€'}</span>
                  </div>
                </div>
              </div>
              <div style={s.row2}>
                <div style={s.field}>
                  <label style={s.label}>Mínimo <span style={s.opt}>(opcional)</span></label>
                  <div style={s.valueRow}>
                    <input type="number" min={0} value={minSubtotal ?? ''} placeholder="sin mínimo" onChange={(e) => setMinSubtotal(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))} style={s.input} />
                    <span style={s.unit}>€</span>
                  </div>
                </div>
                <div style={s.field}>
                  <label style={s.label}>Máx. usos <span style={s.opt}>(opcional)</span></label>
                  <input type="number" min={1} value={maxRedemptions ?? ''} placeholder="ilimitado" onChange={(e) => setMaxRedemptions(e.target.value === '' ? null : (parseInt(e.target.value) || 0))} style={s.input} />
                </div>
              </div>
            </>
          )}

          {usesScope && (
            <>
              <div style={s.field}>
                <label style={s.label}>{isBogo ? 'Descuento de la 2ª unidad' : 'Descuento por plato'}</label>
                <div style={s.valueRow}>
                  <input type="number" min={0} max={100} value={Number.isFinite(value) ? value : 0} onChange={(e) => setValue(parseFloat(e.target.value) || 0)} style={s.input} />
                  <span style={s.unit}>%</span>
                </div>
                {isBogo && <div style={s.bogoHint}>100% = 2x1 (la 2ª gratis). 50% = la 2ª a mitad de precio. Se aplica a cada par de unidades del mismo plato.</div>}
              </div>
              <label style={s.label}>{isBogo ? '¿En qué platos el 2x1?' : '¿A qué platos?'}</label>

              {/* Selector de marca: acota categorías/platos a una marca (o todas). */}
              <div style={s.brandChips}>
                <button type="button" style={{ ...s.brandChip, ...(brandFilter === 'all' ? s.brandChipOn : {}) }} onClick={() => setBrandFilter('all')}>Todas las marcas</button>
                {tree?.brands.map((b) => (
                  <button key={b.id} type="button" style={{ ...s.brandChip, ...(brandFilter === b.id ? s.brandChipOn : {}) }} onClick={() => setBrandFilter(b.id)}>{b.name}</button>
                ))}
              </div>

              {/* Buscador de platos: cruza todas las marcas (o la activa). */}
              <input style={{ ...s.input, marginTop: 8 }} value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Busca un plato (ej. Coca Cola)…" />

              <div style={s.pickBody}>
                {searchDeb.trim().length >= 2 ? (
                  results.length === 0 ? (
                    <div style={s.pickEmpty}>Sin resultados para «{searchDeb.trim()}»{brandFilter !== 'all' ? ' en esta marca' : ''}.</div>
                  ) : (
                    <>
                      <div style={s.pickHead}>
                        <span>{results.length} {results.length === 1 ? 'resultado' : 'resultados'}</span>
                        <button type="button" style={s.pickAll} onClick={selectAllResults}>{resultsAllSel ? `Quitar los ${results.length}` : `Seleccionar los ${results.length}`}</button>
                      </div>
                      {results.map((f) => (
                        <label key={f.item.id} style={s.scRow}>
                          <input type="checkbox" checked={scoped({ type: 'item', id: f.item.id })} onChange={() => toggleScope({ type: 'item', id: f.item.id })} style={s.checkBox} />
                          <span style={s.pickName}>{f.item.name}</span>
                          <span style={s.scHint}>{f.brandName} · {eur(f.item.price)}{!f.item.costed ? ' · sin escandallo' : ''}</span>
                        </label>
                      ))}
                    </>
                  )
                ) : curBrand ? (
                  <>
                    <label style={s.scRow}><input type="checkbox" checked={scoped({ type: 'brand', id: curBrand.id })} onChange={() => toggleScope({ type: 'brand', id: curBrand.id })} style={s.checkBox} /><b>Toda la marca {curBrand.name}</b></label>
                    {curBrand.categories.map((c) => (
                      <div key={c.id} style={s.scCat}>
                        <label style={s.scRow}><input type="checkbox" checked={scoped({ type: 'category', id: c.id })} onChange={() => toggleScope({ type: 'category', id: c.id })} style={s.checkBox} />{c.name} <span style={s.scHint}>({c.items.length})</span></label>
                        {c.items.map((it) => (
                          <label key={it.id} style={{ ...s.scRow, ...s.scItem }}><input type="checkbox" checked={scoped({ type: 'item', id: it.id })} onChange={() => toggleScope({ type: 'item', id: it.id })} style={s.checkBox} />{it.name} <span style={s.scHint}>{eur(it.price)}{!it.costed ? ' · sin escandallo' : ''}</span></label>
                        ))}
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={s.pickEmpty}>Elige una marca arriba o busca un plato para empezar.</div>
                )}
              </div>

              {/* Resumen persistente: no se pierde al cambiar de marca o buscar. */}
              {scope.length > 0 && (
                <div style={s.summaryWrap}>
                  <button type="button" style={s.summaryChip} onClick={() => setSummaryOpen((v) => !v)}>
                    {affected.length} {affected.length === 1 ? 'plato' : 'platos'} de {marcas} {marcas === 1 ? 'marca' : 'marcas'} · {summaryOpen ? 'ocultar ▲' : 'ver ▼'}
                  </button>
                  {summaryOpen && (
                    <div style={s.summaryList}>
                      {scope.map((r) => (
                        <div key={`${r.type}:${r.id}`} style={s.summaryItem}>
                          <span style={s.summaryLbl}>{refLabel(r)}</span>
                          <button type="button" style={s.summaryX} onClick={() => toggleScope(r)} aria-label="Quitar">×</button>
                        </div>
                      ))}
                      <button type="button" style={s.summaryClear} onClick={() => setScope([])}>Vaciar selección</button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {isFree && (
            <div style={s.field}>
              <label style={s.label}>Mínimo para el envío gratis <span style={s.opt}>(opcional)</span></label>
              <div style={s.valueRow}>
                <input type="number" min={0} value={minSubtotal ?? ''} placeholder="sin mínimo" onChange={(e) => setMinSubtotal(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))} style={s.input} />
                <span style={s.unit}>€</span>
              </div>
            </div>
          )}

          {isFreeItem && (
            <>
              <div style={s.field}>
                <label style={s.label}>Regalo desde <span style={s.opt}>(mínimo del pedido)</span></label>
                <div style={s.valueRow}>
                  <input type="number" min={0} value={minSubtotal ?? ''} placeholder="15" onChange={(e) => setMinSubtotal(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))} style={s.input} />
                  <span style={s.unit}>€</span>
                </div>
              </div>
              <label style={s.label}>¿Qué plato de regalo? <span style={s.opt}>(uno)</span></label>
              <div style={s.brandChips}>
                <button type="button" style={{ ...s.brandChip, ...(brandFilter === 'all' ? s.brandChipOn : {}) }} onClick={() => setBrandFilter('all')}>Todas las marcas</button>
                {tree?.brands.map((b) => (
                  <button key={b.id} type="button" style={{ ...s.brandChip, ...(brandFilter === b.id ? s.brandChipOn : {}) }} onClick={() => setBrandFilter(b.id)}>{b.name}</button>
                ))}
              </div>
              <input style={{ ...s.input, marginTop: 8 }} value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Busca el plato de regalo…" />
              <div style={s.pickBody}>
                {(searchDeb.trim().length >= 2 ? results : (curBrand ? flat.items.filter((f) => f.brandId === curBrand.id) : [])).map((f) => {
                  const on = scope.some((x) => x.type === 'item' && x.id === f.item.id)
                  return (
                    <label key={f.item.id} style={s.scRow}>
                      <input type="radio" name="fv-gift" checked={on} onChange={() => setScope([{ type: 'item', id: f.item.id }])} style={s.checkBox} />
                      <span style={s.pickName}>{f.item.name}</span>
                      <span style={s.scHint}>{f.brandName} · {eur(f.item.price)}</span>
                    </label>
                  )
                })}
                {searchDeb.trim().length < 2 && !curBrand && <div style={s.pickEmpty}>Elige una marca o busca el plato de regalo.</div>}
              </div>
              {scope[0]?.type === 'item' && (() => {
                const g = flat.items.find((x) => x.item.id === scope[0].id)
                return g ? <div style={s.summaryWrap}><span style={s.summaryChip}>🎁 Regalo: {g.item.name} · {eur(g.item.price)}</span></div> : null
              })()}
            </>
          )}

          {(usesScope || isFree || isFreeItem) && (
            <>
              <label style={s.label}>Días <span style={s.opt}>(vacío = todos)</span></label>
              <div style={s.wdRow}>
                {WEEKDAYS.map(([n, l]) => <button key={n} type="button" style={{ ...s.wdBtn, ...(weekdays.has(n) ? s.wdOn : {}) }} onClick={() => toggleWeekday(n)}>{l}</button>)}
              </div>
              <div style={s.row2}>
                <div style={s.field}><label style={s.label}>Desde <span style={s.opt}>(hora)</span></label><input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} style={s.input} /></div>
                <div style={s.field}><label style={s.label}>Hasta <span style={s.opt}>(hora)</span></label><input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} style={s.input} /></div>
              </div>
            </>
          )}

          <div style={s.row2}>
            <div style={s.field}><label style={s.label}>Empieza <span style={s.opt}>(opcional)</span></label><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={s.input} /></div>
            <div style={s.field}><label style={s.label}>Termina <span style={s.opt}>(opcional)</span></label><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={s.input} /></div>
          </div>

          {(usesScope || isFree) && (
            <div style={s.field}>
              <label style={s.label}>Presupuesto máx. <span style={s.opt}>(€ de descuento; opcional)</span></label>
              <div style={s.valueRow}>
                <input type="number" min={0} value={budgetMax ?? ''} placeholder="sin tope" onChange={(e) => setBudgetMax(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))} style={s.input} />
                <span style={s.unit}>€</span>
              </div>
            </div>
          )}

          {isBogo && affected.length > 0 && (
            <div style={s.impact}>
              <div style={s.impactHead}>Coste del {bogoLabel(value)} ({affected.length} {affected.length === 1 ? 'plato' : 'platos'} en la oferta)</div>
              <div style={s.note}>Por cada 2 unidades del mismo plato, la 2ª lleva un <b>−{String(value).replace('.', ',')}%</b>. El coste por par = ese % del precio del plato.</div>
              {(() => {
                const costed = affected.filter((i) => i.price > 0)
                if (!costed.length) return null
                const avgPerPair = costed.reduce((sum, i) => sum + i.price * (value / 100), 0) / costed.length
                return <div style={{ ...s.note, marginTop: 6 }}>Coste medio por par: <b>{eur(round2(avgPerPair))}</b> (media sobre {costed.length} {costed.length === 1 ? 'plato' : 'platos'}).</div>
              })()}
            </div>
          )}

          {isItem && affected.length > 0 && (
            <div style={s.impact}>
              <div style={s.impactHead}>Impacto en tu margen ({impact.costedCount} de {impact.count} con escandallo)</div>
              <div style={s.marginBig}>
                <span style={s.marginNow}>{pct(impact.marginNow)}</span>
                <span style={s.arrow}>→</span>
                <span style={{ ...s.marginAfter, color: (impact.floor != null && impact.marginAfter != null && impact.marginAfter < impact.floor) ? C.red : C.greenDeep }}>{pct(impact.marginAfter)}</span>
                <span style={s.marginCaption}>margen medio por plato</span>
              </div>
              {impact.uncosted > 0 && <div style={s.warn}>{impact.uncosted} platos sin escandallo (no cuentan en el margen).</div>}
              {impact.below > 0 && <div style={s.warn}>{impact.below} platos quedarían bajo el suelo{impact.belowNames.length ? `: ${impact.belowNames.join(', ')}${impact.below > impact.belowNames.length ? '…' : ''}` : ''}.</div>}
              {impact.noTachado === 0
                ? <div style={s.okNote}>✓ Tachado legal verificado en los platos con historial.</div>
                : <div style={s.warn}>{impact.noTachado} platos no mostrarán tachado (su precio de referencia de 30 días no supera el precio con descuento): se verá el badge sin precio anterior.</div>}
              {singleItemForMirror && (
                <div style={s.mirrorBox}>
                  <div style={s.mirrorText}>Para vender <b>{singleItemForMirror.name}</b> a precio promo, crea una versión promo (artículo espejo): nace sin historial, así se vende a precio limpio, <b>sin tachado</b> (no hay precio anterior que tachar).</div>
                  <button type="button" style={s.mirrorBtn} onClick={onMirror}>Crear versión promo (espejo)</button>
                  {mirrorMsg && <div style={s.mirrorMsg}>{mirrorMsg}</div>}
                </div>
              )}
            </div>
          )}

          <div style={s.field}>
            <label style={s.label}>Máx. por cliente</label>
            <input type="number" min={1} value={Number.isFinite(maxPerCustomer) ? maxPerCustomer : 1} onChange={(e) => setMaxPerCustomer(Math.max(1, parseInt(e.target.value) || 1))} style={{ ...s.input, maxWidth: 120 }} />
          </div>
        </div>

        <div style={s.modalFoot}>
          {error && <span style={s.err}>{error}</span>}
          <button style={s.ghost} onClick={onClose}>Cancelar</button>
          <button style={{ ...s.save, ...(saving ? { opacity: 0.6 } : {}) }} onClick={onSave} disabled={saving}>
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear campaña'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Panel de rendimiento (G2e) ──────────────────────────────────────────────
function PerfCard({ label, value, sub, valueColor, subColor }: { label: string; value: string; sub?: string; valueColor?: string; subColor?: string }) {
  const s = styles
  return (
    <div style={s.perfCard}>
      <div style={s.perfCardLabel}>{label}</div>
      <div style={{ ...s.perfCardValue, ...(valueColor ? { color: valueColor } : {}) }}>{value}</div>
      {sub && <div style={{ ...s.perfCardSub, ...(subColor ? { color: subColor } : {}) }}>{sub}</div>}
    </div>
  )
}

function PerformancePanel({ accountId, campaign, onClose }: { accountId: string; campaign: Campaign; onClose: () => void }) {
  const s = styles
  const [range, setRange] = useState<'7d' | '30d' | 'all'>('30d')
  const [data, setData] = useState<CampaignPerformance | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const now = Date.now()
    const from = range === 'all' ? null : new Date(now - (range === '7d' ? 7 : 30) * 86400000).toISOString()
    getCampaignPerformance(accountId, campaign.id, from, null).then((d) => { if (alive) { setData(d); setLoading(false) } })
    return () => { alive = false }
  }, [accountId, campaign.id, range])

  const ticketDelta = data && data.ticketWith != null && data.ticketWithout != null ? round2(data.ticketWith - data.ticketWithout) : null
  const maxSeries = data && data.series.length ? Math.max(1, ...data.series.map((p) => p.redemptions)) : 1

  return (
    <div style={s.modalWrap} onClick={onClose}>
      <div style={{ ...s.modalCard, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <h2 style={s.modalTitle}>Rendimiento · {campaign.name}</h2>
          <button style={s.modalX} onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div style={s.modalBody}>
          <div style={s.chipRow}>
            {(['7d', '30d', 'all'] as const).map((r) => (
              <button key={r} type="button" style={{ ...s.filterChip, ...(range === r ? s.filterChipOn : {}) }} onClick={() => setRange(r)}>
                {r === '7d' ? '7 días' : r === '30d' ? '30 días' : 'Todo'}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={s.muted}>Cargando rendimiento…</div>
          ) : !data ? (
            <div style={s.muted}>No se pudo cargar el rendimiento.</div>
          ) : (
            <>
              <div style={s.perfGrid}>
                <PerfCard label="Canjes" value={String(data.redemptions)} />
                <PerfCard label="Invertido" value={eur(data.cost)} sub={campaign.kind === 'free_item' && !data.giftCosted ? 'regalo sin escandallo' : undefined} />
                <PerfCard label="Ventas atribuidas" value={String(data.salesCount)} sub={data.salesCount > 0 ? eur(data.salesEur) : undefined} />
                <PerfCard label="Ticket medio" value={data.ticketWith != null ? eur(data.ticketWith) : '—'}
                  sub={ticketDelta != null ? `${ticketDelta >= 0 ? '+' : ''}${eur(ticketDelta)} vs sin la campaña` : undefined}
                  subColor={ticketDelta != null ? (ticketDelta >= 0 ? C.greenDeep : C.red) : undefined} />
                <PerfCard label="Margen real" value={data.marginReal != null ? eur(data.marginReal) : '—'}
                  sub={data.marginKnown > 0 ? `${data.marginKnown} ${data.marginKnown === 1 ? 'canje' : 'canjes'} con escandallo` : undefined} />
                <PerfCard label="ROI" value={data.roi != null ? roiText(data.roi) : '—'} valueColor={roiColor(data.roi)} />
              </div>

              {ticketDelta != null && (
                <div style={s.perfNote}>Ticket con la campaña <b>{eur(data.ticketWith!)}</b> · Shop sin ella <b>{eur(data.ticketWithout!)}</b>.</div>
              )}

              {data.marginMissing > 0 && (
                <div style={s.warn}>{data.marginMissing} {data.marginMissing === 1 ? 'canje no cuenta' : 'canjes no cuentan'} en el margen (sin escandallo). El margen real es solo de los canjes con coste conocido — no lo maquillamos.</div>
              )}

              {data.series.length > 0 ? (
                <div style={s.perfChart}>
                  <div style={s.perfChartLabel}>Canjes por día</div>
                  <div style={s.perfBars}>
                    {data.series.map((p) => (
                      <div key={p.day} style={s.perfBarCol} title={`${p.day}: ${p.redemptions} ${p.redemptions === 1 ? 'canje' : 'canjes'}`}>
                        <div style={{ ...s.perfBar, height: `${Math.max(4, Math.round((p.redemptions / maxSeries) * 100))}%` }} />
                        <span style={s.perfBarDay}>{p.day.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={s.empty}>Aún no hay canjes en este periodo.</div>
              )}
            </>
          )}
        </div>
        <div style={s.modalFoot}>
          <button style={s.ghost} onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { padding: '4px 4px 40px', maxWidth: 960 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 },
  h1: { fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: C.ink, margin: 0 },
  subtitle: { fontSize: 13.5, color: C.inkDim, marginTop: 4, maxWidth: 560, lineHeight: 1.45 },
  newBtn: { flexShrink: 0, border: 'none', background: C.accent, color: '#fff', borderRadius: 999, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 4, marginBottom: 18, borderBottom: `1px solid ${C.line}` },
  tab: { border: 'none', background: 'none', color: C.inkDim, padding: '9px 4px', marginRight: 16, fontSize: 14.5, fontWeight: 700, cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: -1 },
  tabOn: { color: C.ink, borderBottom: `2px solid ${C.accent}` },
  muted: { color: C.inkDim, fontSize: 14, padding: '40px 0', textAlign: 'center' },
  sectionLabel: { fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.inkFaint, margin: '18px 0 10px' },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  empty: { border: `1px dashed ${C.lineInput}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.inkDim, fontSize: 13.5 },

  row: { display: 'flex', flexDirection: 'column', background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px' },
  rowInner: { display: 'flex', alignItems: 'center', gap: 16 },
  rowMain: { flex: 1, minWidth: 0 },
  rowTop: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowName: { fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: '-.01em' },
  badge: { fontSize: 11, fontWeight: 800, letterSpacing: '.02em', padding: '3px 9px', borderRadius: 999 },
  badgeSystem: { color: C.amber, background: C.gold, border: `1px solid ${C.goldLine}` },
  badgeCode: { color: C.inkDim, background: C.pill },
  badgeRule: { color: '#1D4ED8', background: '#EAF0FF', border: '1px solid #1D4ED833' },
  ruleBanner: { display: 'block', width: '100%', textAlign: 'left', background: '#EAF0FF', border: '1px solid #1D4ED833', color: C.ink, borderRadius: 12, padding: '11px 15px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginBottom: 16, lineHeight: 1.4 },
  ruleBannerLink: { color: '#1D4ED8', fontWeight: 800, marginLeft: 4 },
  rowConfig: { fontSize: 12.5, color: C.inkDim, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowPerf: { textAlign: 'right', flexShrink: 0, minWidth: 130 },
  perfMain: { fontSize: 15, fontWeight: 800, color: C.ink },
  perfSub: { fontSize: 12, color: C.inkDim, marginTop: 2 },
  rowActions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  actBtn: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.ink, borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  actOff: { opacity: 0.5, cursor: 'default' },
  linkBtn: { border: 'none', background: 'none', color: C.accent, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline' },

  // Buscador + filtros de la lista
  toolbar: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 },
  search: { width: '100%', border: `1px solid ${C.lineInput}`, borderRadius: 10, padding: '9px 12px', fontSize: 14, color: C.ink, background: '#fff', boxSizing: 'border-box' },
  chipRow: { display: 'flex', gap: 7, flexWrap: 'wrap' },
  filterChip: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  filterChipOn: { background: C.ink, color: '#fff', border: `1px solid ${C.ink}` },

  // Eliminar campaña
  delBtn: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.red, borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  confirmBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12, padding: '10px 12px', background: '#FDF3F1', border: `1px solid ${C.red}33`, borderRadius: 10 },
  confirmText: { fontSize: 12.5, color: C.red, fontWeight: 600, lineHeight: 1.4 },
  confirmActions: { display: 'flex', gap: 8, flexShrink: 0 },
  ghostSm: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.ink, borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  delConfirm: { border: 'none', background: C.red, color: '#fff', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' },
  delNote: { marginTop: 10, padding: '8px 11px', background: C.amberBg, border: `1px solid ${C.amberLine}`, borderRadius: 10, fontSize: 12, color: C.amber, lineHeight: 1.4 },

  modalWrap: { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(20,14,10,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { background: '#fff', borderRadius: 18, maxWidth: 560, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.3)' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: `1px solid ${C.line}` },
  modalTitle: { fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', margin: 0 },
  modalX: { background: C.page, border: `1px solid ${C.line}`, borderRadius: '50%', width: 32, height: 32, fontSize: 20, lineHeight: 1, cursor: 'pointer', color: C.ink },
  modalBody: { padding: '18px 22px', overflowY: 'auto' },
  modalFoot: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '14px 22px', borderTop: `1px solid ${C.line}` },

  label: { display: 'block', fontSize: 12.5, fontWeight: 600, color: C.inkDim, margin: '12px 0 5px' },
  opt: { fontWeight: 400, color: C.inkFaint },
  input: { width: '100%', border: `1px solid ${C.lineInput}`, borderRadius: 10, padding: '9px 12px', fontSize: 14, color: C.ink, background: '#fff', boxSizing: 'border-box' },
  presets: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  presetBtn: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.ink, borderRadius: 999, padding: '5px 13px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  row2: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  field: { flex: 1, minWidth: 150 },
  seg: { display: 'flex', border: `1px solid ${C.lineInput}`, borderRadius: 10, overflow: 'hidden' },
  segBtn: { flex: 1, border: 'none', background: '#fff', color: C.inkDim, padding: '9px 10px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  segOn: { background: C.ink, color: '#fff' },
  valueRow: { display: 'flex', alignItems: 'center', gap: 8 },
  unit: { fontSize: 14, fontWeight: 500, color: C.inkDim },
  impact: { marginTop: 16, background: C.page, border: `1px solid ${C.line}`, borderRadius: 12, padding: '13px 15px', transition: 'opacity .15s' },
  impactHead: { fontSize: 12.5, fontWeight: 600, color: C.inkDim, marginBottom: 9 },
  marginBig: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  marginNow: { fontSize: 22, fontWeight: 600, color: C.inkFaint },
  arrow: { fontSize: 17, color: C.inkFaint },
  marginAfter: { fontSize: 24, fontWeight: 600 },
  marginCaption: { fontSize: 12, color: C.inkFaint },
  note: { fontSize: 13, color: C.inkDim, lineHeight: 1.45 },
  bogoHint: { fontSize: 11.5, color: C.inkFaint, lineHeight: 1.4, marginTop: 6 },
  warn: { marginTop: 10, padding: '8px 11px', background: C.amberBg, border: `1px solid ${C.amberLine}`, borderRadius: 10, fontSize: 12, color: C.amber, lineHeight: 1.4 },

  // Panel de rendimiento (G2e)
  perfGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 12 },
  perfCard: { background: C.page, border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 13px' },
  perfCardLabel: { fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: C.inkFaint },
  perfCardValue: { fontSize: 21, fontWeight: 800, color: C.ink, marginTop: 3, letterSpacing: '-.01em' },
  perfCardSub: { fontSize: 11.5, color: C.inkDim, marginTop: 2 },
  perfNote: { marginTop: 12, fontSize: 12.5, color: C.inkDim, lineHeight: 1.45 },
  perfChart: { marginTop: 16 },
  perfChartLabel: { fontSize: 12, fontWeight: 700, color: C.inkDim, marginBottom: 8 },
  perfBars: { display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, borderBottom: `1px solid ${C.line}`, paddingBottom: 2, overflowX: 'auto' },
  perfBarCol: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4, minWidth: 22, height: '100%' },
  perfBar: { width: 16, background: C.accent, borderRadius: '4px 4px 0 0', minHeight: 3 },
  perfBarDay: { fontSize: 9, color: C.inkFaint, whiteSpace: 'nowrap' },
  err: { fontSize: 13, color: C.red, fontWeight: 600, marginRight: 'auto' },
  ghost: { background: 'none', border: `1px solid ${C.lineInput}`, color: C.ink, borderRadius: 10, padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  save: { border: 'none', background: C.accent, color: '#fff', borderRadius: 10, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },

  // Gestor D
  typeGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 },
  typeBtn: { textAlign: 'left', border: `1px solid ${C.lineInput}`, background: '#fff', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 },
  typeOn: { border: `2px solid ${C.accent}`, background: '#FFF7F5' },
  typeLabel: { fontSize: 13.5, fontWeight: 800, color: C.ink },
  typeHint: { fontSize: 11.5, color: C.inkFaint, lineHeight: 1.3 },
  scCat: { marginLeft: 16 },
  scItem: { marginLeft: 16, color: C.inkDim },
  scRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0', cursor: 'pointer' },
  scHint: { color: C.inkFaint, fontSize: 12, fontWeight: 400 },
  checkBox: { width: 15, height: 15, accentColor: C.accent, cursor: 'pointer', flexShrink: 0 },

  // Picker rediseñado: marca + buscador + resumen
  brandChips: { display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 6 },
  brandChip: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, borderRadius: 999, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  brandChipOn: { background: C.accent, color: '#fff', border: `1px solid ${C.accent}` },
  pickBody: { maxHeight: 240, overflowY: 'auto', border: `1px solid ${C.lineInput}`, borderRadius: 10, padding: '8px 10px', marginTop: 8 },
  pickEmpty: { fontSize: 12.5, color: C.inkFaint, padding: '14px 4px', textAlign: 'center', lineHeight: 1.4 },
  pickHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '2px 0 8px', borderBottom: `1px solid ${C.line}`, marginBottom: 6, fontSize: 12.5, fontWeight: 700, color: C.inkDim },
  pickAll: { border: 'none', background: C.accent, color: '#fff', borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  pickName: { fontSize: 13, color: C.ink, fontWeight: 500 },
  summaryWrap: { marginTop: 10 },
  summaryChip: { border: `1px solid ${C.goldLine}`, background: C.gold, color: C.amber, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' },
  summaryList: { marginTop: 8, border: `1px solid ${C.lineInput}`, borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 },
  summaryItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '3px 0' },
  summaryLbl: { fontSize: 12.5, color: C.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  summaryX: { border: 'none', background: 'none', color: C.inkFaint, fontSize: 17, lineHeight: 1, cursor: 'pointer', padding: '0 4px', flexShrink: 0 },
  summaryClear: { alignSelf: 'flex-start', border: 'none', background: 'none', color: C.red, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '4px 0 0', textDecoration: 'underline' },
  wdRow: { display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  wdBtn: { width: 34, height: 34, borderRadius: '50%', border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  wdOn: { background: C.ink, color: '#fff', border: `1px solid ${C.ink}` },
  okNote: { marginTop: 10, padding: '8px 11px', background: C.greenBg, border: `1px solid ${C.green}33`, borderRadius: 10, fontSize: 12, color: C.greenDeep, fontWeight: 600 },
  mirrorBox: { marginTop: 12, padding: '11px 13px', background: C.gold, border: `1px solid ${C.goldLine}`, borderRadius: 12 },
  mirrorText: { fontSize: 12.5, color: C.amber, lineHeight: 1.45, marginBottom: 9 },
  mirrorBtn: { border: 'none', background: C.ink, color: '#fff', borderRadius: 999, padding: '8px 15px', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  mirrorMsg: { fontSize: 12, color: C.greenDeep, marginTop: 8, fontWeight: 600 },
}
